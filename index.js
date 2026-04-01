const net = require('net');
const http = require('http');
const { WebSocket, createWebSocketStream } = require('ws');
const { TextDecoder } = require('util');

// --- Logging helpers (direct functions, no .bind overhead) ---
const log = (...args) => console.log(...args);
const err = (...args) => console.error(...args);

// --- Configuration ---
const uuid = (process.env.UUID || 'd342d11e-d424-4583-b36e-524ab1f0afa4').replace(/-/g, '');
const port = process.env.PORT || 8080;

// --- Pre-parse UUID bytes once at startup (avoid repeated parsing per connection) ---
const uuidBytes = new Uint8Array(16);
for (let i = 0; i < 16; i++) {
    uuidBytes[i] = parseInt(uuid.substr(i * 2, 2), 16);
}

// --- Pre-build the home page HTML once at startup (avoid re-building per request) ---
const homePageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VLESS Proxy Server</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { font-family: 'Inter', sans-serif; }
        .modal-backdrop { background-color: rgba(0, 0, 0, 0.5); z-index: 999; }
        .modal-content { z-index: 1000; }
    </style>
</head>
<body class="bg-gradient-to-br from-blue-500 to-purple-600 min-h-screen flex items-center justify-center p-4">
    <div class="bg-white p-8 rounded-lg shadow-xl max-w-md w-full text-center">
        <h1 class="text-4xl font-bold text-gray-800 mb-4">VLESS Proxy</h1>
        <p class="text-lg text-gray-600 mb-6">
            Your secure and efficient proxy server is running.
        </p>
        <div class="bg-gray-100 p-6 rounded-md mb-6">
            <h2 class="text-xl font-semibold text-gray-700 mb-3">Server Status: Online</h2>
            <div class="text-left text-gray-700">
                <p class="text-sm text-gray-500 mt-4">
                    Click the button below to get your VLESS configuration details.
                </p>
            </div>
        </div>
        <button id="getConfigBtn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75">
            Get My VLESS Config
        </button>
        <p class="text-md text-gray-700 mt-6">
            Join my Telegram channel for more updates: <a href="https://t.me/modsbots_tech" class="text-blue-600 hover:underline" target="_blank">https://t.me/modsbots_tech</a>
        </p>
    </div>

    <div id="vlessConfigModal" class="fixed inset-0 hidden items-center justify-center modal-backdrop">
        <div class="bg-white p-8 rounded-lg shadow-xl max-w-xl w-full modal-content relative">
            <h2 class="text-2xl font-bold text-gray-800 mb-4">Your VLESS Configuration</h2>
            <div class="bg-gray-100 p-4 rounded-md mb-4 text-left">
                <p class="mb-2"><strong>UUID:</strong> <span id="modalUuid" class="break-all font-mono text-sm"></span></p>
                <p class="mb-2"><strong>Port:</strong> <span id="modalPort" class="font-mono text-sm"></span></p>
                <p class="mb-2"><strong>Host:</strong> <span id="modalHost" class="font-mono text-sm"></span></p>
                <textarea id="vlessUri" class="w-full h-32 p-2 mt-4 border rounded-md resize-none bg-gray-50 text-gray-700 font-mono text-sm" readonly></textarea>
            </div>
            <button id="copyConfigBtn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75 mr-2">
                Copy URI
            </button>
            <button id="closeModalBtn" class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-opacity-75">
                Close
            </button>
            <div id="copyMessage" class="text-sm text-green-600 mt-2 hidden">Copied to clipboard!</div>
            <div id="checkStatus" class="text-sm mt-2"></div>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const getConfigBtn = document.getElementById('getConfigBtn');
            const vlessConfigModal = document.getElementById('vlessConfigModal');
            const closeModalBtn = document.getElementById('closeModalBtn');
            const copyConfigBtn = document.getElementById('copyConfigBtn');
            const modalUuid = document.getElementById('modalUuid');
            const modalPort = document.getElementById('modalPort');
            const modalHost = document.getElementById('modalHost');
            const vlessUri = document.getElementById('vlessUri');
            const copyMessage = document.getElementById('copyMessage');
            const checkStatus = document.getElementById('checkStatus');

            const serverUuid = "${uuid}";
            const serverPort = "443";
            const serverHost = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;

            getConfigBtn.addEventListener('click', async () => {
                modalUuid.textContent = serverUuid;
                modalPort.textContent = serverPort;
                modalHost.textContent = serverHost;

                const uri = \`vless://\${serverUuid}@\${serverHost}:443?security=tls&fp=randomized&type=ws&host=\${serverHost}&encryption=none#Nothflank-By-ModsBots\`;
                vlessUri.value = uri;

                vlessConfigModal.classList.remove('hidden');
                vlessConfigModal.classList.add('flex');
                copyMessage.classList.add('hidden');
                checkStatus.textContent = '';

                const externalCheckUrl = \`https://deno-proxy-version.deno.dev/?check=\${encodeURIComponent(uri)}\`;
                checkStatus.className = 'text-sm mt-2 text-gray-700';
                checkStatus.textContent = 'Checking VLESS config with external service...';

                try {
                    const response = await fetch(externalCheckUrl);
                    if (response.ok) {
                        const data = await response.text();
                        checkStatus.textContent = \`External check successful! Response: \${data.substring(0, 100)}...\`;
                        checkStatus.classList.remove('text-gray-700');
                        checkStatus.classList.add('text-green-600');
                    } else {
                        checkStatus.textContent = \`External check failed: Server responded with status \${response.status}\`;
                        checkStatus.classList.remove('text-gray-700');
                        checkStatus.classList.add('text-red-600');
                    }
                } catch (error) {
                    checkStatus.textContent = \`External check error: \${error.message}\`;
                    checkStatus.classList.remove('text-gray-700');
                    checkStatus.classList.add('text-red-600');
                    console.error('Error checking VLESS config with external service:', error);
                }
            });

            closeModalBtn.addEventListener('click', () => {
                vlessConfigModal.classList.add('hidden');
                vlessConfigModal.classList.remove('flex');
            });

            vlessConfigModal.addEventListener('click', (event) => {
                if (event.target === vlessConfigModal) {
                    vlessConfigModal.classList.add('hidden');
                    vlessConfigModal.classList.remove('flex');
                }
            });

            copyConfigBtn.addEventListener('click', () => {
                vlessUri.select();
                vlessUri.setSelectionRange(0, 99999);
                try {
                    document.execCommand('copy');
                    copyMessage.classList.remove('hidden');
                    setTimeout(() => { copyMessage.classList.add('hidden'); }, 2000);
                } catch (e) {
                    console.error('Failed to copy text: ', e);
                }
            });
        });
    </script>
</body>
</html>`;

// Pre-compute response headers for the home page
const homePageHeaders = {
    'Content-Type': 'text/html',
    'Cache-Control': 'public, max-age=3600',
    'Content-Length': Buffer.byteLength(homePageHTML)
};

// --- HTTP Server ---
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, homePageHeaders);
        res.end(homePageHTML);
    } else if (req.method === 'GET' && url.searchParams.get('check') === 'VLESS__CONFIG') {
        const hostname = req.headers.host.split(':')[0];
        const vlessConfig = {
            uuid: uuid,
            port: port,
            host: hostname,
            vless_uri: `vless://${uuid}@${hostname}:443?security=tls&fp=randomized&type=ws&host=${hostname}&encryption=none#Nothflank-By-ModsBots`
        };
        const body = JSON.stringify(vlessConfig);
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        });
        res.end(body);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// --- WebSocket Server with performance options ---
const wss = new WebSocket.Server({
    noServer: true,
    perMessageDeflate: false,       // Disable compression (saves significant CPU)
    maxPayload: 64 * 1024 * 1024,  // 64MB max payload limit (prevent memory abuse)
    skipUTF8Validation: true        // Skip UTF8 validation for binary data (saves CPU)
});

// Handle HTTP upgrade to WebSocket
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// --- Reusable TextDecoder instance (avoid creating per connection) ---
const textDecoder = new TextDecoder();

// --- WebSocket Connection Handler (VLESS Proxy Logic - unchanged behavior) ---
wss.on('connection', (ws) => {
    // Track whether this connection has been cleaned up
    let cleaned = false;
    let targetSocket = null;

    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        try { if (targetSocket && !targetSocket.destroyed) targetSocket.destroy(); } catch (_) {}
        try { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(); } catch (_) {}
    };

    ws.on('close', cleanup);
    ws.on('error', (e) => {
        err('WS-Err:', e.message);
        cleanup();
    });

    ws.once('message', (msg) => {
        const [VERSION] = msg;
        const id = msg.slice(1, 17);

        // Validate UUID using pre-parsed bytes
        if (!id.every((v, i) => v === uuidBytes[i])) {
            ws.close();
            return;
        }

        // Parse VLESS header
        let i = msg.slice(17, 18).readUInt8() + 19;
        const targetPort = msg.slice(i, i += 2).readUInt16BE(0);
        const ATYP = msg.slice(i, i += 1).readUInt8();

        let host;
        if (ATYP === 1) { // IPv4
            host = msg.slice(i, i += 4).join('.');
        } else if (ATYP === 2) { // Domain
            host = textDecoder.decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8()));
        } else if (ATYP === 3) { // IPv6
            host = msg.slice(i, i += 16)
                .reduce((s, b, idx, arr) => (idx % 2 ? s.concat(arr.slice(idx - 1, idx + 1)) : s), [])
                .map(b => b.readUInt16BE(0).toString(16))
                .join(':');
        } else {
            ws.close();
            return;
        }

        log('conn:', host, targetPort);

        // Send VLESS handshake response
        ws.send(new Uint8Array([VERSION, 0]));

        // Create duplex stream with controlled buffer size
        const duplex = createWebSocketStream(ws, {
            highWaterMark: 64 * 1024  // 64KB buffer (balance between throughput and RAM)
        });

        // Connect to target with optimized socket options
        targetSocket = net.connect({
            host,
            port: targetPort,
            noDelay: true,          // Disable Nagle's algorithm (reduce latency)
            keepAlive: true,        // Enable TCP keep-alive (prevent idle drops)
            keepAliveInitialDelay: 30000,  // 30s before first keep-alive probe
            allowHalfOpen: true,    // Allow half-open connections (stability)
            highWaterMark: 64 * 1024      // 64KB socket buffer
        }, function () {
            // Write remaining payload to target
            this.write(msg.slice(i));
            // Pipe data bidirectionally
            duplex.on('error', (e) => {
                err('E1:', e.message);
                cleanup();
            }).pipe(this).on('error', (e) => {
                err('E2:', e.message);
                cleanup();
            }).pipe(duplex);
        });

        // Handle target socket events
        targetSocket.on('error', (e) => {
            err('Conn-Err:', host, targetPort, e.message);
            cleanup();
        });

        targetSocket.on('close', () => {
            try { if (!duplex.destroyed) duplex.destroy(); } catch (_) {}
        });

        targetSocket.setTimeout(120000, () => {  // 2 minute timeout for idle connections
            targetSocket.destroy();
        });

        // Handle duplex close → cleanup target
        duplex.on('close', () => {
            try { if (targetSocket && !targetSocket.destroyed) targetSocket.destroy(); } catch (_) {}
        });
    });
});

// --- Start Server ---
server.listen(port, '0.0.0.0', 256, () => {  // backlog: 256 for better connection queuing
    log('Server listening on port:', port);
    log('VLESS Proxy UUID:', uuid);
    log('Access home page at: http://localhost:' + port);
});

server.on('error', (e) => {
    err('Server Error:', e);
});

// --- Process-level error handlers (prevent crashes on Railway) ---
process.on('uncaughtException', (e) => {
    err('Uncaught Exception:', e.message);
});

process.on('unhandledRejection', (e) => {
    err('Unhandled Rejection:', e);
});

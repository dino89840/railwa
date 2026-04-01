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
const VLESS_PASS = process.env.VLESS_PASS || 'admin123';

// --- Pre-parse UUID bytes once at startup (avoid repeated parsing per connection) ---
const uuidBytes = new Uint8Array(16);
for (let i = 0; i < 16; i++) {
    uuidBytes[i] = parseInt(uuid.substr(i * 2, 2), 16);
}

// --- 3D Landing Page HTML (shown at root "/") ---
const landingPageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { overflow: hidden; background: #000; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        canvas { display: block; }
        .overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            pointer-events: none; z-index: 10;
        }
        .overlay h1 {
            font-size: 3rem; color: #fff; text-shadow: 0 0 30px rgba(100, 200, 255, 0.8);
            animation: pulse 2s ease-in-out infinite alternate;
            letter-spacing: 4px;
        }
        .overlay p {
            font-size: 1.1rem; color: rgba(255,255,255,0.6); margin-top: 12px;
            letter-spacing: 2px;
        }
        .stats {
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            display: flex; gap: 40px; z-index: 10;
        }
        .stats .stat {
            text-align: center; color: rgba(255,255,255,0.7);
        }
        .stats .stat .num {
            font-size: 2rem; font-weight: bold;
            background: linear-gradient(135deg, #667eea, #764ba2, #f093fb);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .stats .stat .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
        @keyframes pulse {
            from { opacity: 0.8; transform: scale(1); }
            to { opacity: 1; transform: scale(1.03); }
        }
        .particles { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; }
    </style>
</head>
<body>
    <canvas id="particles" class="particles"></canvas>
    <div id="three-container" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:2;"></div>
    <div class="overlay">
        <h1>QUANTUM NEXUS</h1>
        <p>Secure Infrastructure Online</p>
    </div>
    <div class="stats">
        <div class="stat"><div class="num" id="uptime">0</div><div class="label">Uptime (s)</div></div>
        <div class="stat"><div class="num" id="nodes">256</div><div class="label">Active Nodes</div></div>
        <div class="stat"><div class="num" id="latency">12ms</div><div class="label">Latency</div></div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script>
        // --- Particle background ---
        (function() {
            const canvas = document.getElementById('particles');
            const ctx = canvas.getContext('2d');
            let w, h, particles = [];
            function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
            resize(); window.addEventListener('resize', resize);
            for (let i = 0; i < 120; i++) {
                particles.push({ x: Math.random()*w, y: Math.random()*h, r: Math.random()*2+0.5, dx: (Math.random()-0.5)*0.5, dy: (Math.random()-0.5)*0.5, o: Math.random()*0.5+0.2 });
            }
            function drawParticles() {
                ctx.clearRect(0,0,w,h);
                particles.forEach(p => {
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
                    ctx.fillStyle = 'rgba(150,180,255,'+p.o+')'; ctx.fill();
                    p.x += p.dx; p.y += p.dy;
                    if (p.x < 0 || p.x > w) p.dx *= -1;
                    if (p.y < 0 || p.y > h) p.dy *= -1;
                });
                // draw lines between close particles
                for (let i = 0; i < particles.length; i++) {
                    for (let j = i+1; j < particles.length; j++) {
                        const dx = particles[i].x - particles[j].x;
                        const dy = particles[i].y - particles[j].y;
                        const dist = Math.sqrt(dx*dx + dy*dy);
                        if (dist < 120) {
                            ctx.beginPath(); ctx.moveTo(particles[i].x, particles[i].y);
                            ctx.lineTo(particles[j].x, particles[j].y);
                            ctx.strokeStyle = 'rgba(100,150,255,'+(1 - dist/120)*0.15+')';
                            ctx.stroke();
                        }
                    }
                }
                requestAnimationFrame(drawParticles);
            }
            drawParticles();
        })();

        // --- Three.js 3D Object ---
        (function() {
            const container = document.getElementById('three-container');
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
            const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            container.appendChild(renderer.domElement);

            // Torus Knot with wireframe
            const geometry = new THREE.TorusKnotGeometry(3, 0.8, 200, 32, 3, 5);
            const material = new THREE.MeshBasicMaterial({
                color: 0x6677ee, wireframe: true, transparent: true, opacity: 0.3
            });
            const torusKnot = new THREE.Mesh(geometry, material);
            scene.add(torusKnot);

            // Inner glowing sphere
            const sphereGeo = new THREE.IcosahedronGeometry(1.8, 4);
            const sphereMat = new THREE.MeshBasicMaterial({
                color: 0xaa55ff, wireframe: true, transparent: true, opacity: 0.15
            });
            const sphere = new THREE.Mesh(sphereGeo, sphereMat);
            scene.add(sphere);

            // Outer ring
            const ringGeo = new THREE.TorusGeometry(5, 0.05, 16, 100);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0xf093fb, transparent: true, opacity: 0.4 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2;
            scene.add(ring);

            const ring2 = new THREE.Mesh(ringGeo.clone(), ringMat.clone());
            ring2.rotation.x = Math.PI / 3;
            ring2.rotation.y = Math.PI / 4;
            scene.add(ring2);

            camera.position.z = 10;

            let mouseX = 0, mouseY = 0;
            document.addEventListener('mousemove', (e) => {
                mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
                mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
            });

            window.addEventListener('resize', () => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            });

            function animate() {
                requestAnimationFrame(animate);
                const time = Date.now() * 0.001;
                torusKnot.rotation.x = time * 0.15 + mouseY * 0.3;
                torusKnot.rotation.y = time * 0.2 + mouseX * 0.3;
                sphere.rotation.x = -time * 0.1;
                sphere.rotation.y = time * 0.15;
                ring.rotation.z = time * 0.3;
                ring2.rotation.z = -time * 0.2;
                material.opacity = 0.2 + Math.sin(time) * 0.1;
                camera.position.x += (mouseX * 2 - camera.position.x) * 0.02;
                camera.position.y += (-mouseY * 2 - camera.position.y) * 0.02;
                camera.lookAt(scene.position);
                renderer.render(scene, camera);
            }
            animate();
        })();

        // Uptime counter
        let startTime = Date.now();
        setInterval(() => {
            document.getElementById('uptime').textContent = Math.floor((Date.now() - startTime) / 1000);
            document.getElementById('latency').textContent = (Math.random() * 10 + 8).toFixed(1) + 'ms';
            document.getElementById('nodes').textContent = Math.floor(240 + Math.random() * 30);
        }, 1000);
    </script>
</body>
</html>`;

// --- VLESS Config Page HTML (shown at "/vless-config" after password) ---
const vlessConfigPageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VLESS Config</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-gradient-to-br from-gray-900 to-gray-800 min-h-screen flex items-center justify-center p-4">
    <!-- Password Gate -->
    <div id="authGate" class="bg-white p-8 rounded-lg shadow-xl max-w-sm w-full text-center">
        <h1 class="text-2xl font-bold text-gray-800 mb-2">Authentication Required</h1>
        <p class="text-sm text-gray-500 mb-6">Enter password to access VLESS configuration.</p>
        <input id="passInput" type="password" placeholder="Enter password"
            class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4 text-center text-lg tracking-widest" />
        <button id="authBtn"
            class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75">
            Unlock
        </button>
        <p id="authError" class="text-red-500 text-sm mt-3 hidden">Incorrect password. Try again.</p>
    </div>

    <!-- Config Panel (hidden until authenticated) -->
    <div id="configPanel" class="hidden bg-white p-8 rounded-lg shadow-xl max-w-xl w-full text-center">
        <h1 class="text-3xl font-bold text-gray-800 mb-4">VLESS Configuration</h1>
        <div class="bg-gray-100 p-6 rounded-md mb-6 text-left">
            <p class="mb-2"><strong>UUID:</strong> <span id="modalUuid" class="break-all font-mono text-sm"></span></p>
            <p class="mb-2"><strong>Port:</strong> <span id="modalPort" class="font-mono text-sm">443</span></p>
            <p class="mb-2"><strong>Host:</strong> <span id="modalHost" class="font-mono text-sm"></span></p>
            <textarea id="vlessUri" class="w-full h-32 p-2 mt-4 border rounded-md resize-none bg-gray-50 text-gray-700 font-mono text-sm" readonly></textarea>
        </div>
        <button id="copyConfigBtn"
            class="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 mr-2">
            Copy URI
        </button>
        <div id="copyMessage" class="text-sm text-green-600 mt-2 hidden">Copied to clipboard!</div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const authGate = document.getElementById('authGate');
            const configPanel = document.getElementById('configPanel');
            const passInput = document.getElementById('passInput');
            const authBtn = document.getElementById('authBtn');
            const authError = document.getElementById('authError');
            const copyConfigBtn = document.getElementById('copyConfigBtn');
            const copyMessage = document.getElementById('copyMessage');
            const vlessUri = document.getElementById('vlessUri');

            const serverUuid = "${uuid}";
            const serverHost = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;

            passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') authBtn.click(); });

            authBtn.addEventListener('click', async () => {
                const password = passInput.value;
                authError.classList.add('hidden');
                authBtn.textContent = 'Verifying...';
                authBtn.disabled = true;

                try {
                    const resp = await fetch('/vless-auth', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password })
                    });

                    if (resp.ok) {
                        authGate.classList.add('hidden');
                        configPanel.classList.remove('hidden');

                        document.getElementById('modalUuid').textContent = serverUuid;
                        document.getElementById('modalHost').textContent = serverHost;

                        const uri = \`vless://\${serverUuid}@\${serverHost}:443?security=tls&fp=randomized&type=ws&host=\${serverHost}&encryption=none#Nothflank-By-ModsBots\`;
                        vlessUri.value = uri;
                    } else {
                        authError.classList.remove('hidden');
                    }
                } catch (e) {
                    authError.textContent = 'Network error. Try again.';
                    authError.classList.remove('hidden');
                }
                authBtn.textContent = 'Unlock';
                authBtn.disabled = false;
            });

            copyConfigBtn.addEventListener('click', () => {
                vlessUri.select();
                vlessUri.setSelectionRange(0, 99999);
                try {
                    document.execCommand('copy');
                    copyMessage.classList.remove('hidden');
                    setTimeout(() => { copyMessage.classList.add('hidden'); }, 2000);
                } catch (e) { console.error('Copy failed:', e); }
            });
        });
    </script>
</body>
</html>`;

// Pre-compute response headers
const landingPageHeaders = {
    'Content-Type': 'text/html',
    'Cache-Control': 'public, max-age=3600',
    'Content-Length': Buffer.byteLength(landingPageHTML)
};

const vlessConfigPageHeaders = {
    'Content-Type': 'text/html',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(vlessConfigPageHTML)
};

// --- HTTP Server ---
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Root path → 3D landing page
    if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, landingPageHeaders);
        res.end(landingPageHTML);
    }
    // VLESS config page (password-gated UI)
    else if (req.method === 'GET' && url.pathname === '/vless-config') {
        res.writeHead(200, vlessConfigPageHeaders);
        res.end(vlessConfigPageHTML);
    }
    // Password verification endpoint
    else if (req.method === 'POST' && url.pathname === '/vless-auth') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { password } = JSON.parse(body);
                if (password === VLESS_PASS) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Invalid password' }));
                }
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Bad request' }));
            }
        });
    }
    // Legacy check endpoint (kept for compatibility)
    else if (req.method === 'GET' && url.searchParams.get('check') === 'VLESS__CONFIG') {
        const hostname = req.headers.host.split(':')[0];
        const vlessConfig = {
            uuid: uuid,
            port: port,
            host: hostname,
            vless_uri: `vless://${uuid}@${hostname}:443?security=tls&fp=randomized&type=ws&host=${hostname}&encryption=none#Nothflank-By-ModsBots`
        };
        const respBody = JSON.stringify(vlessConfig);
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(respBody)
        });
        res.end(respBody);
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// --- WebSocket Server with performance options ---
const wss = new WebSocket.Server({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 64 * 1024 * 1024,
    skipUTF8Validation: true
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

        if (!id.every((v, i) => v === uuidBytes[i])) {
            ws.close();
            return;
        }

        let i = msg.slice(17, 18).readUInt8() + 19;
        const targetPort = msg.slice(i, i += 2).readUInt16BE(0);
        const ATYP = msg.slice(i, i += 1).readUInt8();

        let host;
        if (ATYP === 1) {
            host = msg.slice(i, i += 4).join('.');
        } else if (ATYP === 2) {
            host = textDecoder.decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8()));
        } else if (ATYP === 3) {
            host = msg.slice(i, i += 16)
                .reduce((s, b, idx, arr) => (idx % 2 ? s.concat(arr.slice(idx - 1, idx + 1)) : s), [])
                .map(b => b.readUInt16BE(0).toString(16))
                .join(':');
        } else {
            ws.close();
            return;
        }

        log('conn:', host, targetPort);

        ws.send(new Uint8Array([VERSION, 0]));

        const duplex = createWebSocketStream(ws, {
            highWaterMark: 64 * 1024
        });

        targetSocket = net.connect({
            host,
            port: targetPort,
            noDelay: true,
            keepAlive: true,
            keepAliveInitialDelay: 30000,
            allowHalfOpen: true,
            highWaterMark: 64 * 1024
        }, function () {
            this.write(msg.slice(i));
            duplex.on('error', (e) => {
                err('E1:', e.message);
                cleanup();
            }).pipe(this).on('error', (e) => {
                err('E2:', e.message);
                cleanup();
            }).pipe(duplex);
        });

        targetSocket.on('error', (e) => {
            err('Conn-Err:', host, targetPort, e.message);
            cleanup();
        });

        targetSocket.on('close', () => {
            try { if (!duplex.destroyed) duplex.destroy(); } catch (_) {}
        });

        targetSocket.setTimeout(120000, () => {
            targetSocket.destroy();
        });

        duplex.on('close', () => {
            try { if (targetSocket && !targetSocket.destroyed) targetSocket.destroy(); } catch (_) {}
        });
    });
});

// --- Start Server ---
server.listen(port, '0.0.0.0', 256, () => {
    log('Server listening on port:', port);
    log('VLESS Proxy UUID:', uuid);
    log('Access home page at: http://localhost:' + port);
    log('VLESS config page at: http://localhost:' + port + '/vless-config');
});

server.on('error', (e) => {
    err('Server Error:', e);
});

process.on('uncaughtException', (e) => {
    err('Uncaught Exception:', e.message);
});

process.on('unhandledRejection', (e) => {
    err('Unhandled Rejection:', e);
});

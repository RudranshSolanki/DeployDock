const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
const os = require('os');
const processManager = require('./services/processManager');
const proxyManager = require('./services/proxyManager');
const projectManager = require('./services/projectManager');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

// Detect LAN IP
function getLanIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.')) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}
const LAN_IP = getLanIP();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
const projectRoutes = require('./routes/projects');
app.use('/api/projects', projectRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), lanIP: LAN_IP });
});

// Proxy info
app.get('/api/proxy/routes', (req, res) => {
    res.json({
        success: true,
        proxyPort: proxyManager.getProxyPort(),
        lanIP: LAN_IP,
        apiPort: PORT,
        routes: proxyManager.getAllRoutes(),
    });
});

// WebSocket server for real-time logs
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Map(); // ws -> Set<projectId>

wss.on('connection', (ws) => {
    clients.set(ws, new Set());

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'subscribe' && msg.projectId) {
                clients.get(ws).add(msg.projectId);
                // Send existing logs
                const logs = processManager.getLogs(msg.projectId);
                ws.send(JSON.stringify({
                    type: 'logs_history',
                    projectId: msg.projectId,
                    logs,
                }));
            }

            if (msg.type === 'unsubscribe' && msg.projectId) {
                clients.get(ws).delete(msg.projectId);
            }

            if (msg.type === 'stdin' && msg.projectId && msg.data) {
                processManager.sendInput(msg.projectId, msg.data);
            }

            // Restricted terminal: run a command in the project directory
            if (msg.type === 'run-command' && msg.projectId && msg.command) {
                const project = projectManager.getProject(msg.projectId);
                if (project && project.path) {
                    processManager.runProjectCommand(msg.projectId, project.path, msg.command);
                }
            }
        } catch (e) { /* ignore invalid messages */ }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});

// Forward process manager events to WebSocket clients
processManager.on('log', ({ projectId, log }) => {
    const message = JSON.stringify({
        type: 'log',
        projectId,
        log,
    });

    for (const [ws, subscriptions] of clients.entries()) {
        if (subscriptions.has(projectId) || subscriptions.has('*')) {
            try {
                ws.send(message);
            } catch (e) { /* client disconnected */ }
        }
    }
});

processManager.on('cmd-data', ({ projectId, data }) => {
    const message = JSON.stringify({
        type: 'cmd-data',
        projectId,
        data,
    });

    for (const [ws, subscriptions] of clients.entries()) {
        if (subscriptions.has(projectId) || subscriptions.has('*')) {
            try {
                ws.send(message);
            } catch (e) { /* client disconnected */ }
        }
    }
});

processManager.on('status', ({ projectId, status }) => {
    const message = JSON.stringify({
        type: 'status',
        projectId,
        status,
    });

    for (const [ws] of clients.entries()) {
        try {
            ws.send(message);
        } catch (e) { /* client disconnected */ }
    }
});

// Set LAN IP on proxy manager
proxyManager.setLanIP(LAN_IP);

// Start the reverse proxy (binds to 0.0.0.0)
proxyManager.start();

// Start server on 0.0.0.0 so LAN devices can access
server.listen(PORT, '0.0.0.0', () => {
    const proxyPort = proxyManager.getProxyPort();
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║          🚀 DeployDock Server Running                          ║
║                                                                ║
║   LAN IP:        ${LAN_IP.padEnd(46)}║
║                                                                ║
║   API:           http://localhost:${PORT}                        ║
║   Reverse Proxy: http://localhost:${proxyPort}                       ║
║                                                                ║
║   📱 LAN Access (other devices on same network):               ║
║   Dashboard:     http://${(LAN_IP + ':' + PORT).padEnd(42)}║
║   Proxy:         http://${(LAN_IP + ':' + proxyPort).padEnd(42)}║
║   Projects:      http://${(LAN_IP + ':' + proxyPort + '/<name>/').padEnd(42)}║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);

    // Auto-redeploy all projects
    projectManager.autoDeployAllProjects();
});

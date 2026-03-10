const http = require('http');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');

class ProxyManager {
    constructor() {
        this.proxy = httpProxy.createProxyServer({});
        this.routes = new Map();       // domain -> { target, port, projectId, name }
        this.nameToRoute = new Map();  // projectName -> { target, port, projectId, domain }
        this.proxyPort = 8080;
        this.server = null;
        this.lanIP = '127.0.0.1';

        // Handle proxy errors gracefully
        this.proxy.on('error', (err, req, res) => {
            console.error(`[Proxy] Error: ${err.message}`);
            if (res && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/html' });
                res.end(this._errorPage(req.headers.host, 'Project is not responding. It may still be starting up.'));
            }
        });
    }

    /**
     * Set the LAN IP address
     */
    setLanIP(ip) {
        this.lanIP = ip;
    }

    /**
     * Start the reverse proxy server on 0.0.0.0 (accessible from LAN)
     * 
     * Access methods from SAME machine:
     *   http://localhost:8080/project-name/
     *   http://project-name.localhost:8080/
     * 
     * Access methods from OTHER devices on network:
     *   http://<LAN-IP>:8080/project-name/
     */
    start() {
        this.server = http.createServer((req, res) => {
            const host = (req.headers.host || '').split(':')[0].toLowerCase();
            let route = null;
            let pathRewritten = false;

            // Method 1: Flexible Subdomain-based
            // Matches: project.localhost, project.192.168.x.x.nip.io, project.internal, etc.
            if (!route) {
                const parts = host.split('.');
                if (parts.length > 1) {
                    const subdomain = parts[0];
                    route = this.routes.get(`${subdomain}.internal`);
                    if (!route) route = this.nameToRoute.get(subdomain);
                }
            }

            // Method 2: Full host match
            if (!route) {
                route = this.routes.get(host);
            }

            // Method 3: Path-based routing
            if (!route) {
                const urlPath = req.url || '/';
                const pathParts = urlPath.split('?')[0].split('/').filter(Boolean);

                if (pathParts.length >= 1) {
                    const projectName = pathParts[0].toLowerCase();
                    route = this.nameToRoute.get(projectName);

                    if (route) {
                        // Strip the project name prefix from the URL
                        const remainingParts = pathParts.slice(1);
                        let newPath = '/' + remainingParts.join('/');

                        if (urlPath.endsWith('/') && remainingParts.length > 0) {
                            newPath += '/';
                        } else if (remainingParts.length === 0) {
                            newPath = '/';
                        }

                        const queryIndex = urlPath.indexOf('?');
                        if (queryIndex !== -1) {
                            newPath += urlPath.substring(queryIndex);
                        }

                        req.url = newPath;
                        pathRewritten = true;
                    }
                }
            }

            // Method 4: Referer-based routing (CRITICAL for asset loading)
            // When /frontend/ loads, it requests /src/main.tsx, /@react-refresh, etc.
            // The Referer header tells us which project page made this request
            if (!route) {
                const referer = req.headers.referer || req.headers.referrer || '';
                if (referer) {
                    try {
                        const refUrl = new URL(referer);
                        const refPathParts = refUrl.pathname.split('/').filter(Boolean);
                        if (refPathParts.length >= 1) {
                            const projectName = refPathParts[0].toLowerCase();
                            route = this.nameToRoute.get(projectName);
                            if (route) {
                                // Don't modify the URL — pass the request as-is to the project server
                                // (e.g., /src/main.tsx goes directly to the Vite server)
                            }
                        }
                    } catch (e) { /* invalid referer URL */ }
                }
            }

            if (route) {
                this.proxy.web(req, res, {
                    target: route.target,
                    changeOrigin: true,
                });
            } else {
                // Show dashboard with all routes
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(this._generateDashboard(host, req.url));
            }
        });

        // Handle WebSocket upgrades
        this.server.on('upgrade', (req, socket, head) => {
            const host = (req.headers.host || '').split(':')[0].toLowerCase();
            let route = this.routes.get(host);

            // Try subdomain
            if (!route) {
                const parts = host.split('.');
                if (parts.length > 1) {
                    const subdomain = parts[0];
                    route = this.nameToRoute.get(subdomain);
                }
            }

            // Try path-based for WebSocket
            if (!route) {
                const urlPath = req.url || '/';
                const pathParts = urlPath.split('/').filter(Boolean);
                if (pathParts.length >= 1) {
                    route = this.nameToRoute.get(pathParts[0].toLowerCase());
                    if (route) {
                        req.url = '/' + pathParts.slice(1).join('/');
                    }
                }
            }

            // Try Referer-based (for Vite HMR WebSocket)
            if (!route) {
                const referer = req.headers.origin || req.headers.referer || '';
                if (referer) {
                    try {
                        const refUrl = new URL(referer);
                        const refPathParts = refUrl.pathname.split('/').filter(Boolean);
                        if (refPathParts.length >= 1) {
                            route = this.nameToRoute.get(refPathParts[0].toLowerCase());
                        }
                    } catch (e) { /* ignore */ }
                }
            }

            // Last resort: if there's only one project, route to it
            if (!route && this.nameToRoute.size === 1) {
                route = this.nameToRoute.values().next().value;
            }

            if (route) {
                this.proxy.ws(req, socket, head, { target: route.target, changeOrigin: true });
            } else {
                socket.destroy();
            }
        });

        // Bind to 0.0.0.0 so other devices on network can access
        this.server.listen(this.proxyPort, '0.0.0.0', () => {
            console.log(`[Proxy] Reverse proxy running on:`);
            console.log(`[Proxy]   Local: http://localhost:${this.proxyPort}`);
            console.log(`[Proxy]   LAN:   http://${this.lanIP}:${this.proxyPort}`);
        });

        this.server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`[Proxy] Port ${this.proxyPort} in use, trying ${this.proxyPort + 1}...`);
                this.proxyPort++;
                this.start();
            } else {
                console.error(`[Proxy] Server error: ${err.message}`);
            }
        });
    }

    /**
     * Add a route
     */
    addRoute(domain, port, projectId, projectName) {
        const target = `http://127.0.0.1:${port}`;
        const routeInfo = { target, port, projectId, name: projectName || domain };

        // Register by domain
        this.routes.set(domain.toLowerCase(), routeInfo);

        // Register by name for path-based routing
        const name = (projectName || domain.replace('.internal', '')).toLowerCase().replace(/[^a-z0-9-]/g, '-');
        this.nameToRoute.set(name, { ...routeInfo, domain });

        console.log(`[Proxy] Route added: ${domain} → ${target}`);
        console.log(`[Proxy]   Local:  http://${name}.localhost:${this.proxyPort}/`);
        console.log(`[Proxy]   LAN:    http://${name}.${this.lanIP}.nip.io:${this.proxyPort}/`);

        // Try to update hosts file (best effort)
        this._updateHostsFile();
    }

    /**
     * Remove a route
     */
    removeRoute(domain) {
        const route = this.routes.get(domain.toLowerCase());
        if (route) {
            const name = (route.name || domain.replace('.internal', '')).toLowerCase().replace(/[^a-z0-9-]/g, '-');
            this.nameToRoute.delete(name);
        }
        this.routes.delete(domain.toLowerCase());
        console.log(`[Proxy] Route removed: ${domain}`);
        this._updateHostsFile();
    }

    /**
     * Remove routes by project ID
     */
    removeRouteByProject(projectId) {
        for (const [domain, route] of this.routes.entries()) {
            if (route.projectId === projectId) {
                const name = (route.name || domain.replace('.internal', '')).toLowerCase().replace(/[^a-z0-9-]/g, '-');
                this.nameToRoute.delete(name);
                this.routes.delete(domain);
                console.log(`[Proxy] Route removed: ${domain}`);
            }
        }
        this._updateHostsFile();
    }

    /**
     * Get all routes with all access URLs (including LAN)
     */
    getAllRoutes() {
        const routes = {};
        for (const [domain, route] of this.routes.entries()) {
            const name = (route.name || domain.replace('.internal', '')).toLowerCase().replace(/[^a-z0-9-]/g, '-');
            routes[domain] = {
                target: route.target,
                port: route.port,
                projectId: route.projectId,
                name,
                urls: {
                    local: `http://${name}.localhost:${this.proxyPort}/`,
                    lan: `http://${name}.${this.lanIP}.nip.io:${this.proxyPort}/`,
                    direct: `http://localhost:${route.port}/`,
                    directLan: `http://${this.lanIP}:${route.port}/`,
                    legacyPath: `http://${this.lanIP}:${this.proxyPort}/${name}/`
                },
            };
        }
        return routes;
    }

    getProxyPort() {
        return this.proxyPort;
    }

    /**
     * Try to update hosts file (best effort, needs admin)
     */
    _updateHostsFile() {
        const isWindows = process.platform === 'win32';
        const hostsPath = isWindows
            ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
            : '/etc/hosts';

        try {
            let content = fs.readFileSync(hostsPath, 'utf8');

            const startMarker = '# === DeployDock Start ===';
            const endMarker = '# === DeployDock End ===';
            const startIdx = content.indexOf(startMarker);
            const endIdx = content.indexOf(endMarker);

            if (startIdx !== -1 && endIdx !== -1) {
                content = content.substring(0, startIdx) + content.substring(endIdx + endMarker.length);
            }

            if (this.routes.size > 0) {
                let entries = `\n${startMarker}\n`;
                for (const domain of this.routes.keys()) {
                    entries += `127.0.0.1    ${domain}\n`;
                }
                entries += `${endMarker}\n`;
                content = content.trimEnd() + entries;
            }

            fs.writeFileSync(hostsPath, content);
            console.log('[Proxy] Hosts file updated');
        } catch (err) {
            if (err.code === 'EPERM' || err.code === 'EACCES') {
                // Silently ignore - path-based routing works without hosts
            }
        }
    }

    _errorPage(host, message) {
        return `<!DOCTYPE html><html><head><title>DeployDock — Error</title>
    <style>body{font-family:'Inter',sans-serif;background:#0a0a0f;color:#f0f0f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .c{text-align:center;padding:40px}h1{color:#6366f1;font-size:2rem}p{color:#9495b0}code{background:#1a1a28;padding:4px 10px;border-radius:6px;color:#a78bfa}</style>
    </head><body><div class="c"><h1>🚢 Error</h1><p><code>${host}</code></p><p>${message}</p></div></body></html>`;
    }

    _generateDashboard(host, url) {
        const routeRows = Array.from(this.routes.entries()).map(([domain, route]) => {
            const name = (route.name || domain.replace('.internal', '')).toLowerCase().replace(/[^a-z0-9-]/g, '-');
            return `
        <tr>
          <td style="font-weight:600;color:#f0f0f5">${route.name || name}</td>
          <td>${route.port}</td>
          <td>
            <a href="http://${name}.localhost:${this.proxyPort}/">${name}.localhost:${this.proxyPort}</a>
          </td>
          <td>
            <a href="http://${name}.${this.lanIP}.nip.io:${this.proxyPort}/">${name}.${this.lanIP}.nip.io:${this.proxyPort}</a>
          </td>
          <td>
            <a href="http://${this.lanIP}:${route.port}/">${this.lanIP}:${route.port}</a>
          </td>
          <td><span style="color:#22c55e">● Active</span></td>
        </tr>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DeployDock — Proxy Gateway</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #0a0a0f; color: #f0f0f5; min-height: 100vh; padding: 40px;
      background-image: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.08), transparent); }
    .container { max-width: 1100px; margin: 0 auto; }
    h1 { font-size: 2.5rem; font-weight: 800; margin-bottom: 8px; }
    h1 span { background: linear-gradient(135deg, #6366f1, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: #9495b0; font-size: 1rem; margin-bottom: 12px; }
    .lan-info { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.25); padding: 12px 20px; border-radius: 10px; margin-bottom: 30px; display:flex; align-items:center; gap:12px; }
    .lan-info strong { color: #4ade80; }
    .lan-info code { background: #1a1a28; padding: 4px 12px; border-radius: 6px; color: #4ade80; font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; }
    .card { background: rgba(22,22,35,0.8); border: 1px solid rgba(99,102,241,0.15); border-radius: 16px; padding: 24px; margin-bottom: 24px; backdrop-filter: blur(10px); }
    .card h2 { font-size: 1.1rem; margin-bottom: 16px; color: #a78bfa; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid rgba(99,102,241,0.1); font-size: 0.82rem; }
    th { color: #5f6080; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
    td { font-family: 'JetBrains Mono', monospace; }
    a { color: #a78bfa; text-decoration: none; }
    a:hover { text-decoration: underline; color: #c4b5fd; }
    .tip { background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); border-radius: 10px; padding: 16px 20px; margin-top: 16px; }
    .tip h3 { color: #818cf8; font-size: 0.85rem; margin-bottom: 8px; }
    .tip p { color: #9495b0; font-size: 0.82rem; line-height: 1.7; }
    .tip code { background: #1a1a28; padding: 2px 8px; border-radius: 4px; color: #c4b5fd; font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; }
    .empty { text-align: center; padding: 60px 20px; color: #5f6080; }
    .empty h2 { font-size: 1.3rem; color: #9495b0; margin-bottom: 10px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 0.65rem; font-weight: 600; margin-left: 6px; }
    .badge-green { background: rgba(34,197,94,0.15); color: #4ade80; }
    .badge-blue { background: rgba(59,130,246,0.15); color: #60a5fa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚢 Deploy<span>Dock</span> Gateway</h1>
    <p class="subtitle">Reverse proxy gateway — share your projects across the network</p>

    <div class="lan-info">
      <span>📱</span>
      <span>Your <strong>LAN IP</strong> is <code>${this.lanIP}</code> — other devices on the same WiFi/network can use this to access your projects!</span>
    </div>

    <div class="card">
      <h2>📡 Deployed Projects</h2>
      ${this.routes.size > 0 ? `
        <table>
          <tr>
            <th>Project</th>
            <th>Port</th>
            <th>Local Access</th>
            <th>LAN Access <span class="badge badge-green">📱 Other Devices</span></th>
            <th>Direct LAN</th>
            <th>Status</th>
          </tr>
          ${routeRows}
        </table>
      ` : `
        <div class="empty">
          <h2>No projects deployed yet</h2>
          <p>Deploy a project from the DeployDock Dashboard to see routes here.</p>
          <p style="margin-top:10px"><a href="http://localhost:5500">Open Dashboard →</a></p>
        </div>
      `}
    </div>

    <div class="tip">
      <h3>📱 Access from another device (phone, tablet, laptop)</h3>
      <p>
        Make sure both devices are on the <strong>same WiFi / network</strong>, then open:<br><br>
        <strong>Dashboard:</strong> <code>http://${this.lanIP}:5500</code><br>
        <strong>Proxy Gateway:</strong> <code>http://${this.lanIP}:${this.proxyPort}</code><br>
        <strong>Any project:</strong> <code>http://&lt;project-name&gt;.${this.lanIP}.nip.io:${this.proxyPort}/</code>
      </p>
    </div>

    <div class="tip">
      <h3>💻 Access from this machine</h3>
      <p>
        <strong>Subdomain (Best):</strong> <code>http://project-name.localhost:${this.proxyPort}/</code><br>
        <strong>Path-based (Legacy):</strong> <code>http://localhost:${this.proxyPort}/project-name/</code>
      </p>
    </div>
  </div>
</body>
</html>`;
    }
}

module.exports = new ProxyManager();

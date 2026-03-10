const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class ProcessManager extends EventEmitter {
    constructor() {
        super();
        this.processes = new Map(); // projectId -> { process, status, logs }
        this.maxLogLines = 500;
    }

    /**
     * Install dependencies for a project
     */
    async installDependencies(projectId, projectPath, installCommand, env = {}) {
        return new Promise((resolve, reject) => {
            this._addLog(projectId, `📦 Installing dependencies: ${installCommand}`);
            this._updateStatus(projectId, 'installing');

            const [cmd, ...args] = installCommand.split(' ');
            const isWindows = process.platform === 'win32';

            const proc = spawn(isWindows ? 'cmd' : cmd, isWindows ? ['/c', installCommand] : args, {
                cwd: projectPath,
                env: { ...process.env, ...env },
            });

            proc.stdout.on('data', (data) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                lines.forEach(line => this._addLog(projectId, line));
            });

            proc.stderr.on('data', (data) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                lines.forEach(line => this._addLog(projectId, `⚠️ ${line}`));
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    this._addLog(projectId, '✅ Dependencies installed successfully');
                    resolve();
                } else {
                    this._addLog(projectId, `❌ Installation failed with code ${code}`);
                    this._updateStatus(projectId, 'error');
                    reject(new Error(`Install failed with code ${code}`));
                }
            });

            proc.on('error', (err) => {
                this._addLog(projectId, `❌ Installation error: ${err.message}`);
                this._updateStatus(projectId, 'error');
                reject(err);
            });
        });
    }

    /**
     * Start a project process
     */
    startProject(projectId, projectPath, startCommand, port, env = {}) {
        // Kill existing process if any
        this.stopProject(projectId);

        // Smart port injection: Vite/Next.js/CRA ignore PORT env var, 
        // so we need to inject --port and --host flags into the command
        let finalCommand = this._injectPortIntoCommand(startCommand, port, projectPath);

        this._addLog(projectId, `🚀 Starting project on port ${port}`);
        this._addLog(projectId, `📋 Command: ${finalCommand}`);
        this._updateStatus(projectId, 'starting');

        const isWindows = process.platform === 'win32';

        const processEnv = {
            ...process.env,
            ...env,
            PORT: port.toString(),
            HOST: '0.0.0.0',       // Bind to all interfaces for LAN access
            HOSTNAME: '0.0.0.0',
        };

        const proc = spawn(isWindows ? 'cmd' : 'sh', isWindows ? ['/c', finalCommand] : ['-c', finalCommand], {
            cwd: projectPath,
            env: processEnv,
        });

        const processInfo = {
            process: proc,
            status: 'starting',
            logs: this._getExistingLogs(projectId),
            port,
            startTime: new Date(),
        };

        this.processes.set(projectId, processInfo);

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => {
                this._addLog(projectId, line);
                // Detect when server is ready
                if (line.toLowerCase().includes('listening') ||
                    line.toLowerCase().includes('ready') ||
                    line.toLowerCase().includes('started') ||
                    line.toLowerCase().includes('local:') ||
                    line.toLowerCase().includes('server running')) {
                    this._updateStatus(projectId, 'running');
                }
            });
        });

        proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => this._addLog(projectId, `⚠️ ${line}`));
        });

        proc.on('close', (code) => {
            this._addLog(projectId, `Process exited with code ${code}`);
            this._updateStatus(projectId, code === 0 ? 'stopped' : 'crashed');
        });

        proc.on('error', (err) => {
            this._addLog(projectId, `❌ Process error: ${err.message}`);
            this._updateStatus(projectId, 'error');
        });

        // Set running status after a timeout if not already detected
        setTimeout(() => {
            const info = this.processes.get(projectId);
            if (info && info.status === 'starting') {
                this._updateStatus(projectId, 'running');
            }
        }, 10000);

        return proc;
    }

    /**
     * Send input (stdin) to a running project process
     */
    sendInput(projectId, input) {
        const info = this.processes.get(projectId);
        if (info && info.process && info.process.stdin) {
            try {
                // Ensure there is a newline if the command needs to execute
                const command = input.endsWith('\n') ? input : input + '\n';
                info.process.stdin.write(command);
                this._addLog(projectId, `> ${input}`);
                return true;
            } catch (err) {
                this._addLog(projectId, `Failed to send input: ${err.message}`);
                return false;
            }
        }
        return false;
    }

    /**
     * Stop a project process
     */
    stopProject(projectId) {
        const processInfo = this.processes.get(projectId);
        if (processInfo && processInfo.process) {
            this._addLog(projectId, '🛑 Stopping project...');
            const isWindows = process.platform === 'win32';

            if (isWindows) {
                spawn('taskkill', ['/pid', processInfo.process.pid, '/f', '/t'], { shell: true });
            } else {
                processInfo.process.kill('SIGTERM');
                setTimeout(() => {
                    try { processInfo.process.kill('SIGKILL'); } catch (e) { /* already dead */ }
                }, 5000);
            }

            this._updateStatus(projectId, 'stopped');
            processInfo.process = null;
        }
    }

    /**
     * Restart a project
     */
    restartProject(projectId, projectPath, startCommand, port, env = {}) {
        this.stopProject(projectId);
        setTimeout(() => {
            this.startProject(projectId, projectPath, startCommand, port, env);
        }, 2000);
    }

    /**
     * Get logs for a project
     */
    getLogs(projectId) {
        const processInfo = this.processes.get(projectId);
        return processInfo ? processInfo.logs : [];
    }

    /**
     * Get status for a project
     */
    getStatus(projectId) {
        const processInfo = this.processes.get(projectId);
        return processInfo ? processInfo.status : 'unknown';
    }

    /**
     * Remove a project from tracking
     */
    removeProject(projectId) {
        this.stopProject(projectId);
        this.processes.delete(projectId);
    }

    _getExistingLogs(projectId) {
        const processInfo = this.processes.get(projectId);
        return processInfo ? processInfo.logs : [];
    }

    _addLog(projectId, message) {
        let processInfo = this.processes.get(projectId);
        if (!processInfo) {
            processInfo = { process: null, status: 'unknown', logs: [], port: null, startTime: null };
            this.processes.set(projectId, processInfo);
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            message: message.trim(),
        };

        processInfo.logs.push(logEntry);

        // Trim logs if too many
        if (processInfo.logs.length > this.maxLogLines) {
            processInfo.logs = processInfo.logs.slice(-this.maxLogLines);
        }

        // Emit log event for WebSocket
        this.emit('log', { projectId, log: logEntry });
    }

    _updateStatus(projectId, status) {
        const processInfo = this.processes.get(projectId);
        if (processInfo) {
            processInfo.status = status;
        }
        this.emit('status', { projectId, status });
    }

    /**
     * Inject port and host into the start command based on project type.
     * Vite, Next.js, CRA etc. all ignore the PORT env variable,
     * so we must inject --port and --host flags directly.
     */
    _injectPortIntoCommand(startCommand, port, projectPath) {
        const fs = require('fs');
        const path = require('path');
        let cmd = startCommand;

        // Detect project type from package.json
        let isVite = false;
        let isNext = false;
        let isCRA = false;

        const pkgPath = path.join(projectPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
                isVite = !!allDeps?.vite;
                isNext = !!allDeps?.next;
                isCRA = !!allDeps?.['react-scripts'];
            } catch (e) { /* ignore */ }
        }

        // Also detect from the command itself
        if (cmd.includes('vite') || cmd.includes('npx vite')) {
            isVite = true;
        }
        if (cmd.includes('next')) {
            isNext = true;
        }
        if (cmd.includes('react-scripts')) {
            isCRA = true;
        }

        // Inject flags based on project type
        if (isVite) {
            // Remove any existing --port or --host flags
            cmd = cmd.replace(/--port\s+\d+/g, '').replace(/--host\s+[\w.]+/g, '').trim();

            // If command is "npm run dev" or "npm start", we need to add -- to pass flags
            if (cmd.startsWith('npm run') || cmd === 'npm start') {
                cmd = `${cmd} -- --port ${port} --host 0.0.0.0`;
            } else {
                cmd = `${cmd} --port ${port} --host 0.0.0.0`;
            }
        } else if (isNext) {
            cmd = cmd.replace(/-p\s+\d+/g, '').trim();
            if (cmd.startsWith('npm run') || cmd === 'npm start') {
                cmd = `${cmd} -- -p ${port}`;
            } else {
                cmd = `${cmd} -p ${port}`;
            }
        } else if (isCRA) {
            // CRA uses PORT env var, which we already set — but also set HOST
            // No flag injection needed, env vars work
        }

        return cmd;
    }
}

module.exports = new ProcessManager();

const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

// Whitelist of allowed commands for the restricted terminal
const ALLOWED_COMMAND_PREFIXES = [
    'npm install', 'npm i ', 'npm i\r', 'npm uninstall', 'npm update', 'npm audit',
    'npm list', 'npm ls', 'npm outdated', 'npm run build', 'npm run lint',
    'npm ci', 'npm cache', 'npm prune', 'npm dedupe',
    'yarn add', 'yarn remove', 'yarn install', 'yarn upgrade',
    'pnpm add', 'pnpm remove', 'pnpm install', 'pnpm update',
    'pip install', 'pip uninstall', 'pip freeze', 'pip list',
    'composer install', 'composer require', 'composer update',
    'bundle install', 'gem install',
    'cargo add', 'cargo install',
    'go get', 'go mod tidy',
];

class ProcessManager extends EventEmitter {
    constructor() {
        super();
        // projectId -> { process, status, logs (string), port, cmdProcess }
        this.processes = new Map();
        this.maxLogLength = 100000;
    }

    /**
     * Validate if a command is allowed in the restricted terminal
     */
    isCommandAllowed(command) {
        const trimmed = command.trim().toLowerCase();
        return ALLOWED_COMMAND_PREFIXES.some(prefix => trimmed.startsWith(prefix.toLowerCase()));
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

        let finalCommand = this._injectPortIntoCommand(startCommand, port, projectPath);

        this._addLog(projectId, `🚀 Starting project on port ${port}`);
        this._addLog(projectId, `📋 Command: ${finalCommand}`);
        this._updateStatus(projectId, 'starting');

        const isWindows = process.platform === 'win32';

        const processEnv = {
            ...process.env,
            ...env,
            PORT: port.toString(),
            HOST: '0.0.0.0',
            HOSTNAME: '0.0.0.0',
        };

        const proc = spawn(isWindows ? 'cmd' : 'sh', isWindows ? ['/c', finalCommand] : ['-c', finalCommand], {
            cwd: projectPath,
            env: processEnv,
        });

        const processInfo = this._getOrCreateInfo(projectId);
        processInfo.process = proc;
        processInfo.status = 'starting';
        processInfo.port = port;
        processInfo.startTime = new Date();

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => {
                this._addLog(projectId, line);
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
            processInfo.process = null;
        });

        proc.on('error', (err) => {
            this._addLog(projectId, `❌ Process error: ${err.message}`);
            this._updateStatus(projectId, 'error');
        });

        // Fallback timeout for running status
        setTimeout(() => {
            const info = this.processes.get(projectId);
            if (info && info.status === 'starting') {
                this._updateStatus(projectId, 'running');
            }
        }, 10000);

        return proc;
    }

    /**
     * Run a restricted command in the project terminal (only whitelisted commands)
     */
    runProjectCommand(projectId, projectPath, command) {
        if (!this.isCommandAllowed(command)) {
            this.emit('cmd-data', {
                projectId,
                data: `\x1b[31m❌ Command not allowed. Only dependency management commands are permitted.\x1b[0m\r\n` +
                      `\x1b[33mAllowed: npm install/uninstall, yarn add/remove, pip install, etc.\x1b[0m\r\n`
            });
            return false;
        }

        // Kill any existing command process for this project
        const info = this._getOrCreateInfo(projectId);
        if (info.cmdProcess) {
            try { info.cmdProcess.kill(); } catch (e) { /* ignore */ }
            info.cmdProcess = null;
        }

        const isWindows = process.platform === 'win32';

        this.emit('cmd-data', {
            projectId,
            data: `\x1b[36m$ ${command}\x1b[0m\r\n`
        });

        const proc = spawn(
            isWindows ? 'cmd' : 'sh',
            isWindows ? ['/c', command] : ['-c', command],
            {
                cwd: projectPath,
                env: { ...process.env },
            }
        );

        info.cmdProcess = proc;

        proc.stdout.on('data', (data) => {
            this.emit('cmd-data', { projectId, data: data.toString().replace(/\n/g, '\r\n') });
        });

        proc.stderr.on('data', (data) => {
            this.emit('cmd-data', { projectId, data: data.toString().replace(/\n/g, '\r\n') });
        });

        proc.on('close', (code) => {
            const msg = code === 0
                ? `\x1b[32m✅ Command completed successfully\x1b[0m\r\n`
                : `\x1b[31m❌ Command failed with exit code ${code}\x1b[0m\r\n`;
            this.emit('cmd-data', { projectId, data: msg });
            this.emit('cmd-complete', { projectId, code });
            info.cmdProcess = null;
        });

        proc.on('error', (err) => {
            this.emit('cmd-data', {
                projectId,
                data: `\x1b[31m❌ Error: ${err.message}\x1b[0m\r\n`
            });
            info.cmdProcess = null;
        });

        return true;
    }

    /**
     * Send input (stdin) to a running project process
     */
    sendInput(projectId, input) {
        const info = this.processes.get(projectId);
        if (info && info.process && info.process.stdin) {
            try {
                const command = input.endsWith('\n') ? input : input + '\n';
                info.process.stdin.write(command);
                return true;
            } catch (err) {
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
     * Get logs for a project (array of log entries)
     */
    getLogs(projectId) {
        const info = this.processes.get(projectId);
        return info ? info.logs : [];
    }

    /**
     * Get status for a project
     */
    getStatus(projectId) {
        const info = this.processes.get(projectId);
        return info ? info.status : 'unknown';
    }

    /**
     * Remove a project from tracking
     */
    removeProject(projectId) {
        this.stopProject(projectId);
        this.processes.delete(projectId);
    }

    _getOrCreateInfo(projectId) {
        let info = this.processes.get(projectId);
        if (!info) {
            info = { process: null, status: 'unknown', logs: [], port: null, startTime: null, cmdProcess: null };
            this.processes.set(projectId, info);
        }
        return info;
    }

    _addLog(projectId, message) {
        const info = this._getOrCreateInfo(projectId);

        const logEntry = {
            timestamp: new Date().toISOString(),
            message: message.trim(),
        };

        info.logs.push(logEntry);

        // Trim logs if too many
        if (info.logs.length > 500) {
            info.logs = info.logs.slice(-500);
        }

        // Emit log event for WebSocket
        this.emit('log', { projectId, log: logEntry });
    }

    _updateStatus(projectId, status) {
        const info = this._getOrCreateInfo(projectId);
        info.status = status;
        this.emit('status', { projectId, status });
    }

    /**
     * Inject port and host into the start command based on project type.
     */
    _injectPortIntoCommand(startCommand, port, projectPath) {
        const fs = require('fs');
        const path = require('path');
        let cmd = startCommand;

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

        if (cmd.includes('vite') || cmd.includes('npx vite')) isVite = true;
        if (cmd.includes('next')) isNext = true;
        if (cmd.includes('react-scripts')) isCRA = true;

        if (isVite) {
            cmd = cmd.replace(/--port\s+\d+/g, '').replace(/--host\s+[\w.]+/g, '').trim();
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
        }

        return cmd;
    }
}

module.exports = new ProcessManager();

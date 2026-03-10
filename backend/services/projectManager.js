const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const portManager = require('./portManager');
const processManager = require('./processManager');
const proxyManager = require('./proxyManager');

class ProjectManager {
    constructor() {
        this.projects = new Map();
        this.folders = new Set();
        this.projectsDir = path.join(__dirname, '..', 'projects');
        this.dataFile = path.join(__dirname, '..', 'data', 'projects.json');
        this.foldersFile = path.join(__dirname, '..', 'data', 'folders.json');

        // Ensure directories exist
        if (!fs.existsSync(this.projectsDir)) {
            fs.mkdirSync(this.projectsDir, { recursive: true });
        }
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Load existing projects from disk
        this._loadProjects();
        this._loadFolders();
    }

    /**
     * Extract a zip file and read its config
     */
    async extractAndConfigure(zipPath, originalName) {
        const projectId = uuidv4();
        const extractDir = path.join(this.projectsDir, projectId);

        // Create extraction directory
        fs.mkdirSync(extractDir, { recursive: true });

        // Extract zip
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);

        // Check if zip had a single root folder
        const contents = fs.readdirSync(extractDir);
        let projectRoot = extractDir;

        if (contents.length === 1) {
            const singleItem = path.join(extractDir, contents[0]);
            if (fs.statSync(singleItem).isDirectory()) {
                projectRoot = singleItem;
            }
        }

        // Look for deploy.config.json
        const configPath = path.join(projectRoot, 'deploy.config.json');
        let config = {};

        if (fs.existsSync(configPath)) {
            try {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } catch (e) {
                throw new Error('Invalid deploy.config.json: ' + e.message);
            }
        } else {
            // Try to auto-detect project type
            config = this._autoDetectConfig(projectRoot, originalName);
        }

        // Validate config
        if (!config.name) {
            config.name = originalName.replace('.zip', '').replace(/[^a-zA-Z0-9-_]/g, '-');
        }
        if (!config.installCommand) {
            config.installCommand = 'npm install';
        }
        if (!config.startCommand) {
            config.startCommand = 'npm start';
        }
        if (!config.port) {
            config.port = 3000;
        }
        if (!config.type) {
            config.type = 'unknown';
        }

        // Assign a port (auto-resolve conflicts)
        const desiredPort = config.port;
        const assignedPort = await portManager.findAvailablePort(desiredPort, projectId);

        // Generate internal domain
        const internalDomain = `${config.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.internal`;

        // Create project record
        const project = {
            id: projectId,
            name: config.name,
            type: config.type,
            internalDomain,
            originalZip: originalName,
            path: projectRoot,
            config,
            desiredPort,
            assignedPort,
            status: 'extracted',
            createdAt: new Date().toISOString(),
            env: config.env || {},
            folder: config.folder || '',
        };

        this.projects.set(projectId, project);
        this._saveProjects();

        // Cleanup zip file
        try {
            fs.unlinkSync(zipPath);
        } catch (e) { /* ignore */ }

        return project;
    }

    /**
     * Auto-detect project configuration
     */
    _autoDetectConfig(projectRoot, originalName) {
        const config = {
            name: originalName.replace('.zip', ''),
            type: 'unknown',
            installCommand: 'npm install',
            startCommand: 'npm start',
            port: 3000,
        };

        // Check for package.json
        const pkgPath = path.join(projectRoot, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

                if (pkg.name) config.name = pkg.name;

                // Detect Vite (frontend)
                if (pkg.dependencies?.vite || pkg.devDependencies?.vite) {
                    config.type = 'frontend';
                    config.startCommand = 'npx vite --host 0.0.0.0';
                    config.port = 5173;
                }
                // Detect Next.js
                else if (pkg.dependencies?.next || pkg.devDependencies?.next) {
                    config.type = 'frontend';
                    config.startCommand = 'npx next dev';
                    config.port = 3000;
                }
                // Detect React Scripts (CRA)
                else if (pkg.dependencies?.['react-scripts'] || pkg.devDependencies?.['react-scripts']) {
                    config.type = 'frontend';
                    config.startCommand = 'npx react-scripts start';
                    config.port = 3000;
                }
                // Detect Express (backend)
                else if (pkg.dependencies?.express) {
                    config.type = 'backend';
                    config.startCommand = pkg.scripts?.dev || pkg.scripts?.start || 'node index.js';
                    if (typeof config.startCommand === 'string' && config.startCommand.includes('nodemon')) {
                        config.startCommand = config.startCommand.replace('nodemon', 'node');
                    }
                    config.port = 3000;
                }

                // Use package.json scripts
                if (pkg.scripts?.dev) {
                    config.startCommand = 'npm run dev';
                } else if (pkg.scripts?.start) {
                    config.startCommand = 'npm start';
                }
            } catch (e) { /* ignore */ }
        }

        // Check for requirements.txt (Python)
        const reqPath = path.join(projectRoot, 'requirements.txt');
        if (fs.existsSync(reqPath)) {
            config.type = 'backend';
            config.installCommand = 'pip install -r requirements.txt';
            config.startCommand = 'python app.py';
            config.port = 5000;

            // Try to detect Flask/Django/FastAPI
            const appPy = path.join(projectRoot, 'app.py');
            const managePy = path.join(projectRoot, 'manage.py');
            const mainPy = path.join(projectRoot, 'main.py');

            if (fs.existsSync(managePy)) {
                config.startCommand = 'python manage.py runserver';
                config.port = 8000;
            } else if (fs.existsSync(mainPy)) {
                config.startCommand = 'python main.py';
            } else if (fs.existsSync(appPy)) {
                config.startCommand = 'python app.py';
            }
        }

        return config;
    }

    /**
     * Install dependencies and start a project
     */
    async deployProject(projectId) {
        const project = this.projects.get(projectId);
        if (!project) throw new Error('Project not found');

        try {
            // Install dependencies
            await processManager.installDependencies(
                projectId,
                project.path,
                project.config.installCommand,
                project.env
            );

            project.status = 'installed';
            this._saveProjects();

            // Start the project
            processManager.startProject(
                projectId,
                project.path,
                project.config.startCommand,
                project.assignedPort,
                project.env
            );

            project.status = 'running';
            this._saveProjects();

            // Register proxy route for internal domain
            proxyManager.addRoute(project.internalDomain, project.assignedPort, projectId, project.name);

            return project;
        } catch (error) {
            project.status = 'error';
            this._saveProjects();
            throw error;
        }
    }

    /**
     * Stop a project
     */
    stopProject(projectId) {
        const project = this.projects.get(projectId);
        if (!project) throw new Error('Project not found');

        processManager.stopProject(projectId);
        project.status = 'stopped';
        this._saveProjects();

        // Remove proxy route
        proxyManager.removeRoute(project.internalDomain);

        return project;
    }

    /**
     * Restart a project
     */
    async restartProject(projectId) {
        const project = this.projects.get(projectId);
        if (!project) throw new Error('Project not found');

        processManager.restartProject(
            projectId,
            project.path,
            project.config.startCommand,
            project.assignedPort,
            project.env
        );

        project.status = 'running';
        this._saveProjects();
        return project;
    }

    /**
     * Delete a project
     */
    deleteProject(projectId) {
        const project = this.projects.get(projectId);
        if (!project) throw new Error('Project not found');

        // Stop the process
        processManager.removeProject(projectId);

        // Release the port
        portManager.releasePort(projectId);

        // Remove proxy route
        proxyManager.removeRouteByProject(projectId);

        // Remove project directory
        try {
            fs.rmSync(project.path, { recursive: true, force: true });
            // Also remove parent dir if it's the UUID dir
            const parentDir = path.join(this.projectsDir, projectId);
            if (fs.existsSync(parentDir)) {
                fs.rmSync(parentDir, { recursive: true, force: true });
            }
        } catch (e) { /* ignore */ }

        this.projects.delete(projectId);
        this._saveProjects();
    }

    /**
     * Update project folder
     */
    updateProjectFolder(projectId, folderName) {
        const project = this.projects.get(projectId);
        if (!project) throw new Error('Project not found');

        project.folder = folderName || '';
        if (folderName) {
            this.createFolder(folderName);
        }
        this._saveProjects();
        return project;
    }

    /**
     * Folder Management
     */
    createFolder(name) {
        if (!name) return;
        this.folders.add(name);
        this._saveFolders();
    }

    deleteFolder(name) {
        if (this.folders.has(name)) {
            this.folders.delete(name);
            this._saveFolders();

            // Un-categorize projects in this folder
            for (const [id, project] of this.projects.entries()) {
                if (project.folder === name) {
                    project.folder = '';
                }
            }
            this._saveProjects();
        }
    }

    getFolders() {
        return Array.from(this.folders);
    }

    /**
     * Get all projects
     */
    getAllProjects() {
        const projects = [];
        for (const [id, project] of this.projects.entries()) {
            projects.push({
                ...project,
                status: processManager.getStatus(id) || project.status,
                logs: processManager.getLogs(id).slice(-20),
            });
        }
        return projects;
    }

    /**
     * Auto deploy all existing projects sequentially
     */
    async autoDeployAllProjects() {
        const projectIds = Array.from(this.projects.keys());
        for (const id of projectIds) {
            try {
                console.log(`[ProjectManager] Auto-redeploying project ${id}...`);
                await this.deployProject(id);
            } catch (error) {
                console.error(`[ProjectManager] Auto-redeploy failed for project ${id}:`, error.message);
            }
        }
    }

    /**
     * Get a single project
     */
    getProject(projectId) {
        const project = this.projects.get(projectId);
        if (!project) return null;
        return {
            ...project,
            status: processManager.getStatus(projectId) || project.status,
            logs: processManager.getLogs(projectId),
        };
    }

    /**
     * Save projects to disk
     */
    _saveProjects() {
        const data = {};
        for (const [id, project] of this.projects.entries()) {
            data[id] = { ...project };
        }
        fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
    }

    /**
     * Load projects from disk
     */
    _loadProjects() {
        if (fs.existsSync(this.dataFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
                for (const [id, project] of Object.entries(data)) {
                    this.projects.set(id, project);
                    // Re-register port assignments
                    if (project.assignedPort) {
                        portManager.assignPort(project.assignedPort, id);
                    }
                }
            } catch (e) {
                console.error('Failed to load projects.json:', e);
            }
        }
    }

    _loadFolders() {
        if (fs.existsSync(this.foldersFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.foldersFile, 'utf8'));
                if (Array.isArray(data)) {
                    this.folders = new Set(data);
                }
            } catch (e) {
                console.error('Failed to load folders.json:', e);
            }
        }

        // Auto-add any folders that exist in projects but not in folders set
        let added = false;
        for (const [id, project] of this.projects.entries()) {
            if (project.folder && !this.folders.has(project.folder)) {
                this.folders.add(project.folder);
                added = true;
            }
        }
        if (added) {
            this._saveFolders();
        }
    }

    _saveFolders() {
        fs.writeFileSync(this.foldersFile, JSON.stringify(Array.from(this.folders), null, 2));
    }
}

module.exports = new ProjectManager();

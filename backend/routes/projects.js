const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const projectManager = require('../services/projectManager');
const processManager = require('../services/processManager');
const portManager = require('../services/portManager');

// Configure multer for zip uploads
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' ||
            file.mimetype === 'application/x-zip-compressed' ||
            file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Only .zip files are allowed'), false);
        }
    },
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});

// Upload and extract a project
router.post('/upload', upload.single('project'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No zip file uploaded' });
        }

        const project = await projectManager.extractAndConfigure(
            req.file.path,
            req.file.originalname
        );

        res.json({
            success: true,
            message: 'Project uploaded and configured',
            project
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deploy (install + start) a project
router.post('/:id/deploy', async (req, res) => {
    try {
        const project = await projectManager.deployProject(req.params.id);
        res.json({ success: true, message: 'Deployment started', project });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Stop a project
router.post('/:id/stop', (req, res) => {
    try {
        const project = projectManager.stopProject(req.params.id);
        res.json({ success: true, message: 'Project stopped', project });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Restart a project
router.post('/:id/restart', async (req, res) => {
    try {
        const project = await projectManager.restartProject(req.params.id);
        res.json({ success: true, message: 'Project restarting', project });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a project
router.delete('/:id', (req, res) => {
    try {
        projectManager.deleteProject(req.params.id);
        res.json({ success: true, message: 'Project deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all projects
router.get('/', (req, res) => {
    try {
        const projects = projectManager.getAllProjects();
        res.json({ success: true, projects });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get a single project
router.get('/:id', (req, res) => {
    try {
        const project = projectManager.getProject(req.params.id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json({ success: true, project });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get logs for a project
router.get('/:id/logs', (req, res) => {
    try {
        const logs = processManager.getLogs(req.params.id);
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get port assignments
router.get('/system/ports', (req, res) => {
    try {
        const assignments = portManager.getAllAssignments();
        res.json({ success: true, ports: assignments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- File Management Routes ---

// Helper to safely resolve paths within project
const resolveSafePath = (projectPath, requestPath) => {
    const safePath = path.resolve(projectPath, requestPath || '.');
    if (!safePath.startsWith(path.resolve(projectPath))) {
        throw new Error('Invalid path: Directory traversal detected');
    }
    return safePath;
};

// Get files in directory
router.get('/:id/files', (req, res) => {
    try {
        const project = projectManager.getProject(req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const targetPath = resolveSafePath(project.path, req.query.path);

        if (!fs.existsSync(targetPath)) {
            return res.status(404).json({ error: 'Path not found' });
        }

        const stats = fs.statSync(targetPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory' });
        }

        const items = fs.readdirSync(targetPath, { withFileTypes: true });
        const files = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            path: path.relative(project.path, path.join(targetPath, item.name)).replace(/\\/g, '/'),
            size: item.isDirectory() ? 0 : fs.statSync(path.join(targetPath, item.name)).size
        }));

        // Sort directories first, then alphabetically
        files.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) {
                return a.name.localeCompare(b.name);
            }
            return a.isDirectory ? -1 : 1;
        });

        res.json({ success: true, files });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get file content
router.get('/:id/file', (req, res) => {
    try {
        const project = projectManager.getProject(req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        if (!req.query.path) {
            return res.status(400).json({ error: 'Path parameter is required' });
        }

        const targetPath = resolveSafePath(project.path, req.query.path);

        if (!fs.existsSync(targetPath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const stats = fs.statSync(targetPath);
        if (stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is a directory, not a file' });
        }

        // Avoid sending large files or binary files
        if (stats.size > 5 * 1024 * 1024) { // 5MB limit
            return res.status(400).json({ error: 'File is too large to view' });
        }

        const content = fs.readFileSync(targetPath, 'utf8');
        res.json({ success: true, content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update file content
router.put('/:id/file', express.json({ limit: '5mb' }), (req, res) => {
    try {
        const project = projectManager.getProject(req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        if (!req.query.path) {
            return res.status(400).json({ error: 'Path parameter is required' });
        }

        const targetPath = resolveSafePath(project.path, req.query.path);

        if (!fs.existsSync(targetPath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const stats = fs.statSync(targetPath);
        if (stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is a directory, cannot overwrite' });
        }

        fs.writeFileSync(targetPath, req.body.content, 'utf8');
        res.json({ success: true, message: 'File saved successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const dbManager = require('../services/dbManager');
const projectManager = require('../services/projectManager');

// Save DB config to a project and attempt connection
router.post('/:projectId/connect', async (req, res) => {
    try {
        const { projectId } = req.params;
        const config = req.body; // { type, host, port, user, password, database }

        const project = projectManager.getProject(projectId);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Test connection
        await dbManager.connect(projectId, config);

        // If successful, save config to project
        projectManager.updateProjectDatabase(projectId, config);

        res.json({ success: true, message: 'Connected successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Disconnect
router.post('/:projectId/disconnect', async (req, res) => {
    try {
        const { projectId } = req.params;
        await dbManager.disconnect(projectId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get tables/collections
router.get('/:projectId/tables', async (req, res) => {
    try {
        const { projectId } = req.params;
        const tables = await dbManager.getTables(projectId);
        res.json({ success: true, tables });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get data for a specific table
router.get('/:projectId/tables/:tableName', async (req, res) => {
    try {
        const { projectId, tableName } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        const data = await dbManager.getTableData(projectId, tableName, limit);
        const primaryKeys = await dbManager.getPrimaryKeys(projectId, tableName);
        res.json({ success: true, data, primaryKeys });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get primary keys for a table
router.get('/:projectId/tables/:tableName/keys', async (req, res) => {
    try {
        const { projectId, tableName } = req.params;
        const primaryKeys = await dbManager.getPrimaryKeys(projectId, tableName);
        res.json({ success: true, primaryKeys });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update a cell value
router.put('/:projectId/tables/:tableName/row', async (req, res) => {
    try {
        const { projectId, tableName } = req.params;
        const { primaryKeyValues, columnName, newValue } = req.body;

        if (!primaryKeyValues || !columnName) {
            return res.status(400).json({ error: 'primaryKeyValues and columnName are required' });
        }

        const result = await dbManager.updateRow(projectId, tableName, primaryKeyValues, columnName, newValue);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a row
router.delete('/:projectId/tables/:tableName/row', async (req, res) => {
    try {
        const { projectId, tableName } = req.params;
        const { primaryKeyValues } = req.body;

        if (!primaryKeyValues) {
            return res.status(400).json({ error: 'primaryKeyValues is required' });
        }

        const result = await dbManager.deleteRow(projectId, tableName, primaryKeyValues);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Execute a raw query
router.post('/:projectId/query', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { query } = req.body;
        
        if (!query) return res.status(400).json({ error: 'Query is required' });

        const result = await dbManager.runQuery(projectId, query);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Import an SQL dump
router.post('/:projectId/import', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { sqlContent } = req.body;

        if (!sqlContent) return res.status(400).json({ error: 'SQL content is required' });

        const result = await dbManager.importDump(projectId, sqlContent);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

const mysql = require('mysql2/promise');
const { Client: PgClient } = require('pg');
const { MongoClient } = require('mongodb');

class DbManager {
    constructor() {
        // Store active connections: projectId -> { type, client }
        this.connections = new Map();
    }

    async connect(projectId, config) {
        // If already connected, disconnect first
        await this.disconnect(projectId);

        const { type, host, port, user, password, database, name } = config;
        let client;

        try {
            if (type === 'mysql') {
                client = await mysql.createConnection({
                    host: host || 'localhost',
                    port: port || 3306,
                    user,
                    password,
                    database,
                    multipleStatements: true // for dump imports
                });
            } else if (type === 'postgres') {
                client = new PgClient({
                    host: host || 'localhost',
                    port: port || 5432,
                    user,
                    password,
                    database
                });
                await client.connect();
            } else if (type === 'mongodb') {
                const url = `mongodb://${user ? `${user}:${password}@` : ''}${host || 'localhost'}:${port || 27017}/${database || ''}?authSource=admin`;
                client = new MongoClient(url);
                await client.connect();
            } else {
                throw new Error(`Unsupported database type: ${type}`);
            }

            this.connections.set(projectId, { type, client, database: database || 'test' });
            return true;
        } catch (error) {
            console.error(`[DbManager] Failed to connect project ${projectId} to ${type}:`, error);
            throw error;
        }
    }

    async disconnect(projectId) {
        const conn = this.connections.get(projectId);
        if (conn) {
            try {
                if (conn.type === 'mysql') await conn.client.end();
                else if (conn.type === 'postgres') await conn.client.end();
                else if (conn.type === 'mongodb') await conn.client.close();
            } catch (err) {
                console.error(`[DbManager] Error disconnecting ${projectId}:`, err);
            }
            this.connections.delete(projectId);
        }
    }

    async getTables(projectId) {
        const conn = this.connections.get(projectId);
        if (!conn) throw new Error('Not connected to database');

        if (conn.type === 'mysql') {
            const [rows] = await conn.client.query('SHOW TABLES');
            return rows.map(r => Object.values(r)[0]);
        } else if (conn.type === 'postgres') {
            const result = await conn.client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
            `);
            return result.rows.map(r => r.table_name);
        } else if (conn.type === 'mongodb') {
            const db = conn.client.db(conn.database);
            const collections = await db.collections();
            return collections.map(c => c.collectionName);
        }
    }

    async getTableData(projectId, tableName, limit = 100) {
        const conn = this.connections.get(projectId);
        if (!conn) throw new Error('Not connected to database');

        if (conn.type === 'mysql') {
            const [rows] = await conn.client.query(`SELECT * FROM ?? LIMIT ?`, [tableName, limit]);
            return rows;
        } else if (conn.type === 'postgres') {
            // Need to quote table name in postgres to avoid case issues
            const result = await conn.client.query(`SELECT * FROM "${tableName}" LIMIT $1`, [limit]);
            return result.rows;
        } else if (conn.type === 'mongodb') {
            const db = conn.client.db(conn.database);
            const data = await db.collection(tableName).find().limit(limit).toArray();
            return data;
        }
    }

    async runQuery(projectId, query) {
        const conn = this.connections.get(projectId);
        if (!conn) throw new Error('Not connected to database');

        if (conn.type === 'mysql') {
            const [rows] = await conn.client.query(query);
            return rows;
        } else if (conn.type === 'postgres') {
            const result = await conn.client.query(query);
            return result.rows;
        } else if (conn.type === 'mongodb') {
            // Very unsafe/raw way to run mongo queries. Typically users provide standard JSON filter/command.
            // For a unified UI, a generic "runCommand" is safer.
            try {
                // If it's pure JSON, attempt to run as a command.
                const cmd = JSON.parse(query);
                const db = conn.client.db(conn.database);
                const result = await db.command(cmd);
                return [result];
            } catch (err) {
                throw new Error("MongoDB queries should be valid JSON command objects (e.g. {\"ping\": 1})");
            }
        }
    }

    async importDump(projectId, sqlContent) {
        const conn = this.connections.get(projectId);
        if (!conn) throw new Error('Not connected to database');

        if (conn.type === 'mysql') {
            await conn.client.query(sqlContent);
            return { success: true };
        } else if (conn.type === 'postgres') {
            await conn.client.query(sqlContent);
            return { success: true };
        } else if (conn.type === 'mongodb') {
            throw new Error('Mongo dump import not yet supported directly via string format (needs mongorestore or BSON parsing)');
        }
    }
}

module.exports = new DbManager();

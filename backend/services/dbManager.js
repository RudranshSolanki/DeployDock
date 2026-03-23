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
            const result = await conn.client.query(`SELECT * FROM "${tableName}" LIMIT $1`, [limit]);
            return result.rows;
        } else if (conn.type === 'mongodb') {
            const db = conn.client.db(conn.database);
            const data = await db.collection(tableName).find().limit(limit).toArray();
            return data;
        }
    }

    /**
     * Get primary key columns for a table (used for building WHERE clauses)
     */
    async getPrimaryKeys(projectId, tableName) {
        const conn = this.connections.get(projectId);
        if (!conn) throw new Error('Not connected to database');

        if (conn.type === 'mysql') {
            const [rows] = await conn.client.query(
                `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'`,
                [tableName]
            );
            return rows.map(r => r.COLUMN_NAME);
        } else if (conn.type === 'postgres') {
            const result = await conn.client.query(`
                SELECT a.attname AS column_name
                FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                WHERE i.indrelid = '"${tableName}"'::regclass AND i.indisprimary
            `);
            return result.rows.map(r => r.column_name);
        } else if (conn.type === 'mongodb') {
            return ['_id'];
        }
    }

    /**
     * Update a specific cell/field in a row
     */
    async updateRow(projectId, tableName, primaryKeyValues, columnName, newValue) {
        const conn = this.connections.get(projectId);
        if (!conn) throw new Error('Not connected to database');

        if (conn.type === 'mysql') {
            const whereClauses = Object.keys(primaryKeyValues).map(k => `\`${k}\` = ?`).join(' AND ');
            const whereValues = Object.values(primaryKeyValues);
            const query = `UPDATE \`${tableName}\` SET \`${columnName}\` = ? WHERE ${whereClauses} LIMIT 1`;
            const [result] = await conn.client.query(query, [newValue, ...whereValues]);
            return { affectedRows: result.affectedRows };
        } else if (conn.type === 'postgres') {
            const keys = Object.keys(primaryKeyValues);
            const whereClauses = keys.map((k, i) => `"${k}" = $${i + 2}`).join(' AND ');
            const whereValues = Object.values(primaryKeyValues);
            const query = `UPDATE "${tableName}" SET "${columnName}" = $1 WHERE ${whereClauses}`;
            const result = await conn.client.query(query, [newValue, ...whereValues]);
            return { affectedRows: result.rowCount };
        } else if (conn.type === 'mongodb') {
            const db = conn.client.db(conn.database);
            const { ObjectId } = require('mongodb');
            // Convert _id string to ObjectId if it looks like one
            const filter = {};
            for (const [k, v] of Object.entries(primaryKeyValues)) {
                if (k === '_id' && typeof v === 'string' && /^[a-f\d]{24}$/i.test(v)) {
                    filter[k] = new ObjectId(v);
                } else {
                    filter[k] = v;
                }
            }
            const result = await db.collection(tableName).updateOne(filter, { $set: { [columnName]: newValue } });
            return { affectedRows: result.modifiedCount };
        }
    }

    /**
     * Delete a row
     */
    async deleteRow(projectId, tableName, primaryKeyValues) {
        const conn = this.connections.get(projectId);
        if (!conn) throw new Error('Not connected to database');

        if (conn.type === 'mysql') {
            const whereClauses = Object.keys(primaryKeyValues).map(k => `\`${k}\` = ?`).join(' AND ');
            const whereValues = Object.values(primaryKeyValues);
            const query = `DELETE FROM \`${tableName}\` WHERE ${whereClauses} LIMIT 1`;
            const [result] = await conn.client.query(query, whereValues);
            return { affectedRows: result.affectedRows };
        } else if (conn.type === 'postgres') {
            const keys = Object.keys(primaryKeyValues);
            const whereClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ');
            const whereValues = Object.values(primaryKeyValues);
            const query = `DELETE FROM "${tableName}" WHERE ${whereClauses}`;
            const result = await conn.client.query(query, whereValues);
            return { affectedRows: result.rowCount };
        } else if (conn.type === 'mongodb') {
            const db = conn.client.db(conn.database);
            const { ObjectId } = require('mongodb');
            const filter = {};
            for (const [k, v] of Object.entries(primaryKeyValues)) {
                if (k === '_id' && typeof v === 'string' && /^[a-f\d]{24}$/i.test(v)) {
                    filter[k] = new ObjectId(v);
                } else {
                    filter[k] = v;
                }
            }
            const result = await db.collection(tableName).deleteOne(filter);
            return { affectedRows: result.deletedCount };
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

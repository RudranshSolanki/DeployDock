import * as api from './api.js';

let proxyPort = 8080;
let lanIP = '';
let project = null;

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('id');

    if (!projectId) {
        showError();
        return;
    }

    try {
        // Fetch project and proxy info
        const [projReq, proxyInfo] = await Promise.all([
            api.fetchProject(projectId),
            api.fetchProxyInfo().catch(() => ({ proxyPort: 8080, lanIP: '' }))
        ]);

        project = projReq;
        proxyPort = proxyInfo.proxyPort;
        lanIP = proxyInfo.lanIP || '';

        renderProjectDetails();
    } catch (e) {
        console.error(e);
        showError();
    }
});

function showError() {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('error-state').style.display = 'block';
}

function renderProjectDetails() {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';

    const cleanedName = escapeHtml((project.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-'));

    // Populate header
    document.getElementById('project-title').textContent = project.name || 'Unnamed';
    document.getElementById('project-id').textContent = `ID: ${project.id}`;

    const typeBadge = document.getElementById('project-type');
    typeBadge.textContent = project.type || 'unknown';
    typeBadge.className = `project-type-badge ${project.type || 'unknown'}`;

    const statusBadge = document.getElementById('project-status');
    const statusText = document.getElementById('project-status-text');
    statusBadge.className = `project-status ${project.status || 'unknown'}`;
    statusText.textContent = project.status || 'unknown';

    document.getElementById('refresh-btn').onclick = () => window.location.reload();

    // URLs
    const localUrl = `http://${cleanedName}.localhost:${proxyPort}/`;
    const lanUrl = lanIP ? `http://${cleanedName}.${lanIP}.nip.io:${proxyPort}/` : '';
    const directUrl = `http://localhost:${project.assignedPort}`;

    const urlLocalEl = document.getElementById('url-local');
    urlLocalEl.textContent = localUrl;
    urlLocalEl.href = localUrl;
    document.querySelector('.copy-btn-local').onclick = (e) => copyHelper(localUrl, e.currentTarget);

    const urlDirectEl = document.getElementById('url-direct');
    urlDirectEl.textContent = directUrl;
    urlDirectEl.href = directUrl;
    document.querySelector('.copy-btn-direct').onclick = (e) => copyHelper(directUrl, e.currentTarget);

    const urlLanEl = document.getElementById('url-lan');
    const lanCopyBtn = document.querySelector('.copy-btn-lan');
    if (lanIP) {
        urlLanEl.textContent = lanUrl;
        urlLanEl.href = lanUrl;
        lanCopyBtn.onclick = (e) => copyHelper(lanUrl, e.currentTarget);

        // Generate QR code for LAN URL
        new QRCode(document.getElementById("qrcode"), {
            text: lanUrl,
            width: 160,
            height: 160,
            colorDark: "#11111b",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    } else {
        urlLanEl.textContent = 'LAN IP not detected';
        urlLanEl.href = '#';
        urlLanEl.style.color = 'var(--text-muted)';
        lanCopyBtn.style.display = 'none';
        document.getElementById('qrcode').innerHTML = '<p style="color:var(--text-muted);text-align:center;">No LAN connectivity</p>';
    }

    // Initialize Editor and Logs
    setTimeout(() => {
        initEditor();
        connectWebSocket();
    }, 100);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function copyHelper(text, btnElement) {
    navigator.clipboard.writeText(text).then(() => {
        const originalHtml = btnElement.innerHTML;
        btnElement.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        btnElement.classList.add('copied');
        showToast('URL copied to clipboard', 'success');
        setTimeout(() => {
            btnElement.innerHTML = originalHtml;
            btnElement.classList.remove('copied');
        }, 1500);
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
    };

    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- Editor and File Explorer Logic ---

let editor = null;
let currentFilePath = null;
let currentFiles = [];

function initEditor() {
    if (editor) return; // already initialized

    try {
        if (typeof ace === 'undefined') {
            console.error('Ace editor not loaded');
            document.getElementById('file-tree').innerHTML = '<div style="color: var(--error); padding: 12px;">Editor failed to load. Check your network connection.</div>';
            return;
        }

        ace.require("ace/ext/language_tools");
        editor = ace.edit("code-editor");
        editor.setTheme("ace/theme/tomorrow_night");
        editor.setOptions({
            fontSize: "14px",
            showPrintMargin: false,
            wrap: true
        });

        document.getElementById('refresh-files-btn').onclick = () => loadFiles('');

        document.getElementById('save-file-btn').onclick = async () => {
            if (!currentFilePath) return;
            const btn = document.getElementById('save-file-btn');
            btn.textContent = 'Saving...';
            btn.disabled = true;

            try {
                await api.saveFileContent(project.id, currentFilePath, editor.getValue());
                showToast('File saved successfully', 'success');
            } catch (error) {
                console.error(error);
                showToast('Failed to save file', 'error');
            } finally {
                btn.textContent = 'Save Changes';
                btn.disabled = false;
            }
        };

        // Keyboard shortcut for saving
        editor.commands.addCommand({
            name: 'save',
            bindKey: { win: "Ctrl-S", "mac": "Cmd-S" },
            exec: function (editor) {
                document.getElementById('save-file-btn').click();
            }
        });

        // Start by loading the root directory
        loadFiles('');
    } catch (err) {
        console.error('Failed to init editor:', err);
        document.getElementById('file-tree').innerHTML = '<div style="color: var(--error); padding: 12px;">Editor init failed: ' + err.message + '</div>';
    }
}

async function loadFiles(path = '') {
    const treeEl = document.getElementById('file-tree');
    if (path === '') {
        treeEl.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px 0;">Loading...</div>';
    }

    try {
        const files = await api.fetchProjectFiles(project.id, path);
        currentFiles = files;
        renderFiles(path, files);
    } catch (error) {
        console.error(error);
        if (path === '') {
            treeEl.innerHTML = '<div style="color: var(--error); text-align: center; padding: 20px 0;">Failed to load files</div>';
        } else {
            showToast('Failed to open directory', 'error');
        }
    }
}

function renderFiles(currentPath, files) {
    const treeEl = document.getElementById('file-tree');
    treeEl.innerHTML = '';

    if (currentPath !== '') {
        const parentPath = currentPath.split('/').slice(0, -1).join('/');
        const upEl = document.createElement('div');
        upEl.className = 'file-tree-item directory';
        upEl.innerHTML = `
            <div class="file-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>
                </svg>
            </div>
            <span>.. (up)</span>
        `;
        upEl.onclick = () => loadFiles(parentPath);
        treeEl.appendChild(upEl);
    }

    if (files.length === 0) {
        treeEl.innerHTML += '<div style="color: var(--text-muted); padding: 8px;">Empty folder</div>';
        return;
    }

    files.forEach(file => {
        const el = document.createElement('div');
        el.className = `file-tree-item ${file.isDirectory ? 'directory' : ''} ${file.path === currentFilePath ? 'active' : ''}`;

        let iconHtml = '';
        if (file.isDirectory) {
            iconHtml = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
        } else {
            iconHtml = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
        }

        el.innerHTML = `
            <div class="file-icon">${iconHtml}</div>
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${file.name}">${file.name}</span>
        `;

        el.onclick = () => {
            if (file.isDirectory) {
                loadFiles(file.path);
            } else {
                openFile(file.path, file.name);
                document.querySelectorAll('.file-tree-item').forEach(i => i.classList.remove('active'));
                el.classList.add('active');
            }
        };

        treeEl.appendChild(el);
    });
}

async function openFile(path, name) {
    document.getElementById('editor-placeholder').style.display = 'none';
    const editorEl = document.getElementById('code-editor');
    editorEl.style.display = 'block';
    editorEl.style.opacity = '0.5';

    document.getElementById('current-file-name').textContent = 'Loading...';

    try {
        const content = await api.fetchFileContent(project.id, path);

        currentFilePath = path;
        document.getElementById('current-file-name').textContent = path;

        editor.setValue(content, -1);

        const modelist = ace.require("ace/ext/modelist");
        const mode = modelist.getModeForPath(name).mode;
        editor.session.setMode(mode);

        document.getElementById('save-file-btn').disabled = false;
    } catch (error) {
        console.error(error);
        showToast('Failed to read file. It might be too large or binary.', 'error');
        document.getElementById('editor-placeholder').style.display = 'flex';
        document.getElementById('editor-placeholder').textContent = 'Failed to load file.';
        editorEl.style.display = 'none';
        document.getElementById('current-file-name').textContent = 'Select a file';
        currentFilePath = null;
        document.getElementById('save-file-btn').disabled = true;
    } finally {
        editorEl.style.opacity = '1';
    }
}

// --- Live Logs & Terminal Logic ---

let ws = null;
let reconnectInterval = null;

function connectWebSocket() {
    if (ws) return;

    try {
        ws = api.createWebSocket();

        ws.onopen = () => {
            if (project && project.id) {
                ws.send(JSON.stringify({ type: 'subscribe', projectId: project.id }));
            }
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'log' && msg.projectId === project.id) {
                    appendLogEntry(msg.log);
                }

                if (msg.type === 'logs_history' && msg.projectId === project.id) {
                    if (Array.isArray(msg.logs)) {
                        renderLogEntries(msg.logs);
                    }
                }

                if (msg.type === 'cmd-data' && msg.projectId === project.id) {
                    appendProjectTerminalOutput(msg.data);
                }

                if (msg.type === 'status' && msg.projectId === project.id) {
                    project.status = msg.status;
                    const statusBadge = document.getElementById('project-status');
                    const statusText = document.getElementById('project-status-text');
                    if (statusBadge && statusText) {
                        statusBadge.className = `project-status ${msg.status}`;
                        statusText.textContent = msg.status;
                    }
                }
            } catch (e) { /* ignore */ }
        };

        ws.onclose = () => {
            ws = null;
            if (!reconnectInterval) {
                reconnectInterval = setTimeout(() => {
                    reconnectInterval = null;
                    connectWebSocket();
                }, 3000);
            }
        };
    } catch (e) {
        console.error('WebSocket connection failed:', e);
    }
}

// --- Logs Tab ---

function renderLogEntries(logs) {
    const container = document.getElementById('project-log-entries');
    if (!container) return;
    container.innerHTML = logs.map(createLogEntryHtml).join('');
    autoScrollLogs();
}

function appendLogEntry(log) {
    const container = document.getElementById('project-log-entries');
    if (!container) return;

    // Remove placeholder
    if (container.innerHTML.includes('Connecting to log stream')) {
        container.innerHTML = '';
    }

    container.insertAdjacentHTML('beforeend', createLogEntryHtml(log));
    autoScrollLogs();
}

function createLogEntryHtml(log) {
    const time = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });
    let msgClass = '';
    if (log.message.includes('❌') || log.message.toLowerCase().includes('error')) {
        msgClass = 'color: #ef4444;';
    } else if (log.message.includes('✅') || log.message.toLowerCase().includes('success')) {
        msgClass = 'color: #22c55e;';
    } else if (log.message.includes('⚠️') || log.message.toLowerCase().includes('warn')) {
        msgClass = 'color: #f59e0b;';
    } else {
        msgClass = 'color: #a1a1aa;';
    }

    return `
      <div style="margin-bottom: 4px; display: flex; gap: 12px; word-break: break-all;">
        <span style="color: #52525b; flex-shrink: 0;">[${time}]</span>
        <span style="${msgClass}">${escapeHtml(log.message)}</span>
      </div>
    `;
}

function autoScrollLogs() {
    const autoScroll = document.getElementById('auto-scroll-logs');
    if (autoScroll && autoScroll.checked) {
        const container = document.getElementById('project-log-container');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }
}

// --- Terminal Tab ---

function ansiToHtml(text) {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\x1b\[31m/g, '<span style="color:#ef4444">')
        .replace(/\x1b\[32m/g, '<span style="color:#22c55e">')
        .replace(/\x1b\[33m/g, '<span style="color:#f59e0b">')
        .replace(/\x1b\[34m/g, '<span style="color:#3b82f6">')
        .replace(/\x1b\[35m/g, '<span style="color:#a855f7">')
        .replace(/\x1b\[36m/g, '<span style="color:#06b6d4">')
        .replace(/\x1b\[0m/g, '</span>')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/\r\n/g, '<br>').replace(/\n/g, '<br>');
}

function appendProjectTerminalOutput(data) {
    const container = document.getElementById('project-terminal-output');
    if (!container) return;

    if (container.querySelector('[style*="color: var(--text-muted)"]')) {
        container.innerHTML = '';
    }

    container.insertAdjacentHTML('beforeend', ansiToHtml(data));
    container.scrollTop = container.scrollHeight;
}

// --- Tab Switching (3 tabs: logs, terminal, database) ---

const allTabs = ['logs', 'terminal', 'database'];

window.switchProjectTab = function (tab) {
    allTabs.forEach(t => {
        const tabBtn = document.getElementById(`project-tab-${t}`);
        const panel = document.getElementById(`project-panel-${t}`);
        if (!tabBtn || !panel) return;

        if (t === tab) {
            tabBtn.style.color = 'var(--text-primary)';
            tabBtn.style.fontWeight = '600';
            tabBtn.style.borderBottom = '2px solid var(--accent-primary)';
            panel.style.display = 'flex';
        } else {
            tabBtn.style.color = 'var(--text-muted)';
            tabBtn.style.fontWeight = '500';
            tabBtn.style.borderBottom = '2px solid transparent';
            panel.style.display = 'none';
        }
    });

    if (tab === 'terminal') {
        setTimeout(() => document.getElementById('project-terminal-input')?.focus(), 50);
    }
    if (tab === 'database') {
        // Auto-populate saved credentials if available
        if (project && project.dbConfig && !dbConnected) {
            document.getElementById('db-type').value = project.dbConfig.type || 'mysql';
            document.getElementById('db-host').value = project.dbConfig.host || '';
            document.getElementById('db-port').value = project.dbConfig.port || '';
            document.getElementById('db-user').value = project.dbConfig.user || '';
            document.getElementById('db-pass').value = project.dbConfig.password || '';
            document.getElementById('db-name').value = project.dbConfig.database || '';
        }
    }
};

// --- Terminal Commands ---

window.submitProjectTerminalCommand = function () {
    const input = document.getElementById('project-terminal-input');
    const cmd = input?.value?.trim();
    if (!cmd || !project || !project.id) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'run-command',
            projectId: project.id,
            command: cmd
        }));
    }
    input.value = '';
};

window.runProjectQuickCommand = function (cmd) {
    if (!project || !project.id) return;
    window.switchProjectTab('terminal');

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'run-command',
            projectId: project.id,
            command: cmd
        }));
    }
};

window.clearProjectLogs = function () {
    const panelLogs = document.getElementById('project-panel-logs');
    if (panelLogs && panelLogs.style.display !== 'none') {
        const container = document.getElementById('project-log-entries');
        if (container) container.innerHTML = '';
    } else {
        const container = document.getElementById('project-terminal-output');
        if (container) container.innerHTML = '<div style="color: var(--text-muted);">Run dependency commands here. Only install/update commands are allowed.</div>';
    }
};

// ===========================
//  Database Explorer
// ===========================

let dbConnected = false;

window.connectDatabase = async function () {
    if (!project || !project.id) return;

    const btn = document.getElementById('db-connect-btn');
    btn.textContent = 'Connecting...';
    btn.disabled = true;

    const config = {
        type: document.getElementById('db-type').value,
        host: document.getElementById('db-host').value || 'localhost',
        port: parseInt(document.getElementById('db-port').value) || undefined,
        user: document.getElementById('db-user').value,
        password: document.getElementById('db-pass').value,
        database: document.getElementById('db-name').value,
    };

    try {
        await api.dbConnect(project.id, config);
        dbConnected = true;

        document.getElementById('db-connect-view').style.display = 'none';
        document.getElementById('db-active-view').style.display = 'flex';
        document.getElementById('db-active-name').textContent = config.database || config.type;

        showToast('Database connected!', 'success');
        await loadDbTables();
    } catch (error) {
        showToast(`Connection failed: ${error.message}`, 'error');
    } finally {
        btn.textContent = 'Connect';
        btn.disabled = false;
    }
};

window.disconnectDatabase = async function () {
    if (!project || !project.id) return;

    try {
        await api.dbDisconnect(project.id);
    } catch (e) { /* ignore */ }

    dbConnected = false;
    document.getElementById('db-connect-view').style.display = 'flex';
    document.getElementById('db-active-view').style.display = 'none';

    // Reset data grid
    document.getElementById('db-data-table').style.display = 'none';
    document.getElementById('db-data-placeholder').style.display = 'block';
    document.getElementById('db-data-thead').innerHTML = '';
    document.getElementById('db-data-tbody').innerHTML = '';

    showToast('Database disconnected', 'info');
};

async function loadDbTables() {
    if (!project || !project.id) return;

    const listEl = document.getElementById('db-tables-list');
    listEl.innerHTML = '<div style="padding: 12px 16px; color: var(--text-muted); font-size: 0.85rem;">Loading tables...</div>';

    try {
        const tables = await api.dbGetTables(project.id);

        if (tables.length === 0) {
            listEl.innerHTML = '<div style="padding: 12px 16px; color: var(--text-muted); font-size: 0.85rem;">No tables found</div>';
            return;
        }

        listEl.innerHTML = tables.map(t => `
            <div class="db-table-item" onclick="window.loadTableData('${escapeHtml(t)}')"
                style="padding: 9px 16px; cursor: pointer; font-size: 0.82rem; color: var(--text-secondary); transition: all 0.15s; display: flex; align-items: center; gap: 8px; border-left: 2px solid transparent;"
                onmouseover="this.style.background='rgba(99,102,241,0.06)'; this.style.borderLeftColor='var(--accent-primary)'"
                onmouseout="this.style.background='transparent'; this.style.borderLeftColor='transparent'">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent-secondary)" stroke-width="2" style="flex-shrink: 0; opacity: 0.6;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 0.8rem;">${escapeHtml(t)}</span>
            </div>
        `).join('');
    } catch (error) {
        listEl.innerHTML = `<div style="padding: 12px 16px; color: var(--error); font-size: 0.85rem;">${escapeHtml(error.message)}</div>`;
    }
}

window.loadDbTables = loadDbTables;

window.loadTableData = async function (tableName) {
    if (!project || !project.id) return;

    // Highlight active table in sidebar
    document.querySelectorAll('.db-table-item').forEach(el => {
        el.style.background = 'transparent';
        el.style.borderLeftColor = 'transparent';
    });
    // Find and highlight the clicked one
    event?.target?.closest?.('.db-table-item')?.style && (() => {
        const item = event.target.closest('.db-table-item');
        item.style.background = 'rgba(99,102,241,0.08)';
        item.style.borderLeftColor = 'var(--accent-primary)';
    })();

    const placeholder = document.getElementById('db-data-placeholder');
    const table = document.getElementById('db-data-table');
    const thead = document.getElementById('db-data-thead');
    const tbody = document.getElementById('db-data-tbody');
    const panelData = document.getElementById('db-panel-data');

    placeholder.style.display = 'block';
    placeholder.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">Loading <b>${escapeHtml(tableName)}</b>...</div>`;
    table.style.display = 'none';

    try {
        const data = await api.dbGetTableData(project.id, tableName);

        if (!data || data.length === 0) {
            placeholder.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">Table <b>"${escapeHtml(tableName)}"</b> is empty.</div>`;
            return;
        }

        const columns = Object.keys(data[0]);

        // Row count info bar
        let infoBar = `<div style="padding: 8px 16px; background: rgba(99,102,241,0.04); border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.78rem; color: var(--text-muted); display: flex; align-items: center; gap: 8px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
            <b style="color: var(--text-primary);">${escapeHtml(tableName)}</b>
            <span>—</span>
            <span>${data.length} row${data.length !== 1 ? 's' : ''} · ${columns.length} column${columns.length !== 1 ? 's' : ''}</span>
        </div>`;

        // Header with gradient bg
        const colWidth = Math.max(Math.floor(100 / columns.length), 10);
        thead.innerHTML = `<tr>${columns.map(c => 
            `<th style="padding: 10px 16px; text-align: left; border-bottom: 2px solid rgba(99,102,241,0.2); white-space: nowrap; font-weight: 700; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent-primary); background: rgba(10,11,20,0.95); width: ${colWidth}%;">${escapeHtml(String(c))}</th>`
        ).join('')}</tr>`;

        // Rows with alternating colors
        tbody.innerHTML = data.map((row, i) => `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); background: ${i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'}; transition: background 0.1s;"
                onmouseover="this.style.background='rgba(99,102,241,0.06)'"
                onmouseout="this.style.background='${i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'}'"
            >
                ${columns.map(c => {
                    let val = row[c];
                    if (val === null || val === undefined) val = '<span style="color: #444; font-style: italic;">NULL</span>';
                    else if (typeof val === 'object') val = `<span style="color: #8b5cf6;">${escapeHtml(JSON.stringify(val))}</span>`;
                    else if (typeof val === 'number') val = `<span style="color: #22d3ee;">${val}</span>`;
                    else if (typeof val === 'boolean') val = `<span style="color: ${val ? '#22c55e' : '#ef4444'};">${val}</span>`;
                    else val = escapeHtml(String(val));
                    return `<td style="padding: 8px 16px; overflow: hidden; text-overflow: ellipsis;">${val}</td>`;
                }).join('')}
            </tr>
        `).join('');

        placeholder.style.display = 'none';

        // Insert info bar before the table
        const existingInfoBar = panelData.querySelector('.db-info-bar');
        if (existingInfoBar) existingInfoBar.remove();
        const barDiv = document.createElement('div');
        barDiv.className = 'db-info-bar';
        barDiv.innerHTML = infoBar;
        panelData.insertBefore(barDiv, table);

        table.style.display = 'table';
    } catch (error) {
        placeholder.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--error);">Error: ${escapeHtml(error.message)}</div>`;
    }
};

// --- DB Sub-tabs (Data Grid / Run Query) ---

window.switchDbTab = function (tab) {
    const tabData = document.getElementById('db-tab-data');
    const tabQuery = document.getElementById('db-tab-query');
    const panelData = document.getElementById('db-panel-data');
    const panelQuery = document.getElementById('db-panel-query');

    if (tab === 'data') {
        tabData.style.borderBottom = '2px solid var(--accent-primary)';
        tabData.style.color = 'white';
        tabQuery.style.borderBottom = '2px solid transparent';
        tabQuery.style.color = 'var(--text-muted)';
        panelData.style.display = 'block';
        panelQuery.style.display = 'none';
    } else {
        tabQuery.style.borderBottom = '2px solid var(--accent-primary)';
        tabQuery.style.color = 'white';
        tabData.style.borderBottom = '2px solid transparent';
        tabData.style.color = 'var(--text-muted)';
        panelData.style.display = 'none';
        panelQuery.style.display = 'flex';
        setTimeout(() => document.getElementById('db-query-input')?.focus(), 50);
    }
};

// --- Run Query ---

window.runDbQuery = async function () {
    if (!project || !project.id) return;

    const queryInput = document.getElementById('db-query-input');
    const query = queryInput?.value?.trim();
    if (!query) return;

    const resultsEl = document.getElementById('db-query-results');
    resultsEl.innerHTML = '<div style="color: var(--text-muted);">Executing query...</div>';

    try {
        const result = await api.dbRunQuery(project.id, query);

        if (!result || (Array.isArray(result) && result.length === 0)) {
            resultsEl.innerHTML = '<div style="color: var(--success);">Query executed successfully. No rows returned.</div>';
            // Refresh tables list in case of CREATE/DROP
            await loadDbTables();
            return;
        }

        if (!Array.isArray(result)) {
            resultsEl.innerHTML = `<pre style="color: #d4d4d4; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; white-space: pre-wrap;">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
            return;
        }

        const columns = Object.keys(result[0]);
        resultsEl.innerHTML = `
            <div style="margin-bottom: 8px; color: var(--success); font-size: 0.85rem;">${result.length} row(s) returned</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; color: #d4d4d4;">
                <thead><tr>${columns.map(c => `<th style="padding: 8px 12px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.1); white-space: nowrap; font-weight: 600; color: white;">${escapeHtml(String(c))}</th>`).join('')}</tr></thead>
                <tbody>${result.map(row => `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                        ${columns.map(c => {
                            let val = row[c];
                            if (val === null || val === undefined) val = '<span style="color: #555;">NULL</span>';
                            else if (typeof val === 'object') val = escapeHtml(JSON.stringify(val));
                            else val = escapeHtml(String(val));
                            return `<td style="padding: 6px 12px; white-space: nowrap; max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${val}</td>`;
                        }).join('')}
                    </tr>
                `).join('')}</tbody>
            </table>
        `;
    } catch (error) {
        resultsEl.innerHTML = `<div style="color: var(--error);">Error: ${escapeHtml(error.message)}</div>`;
    }
};

// --- Import SQL Dump ---

window.importDbDump = async function (event) {
    if (!project || !project.id) return;
    const file = event.target.files[0];
    if (!file) return;

    showToast(`Importing ${file.name}...`, 'info');

    try {
        const sqlContent = await file.text();
        await api.dbImportDump(project.id, sqlContent);
        showToast('SQL dump imported successfully!', 'success');
        await loadDbTables();
    } catch (error) {
        showToast(`Import failed: ${error.message}`, 'error');
    }

    // Reset file input
    event.target.value = '';
};

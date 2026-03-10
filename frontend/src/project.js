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
        // We will just render a flat list of files for now with basic indentation or simple clicking into folders.
        // For simplicity in a side-project: let's render root files, and if user clicks a folder, we load that folder's contents.
        // Actually, a simple breadcrumb or flat list is easiest to manage here without a UI framework.

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

    // Add an 'up' button if we are not at root
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

        // Pick icon
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
                // Update active state in UI
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

        // Auto detect language mode
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

// --- Live Logs Logic ---

let ws = null;
let reconnectInterval = null;

function connectWebSocket() {
    if (ws) return; // already connected

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
                    renderLogEntries(msg.logs);
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

function renderLogEntries(logs) {
    const container = document.getElementById('project-log-entries');
    if (!container) return;
    container.innerHTML = logs.map(createLogEntryHtml).join('');
    autoScrollLogs();
}

function appendLogEntry(log) {
    const container = document.getElementById('project-log-entries');
    if (!container) return;

    // remove "connecting" text if it's the first log
    if (container.innerHTML.includes('Connecting to log stream')) {
        container.innerHTML = '';
    }

    container.insertAdjacentHTML('beforeend', createLogEntryHtml(log));
    autoScrollLogs();
}

function createLogEntryHtml(log) {
    const time = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });
    let msgClass = '';
    if (log.message.includes('❌') || log.message.includes('error') || log.message.includes('Error')) {
        msgClass = 'color: #ef4444;'; // error red
    } else if (log.message.includes('✅') || log.message.includes('success')) {
        msgClass = 'color: #22c55e;'; // success green
    } else if (log.message.includes('⚠️') || log.message.includes('warn')) {
        msgClass = 'color: #f59e0b;'; // warning yellow
    } else {
        msgClass = 'color: #a1a1aa;'; // normal text
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

window.clearLogs = function () {
    const container = document.getElementById('project-log-entries');
    if (container) container.innerHTML = '';
};

window.handleTerminalInput = function (event) {
    const inputMap = event.target;

    // Support Ctrl+C mapping to emulate terminal kill
    if (event.ctrlKey && event.key === 'c') {
        event.preventDefault();
        inputMap.value = '';
        if (project && project.id) {
            handleStop(); // Leverage existing handleStop method on this page
        }
        return;
    }

    if (event.key === 'Enter') {
        const val = inputMap.value;
        if (!val || !project || !project.id) return;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'stdin',
                projectId: project.id,
                data: val
            }));
        }
        inputMap.value = '';
    }
};

import * as api from './api.js';

// ===========================
//  State
// ===========================
let projects = [];
let folders = [];
let ws = null;
let selectedFile = null;
let currentLogProjectId = null;
let reconnectInterval = null;
let proxyPort = 8080;
let lanIP = '';
let currentActiveFolder = null;

// ===========================
//  Init
// ===========================
document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
  connectWebSocket();
  setupDragAndDrop();
  setupKeyboardShortcuts();

  // Create toast container
  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  toastContainer.id = 'toast-container';
  document.body.appendChild(toastContainer);

  // Poll for project updates every 5 seconds
  setInterval(loadProjects, 5000);
});

// ===========================
//  WebSocket
// ===========================
function connectWebSocket() {
  try {
    ws = api.createWebSocket();

    ws.onopen = () => {
      updateServerStatus(true);
      // Subscribe to all project logs
      ws.send(JSON.stringify({ type: 'subscribe', projectId: '*' }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'log' && msg.projectId === currentLogProjectId) {
          appendLogEntry(msg.log);
        }

        if (msg.type === 'logs_history' && msg.projectId === currentLogProjectId) {
          renderLogEntries(msg.logs);
        }

        if (msg.type === 'status') {
          updateProjectStatus(msg.projectId, msg.status);
        }
      } catch (e) { /* ignore */ }
    };

    ws.onclose = () => {
      updateServerStatus(false);
      // Reconnect after 3 seconds
      if (!reconnectInterval) {
        reconnectInterval = setTimeout(() => {
          reconnectInterval = null;
          connectWebSocket();
        }, 3000);
      }
    };

    ws.onerror = () => {
      updateServerStatus(false);
    };
  } catch (e) {
    updateServerStatus(false);
  }
}

function updateServerStatus(connected) {
  const badge = document.getElementById('server-status');
  if (connected) {
    badge.className = 'status-badge';
    badge.innerHTML = '<span class="status-dot"></span><span>Connected</span>';
  } else {
    badge.className = 'status-badge disconnected';
    badge.innerHTML = '<span class="status-dot"></span><span>Disconnected</span>';
  }
}

// ===========================
//  Projects
// ===========================
async function loadProjects() {
  try {
    const data = await api.fetchProjects();
    projects = data.projects || [];
    folders = data.folders || [];

    // Also fetch proxy info
    try {
      const proxyInfo = await api.fetchProxyInfo();
      proxyPort = proxyInfo.proxyPort;
      lanIP = proxyInfo.lanIP || '';
    } catch (e) { /* proxy info optional */ }

    renderProjects();
    updateStats();
  } catch (e) {
    // Silently fail on polling errors
  }
}

function renderProjects() {
  const container = document.getElementById('projects-container');
  const emptyState = document.getElementById('empty-state');

  if (projects.length === 0 && folders.length === 0) {
    container.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  container.style.display = 'block';

  let html = '';

  if (currentActiveFolder === null) {
    // Root View
    // Render Folders grid
    if (folders.length > 0) {
      html += `
            <div style="margin-bottom: 32px;">
              <h2 style="font-size: 1.1rem; margin-bottom: 16px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                Folders
              </h2>
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
          `;

      folders.sort().forEach(folder => {
        const count = projects.filter(p => p.folder === folder).length;
        html += `
                <div class="folder-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s; box-shadow: var(--shadow-sm);" onmouseover="this.style.borderColor='var(--border-hover)'; this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--border-color)'; this.style.transform='translateY(0)'" onclick="window.enterFolder('${escapeHtml(folder)}')">
                   <div style="display: flex; align-items: center; gap: 12px;">
                      <div style="width: 40px; height: 40px; background: rgba(99, 102, 241, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--accent-primary);">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                          </svg>
                      </div>
                      <div>
                          <div style="font-weight: 600; font-size: 1rem; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 150px;">${escapeHtml(folder)}</div>
                          <div style="font-size: 0.75rem; color: var(--text-muted);">${count} project${count === 1 ? '' : 's'}</div>
                      </div>
                   </div>
                   <div style="display: flex; gap: 4px;" onclick="event.stopPropagation()">
                       <button class="btn-icon" style="color: var(--error); padding: 6px;" title="Delete Folder" onclick="window.handleDeleteFolder('${escapeHtml(folder)}')">
                           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                       </button>
                   </div>
                </div>
              `;
      });

      html += `
              </div>
            </div>
          `;
    }

    // Render Uncategorized projects
    const uncategorized = projects.filter(p => !p.folder);
    if (uncategorized.length > 0) {
      html += `
            <div style="margin-bottom: 32px;">
              <h2 style="font-size: 1.1rem; margin-bottom: 16px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                Uncategorized Projects
              </h2>
              <div class="projects-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px;">
                ${renderProjectCards(uncategorized)}
              </div>
            </div>
          `;
    }

  } else {
    // Folder View
    const folderProjects = projects.filter(p => p.folder === currentActiveFolder);

    html += `
        <div style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
           <div style="display: flex; align-items: center; gap: 16px;">
               <button class="btn btn-ghost btn-sm" onclick="window.enterFolder(null)">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                       <line x1="19" y1="12" x2="5" y2="12"></line>
                       <polyline points="12 19 5 12 12 5"></polyline>
                   </svg>
                   Back
               </button>
               <h2 style="font-size: 1.5rem; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 8px;">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-primary);">
                   <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                 </svg>
                 ${escapeHtml(currentActiveFolder)}
               </h2>
           </div>
           
           <button class="btn btn-primary btn-sm" onclick="window.openUploadModal('${escapeHtml(currentActiveFolder)}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Deploy Here
           </button>
        </div>
      `;

    if (folderProjects.length === 0) {
      html += `
            <div style="padding: 64px 32px; text-align: center; background: rgba(0,0,0,0.2); border: 1px dashed var(--border-color); border-radius: 12px; color: var(--text-muted);">
                <div style="margin-bottom: 16px;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.5;">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <h3 style="font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 8px;">This folder is empty</h3>
                <p>Click "Deploy Here" to add a project to this folder.</p>
            </div>
          `;
    } else {
      html += `
            <div class="projects-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px;">
              ${renderProjectCards(folderProjects)}
            </div>
          `;
    }
  }

  container.innerHTML = html;
}

function renderProjectCards(projectsList) {
  return projectsList.map((project, index) => {
    const statusClass = project.status || 'unknown';
    const portChanged = project.desiredPort !== project.assignedPort;
    const lastLogs = (project.logs || []).slice(-3);
    const cleanedName = escapeHtml((project.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-'));

    return `
        <div class="project-card status-${statusClass}" style="animation-delay: ${index * 0.05}s" id="card-${project.id}">
          <div class="card-header">
            <div class="card-title-area">
              <span class="project-type-badge ${project.type || 'unknown'}">${project.type || 'unknown'}</span>
            </div>
            <div class="project-status ${statusClass}">
              <span class="status-pulse"></span>
              <span>${statusClass}</span>
            </div>
          </div>
          <div class="card-body">
            <h3 style="cursor:pointer; display:flex; align-items:center; gap:6px; transition:color 0.2s;" onmouseover="this.style.color='var(--accent-primary)'" onmouseout="this.style.color=''" onclick="window.location.href='/project.html?id=${project.id}'" title="Open Project Details">
              ${escapeHtml(project.name || 'Unnamed')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </h3>
            
            <details class="url-expander">
              <summary>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                Network Access URLs
              </summary>
              <div class="url-list">
                <div class="url-item">
                  <div class="url-item-left">
                    <span class="url-label">Best for this computer</span>
                    <a href="http://${cleanedName}.localhost:${proxyPort}/" target="_blank" class="url-link">http://${cleanedName}.localhost:${proxyPort}/</a>
                  </div>
                  <button class="copy-btn" onclick="window.copyToClipboard('http://${cleanedName}.localhost:${proxyPort}/', this)" title="Copy URL">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>

                ${lanIP ? `
                <div class="url-item">
                  <div class="url-item-left">
                    <span class="url-label">📱 Best for other devices on WiFi</span>
                    <a href="http://${cleanedName}.${lanIP}.nip.io:${proxyPort}/" target="_blank" class="url-link" style="color: var(--success)">http://${cleanedName}.${lanIP}.nip.io:${proxyPort}/</a>
                  </div>
                  <button class="copy-btn" onclick="window.copyToClipboard('http://${cleanedName}.${lanIP}.nip.io:${proxyPort}/', this)" title="Copy URL">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>` : ''}

                <div class="url-item">
                  <div class="url-item-left">
                    <span class="url-label">Direct Port Access</span>
                    <a href="http://localhost:${project.assignedPort}" target="_blank" class="url-link" style="color: var(--text-muted)">http://localhost:${project.assignedPort}</a>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px">
                    ${portChanged ? `<span class="detail-value port-changed"><span class="port-original">${project.desiredPort}</span><span class="port-arrow">→</span><span class="port-assigned">${project.assignedPort}</span></span>` : `<span class="detail-value">${project.assignedPort}</span>`}
                    <button class="copy-btn" onclick="window.copyToClipboard('http://localhost:${project.assignedPort}', this)" title="Copy URL">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                  </div>
                </div>
              </div>
            </details>
            ${lastLogs.length > 0 ? `
              <div class="card-minilog" onclick="window.openLogModal('${project.id}', '${escapeHtml(project.name)}')">
                ${lastLogs.map(l => escapeHtml(l.message)).join('<br>')}
              </div>
            ` : ''}
            <div class="card-actions">
              ${project.status === 'extracted' ? `
                <button class="btn btn-success btn-sm" onclick="window.handleDeploy('${project.id}')">
                  <span class="spinner" style="display:none" id="deploy-spinner-${project.id}"></span>
                  🚀 Deploy
                </button>
              ` : project.status === 'running' || project.status === 'starting' ? `
                <button class="btn btn-ghost btn-sm" onclick="window.handleStop('${project.id}')">⏹ Stop</button>
                <button class="btn btn-ghost btn-sm" onclick="window.handleRestart('${project.id}')">🔄 Restart</button>
              ` : project.status === 'stopped' || project.status === 'crashed' || project.status === 'error' ? `
                <button class="btn btn-success btn-sm" onclick="window.handleDeploy('${project.id}')">🚀 Redeploy</button>
              ` : project.status === 'installing' ? `
                <button class="btn btn-ghost btn-sm" disabled>
                  <span class="spinner"></span> Installing...
                </button>
              ` : ''}
              <button class="btn btn-primary btn-sm" onclick="window.location.href='/project.html?id=${project.id}'" title="View URLs and details">
                🌐 Details
              </button>
              
              <div class="dropdown" style="position: relative; display: inline-block;">
                <button class="btn btn-ghost btn-sm dropdown-toggle" onclick="this.nextElementSibling.classList.toggle('show')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                </button>
                <div class="dropdown-menu" style="display: none; position: absolute; right: 0; bottom: 100%; margin-bottom: 8px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 8px; z-index: 10; box-shadow: 0 4px 12px rgba(0,0,0,0.2); min-width: 150px;">
                  <button class="btn btn-ghost btn-sm" style="width: 100%; text-align: left; justify-content: flex-start;" onclick="window.openLogModal('${project.id}', '${escapeHtml(project.name)}')">📋 Logs</button>
                  <button class="btn btn-ghost btn-sm" style="width: 100%; text-align: left; justify-content: flex-start;" onclick="window.handleMoveToFolder('${project.id}')">📁 Move to Folder</button>
                  <button class="btn btn-ghost btn-sm" style="width: 100%; text-align: left; justify-content: flex-start; color: var(--error);" onclick="window.handleDelete('${project.id}')">🗑️ Delete</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
  }).join('');
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown-menu').forEach(i => i.style.display = 'none');
  } else {
    // Hide others
    document.querySelectorAll('.dropdown-menu.show').forEach(i => {
      if (i !== e.target.closest('.dropdown').querySelector('.dropdown-menu')) {
        i.style.display = 'none';
        i.classList.remove('show');
      }
    });
    // Toggle current
    const menu = e.target.closest('.dropdown').querySelector('.dropdown-menu');
    if (menu.classList.contains('show')) {
      menu.style.display = 'flex';
      menu.style.flexDirection = 'column';
      menu.style.gap = '4px';
    } else {
      menu.style.display = 'none';
    }
  }
});

window.enterFolder = function (folderName) {
  currentActiveFolder = folderName;
  renderProjects();
};

function updateStats() {
  const running = projects.filter(p => p.status === 'running' || p.status === 'starting').length;
  const stopped = projects.filter(p => p.status === 'stopped' || p.status === 'crashed' || p.status === 'error').length;
  const total = projects.length;
  const ports = new Set(projects.filter(p => p.assignedPort).map(p => p.assignedPort)).size;

  animateNumber('stat-running', running);
  animateNumber('stat-stopped', stopped);
  animateNumber('stat-total', total);
  animateNumber('stat-ports', ports);
}

function animateNumber(elementId, target) {
  const el = document.getElementById(elementId);
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  el.textContent = target;
  el.style.transform = 'scale(1.2)';
  el.style.color = 'var(--accent-primary)';
  setTimeout(() => {
    el.style.transform = 'scale(1)';
    el.style.color = '';
  }, 300);
}

function updateProjectStatus(projectId, status) {
  const card = document.getElementById(`card-${projectId}`);
  if (card) {
    // Update status class
    card.className = `project-card status-${status}`;
    // Refresh full view
    loadProjects();
  }
}

// ===========================
//  Upload Modal
// ===========================
window.openUploadModal = function (targetFolder = '') {
  window.currentUploadFolder = targetFolder;
  const modalTitle = document.querySelector('#upload-modal h2');
  if (modalTitle) {
    modalTitle.textContent = targetFolder ? `Deploy New Project to '${targetFolder}'` : 'Deploy New Project';
  }
  document.getElementById('upload-modal').classList.add('active');
};

window.closeUploadModal = function () {
  document.getElementById('upload-modal').classList.remove('active');
  clearFile();
};

window.handleFileSelect = function (event) {
  const file = event.target.files[0];
  if (file) {
    selectedFile = file;
    showSelectedFile(file);
  }
};

function showSelectedFile(file) {
  const zone = document.getElementById('upload-zone');
  const fileEl = document.getElementById('selected-file');
  const nameEl = document.getElementById('file-name');
  const sizeEl = document.getElementById('file-size');

  zone.style.display = 'none';
  fileEl.style.display = 'flex';
  nameEl.textContent = file.name;
  sizeEl.textContent = formatFileSize(file.size);
  document.getElementById('deploy-btn').disabled = false;
}

window.clearFile = function () {
  selectedFile = null;
  document.getElementById('upload-zone').style.display = '';
  document.getElementById('selected-file').style.display = 'none';
  document.getElementById('deploy-btn').disabled = true;
  document.getElementById('file-input').value = '';
};

window.uploadProject = async function () {
  if (!selectedFile) return;

  const deployBtn = document.getElementById('deploy-btn');
  deployBtn.disabled = true;
  deployBtn.innerHTML = '<span class="spinner"></span> Uploading...';

  try {
    // Upload
    const project = await api.uploadProject(selectedFile);
    showToast(`${project.name} uploaded successfully!`, 'success');

    // Automatically set folder if deploying from within a folder
    if (window.currentUploadFolder) {
      await api.updateProjectFolder(project.id, window.currentUploadFolder);
    }

    closeUploadModal();

    // Auto-deploy
    showToast(`Starting deployment for ${project.name}...`, 'info');
    await api.deployProject(project.id);

    await loadProjects();
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  } finally {
    deployBtn.disabled = false;
    deployBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2L14 8L8 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M14 8H2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Upload & Deploy
    `;
  }
};

// ===========================
//  Project Actions
// ===========================
window.handleDeploy = async function (id) {
  try {
    showToast('Deploying project...', 'info');
    await api.deployProject(id);
    await loadProjects();
  } catch (e) {
    showToast(`Deploy error: ${e.message}`, 'error');
  }
};

window.handleStop = async function (id) {
  try {
    await api.stopProject(id);
    showToast('Project stopped', 'info');
    await loadProjects();
  } catch (e) {
    showToast(`Stop error: ${e.message}`, 'error');
  }
};

window.handleRestart = async function (id) {
  try {
    showToast('Restarting project...', 'info');
    await api.restartProject(id);
    await loadProjects();
  } catch (e) {
    showToast(`Restart error: ${e.message}`, 'error');
  }
};

window.handleDelete = async function (id) {
  if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) return;

  try {
    await api.deleteProject(id);
    showToast('Project deleted', 'success');
    await loadProjects();
  } catch (e) {
    showToast(`Delete error: ${e.message}`, 'error');
  }
};

window.createNewFolder = async function () {
  const newFolder = prompt('Enter a name for the new folder:');
  if (!newFolder || !newFolder.trim()) return;

  try {
    await api.createFolder(newFolder.trim());
    showToast(`Folder '${newFolder.trim()}' created!`, 'success');
    await loadProjects();
  } catch (e) {
    showToast(`Error creating folder: ${e.message}`, 'error');
  }
};

window.handleDeleteFolder = async function (name) {
  if (!confirm(`Are you sure you want to delete the folder '${name}'? Any projects inside will be moved to Uncategorized.`)) return;
  try {
    if (currentActiveFolder === name) {
      currentActiveFolder = null;
    }
    await api.deleteFolder(name);
    showToast(`Folder deleted`, 'success');
    await loadProjects();
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
};

window.handleMoveToFolder = async function (id) {
  // Hide dropdowns first
  document.querySelectorAll('.dropdown-menu').forEach(i => i.style.display = 'none');

  const currentProject = projects.find(p => p.id === id);
  if (!currentProject) return;

  const currentFolder = currentProject.folder || '';
  const newFolder = prompt('Enter a folder name (or leave empty to clear):', currentFolder);

  if (newFolder === null) return; // User cancelled

  try {
    await api.updateProjectFolder(id, newFolder.trim());
    showToast(`Moved to ${newFolder ? newFolder : 'Uncategorized'}`, 'success');
    await loadProjects();
  } catch (e) {
    showToast(`Failed to move: ${e.message}`, 'error');
  }
};

// ===========================
//  Log Modal
// ===========================
window.openLogModal = function (projectId, name) {
  currentLogProjectId = projectId;
  document.getElementById('log-modal-project-name').textContent = name + ' — Logs';
  document.getElementById('log-entries').innerHTML = '';
  document.getElementById('terminal-input').value = '';
  document.getElementById('log-modal').classList.add('active');
  setTimeout(() => document.getElementById('terminal-input').focus(), 100);

  // Subscribe to this project's logs via WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', projectId }));
  }

  // Also fetch existing logs via REST
  api.fetchLogs(projectId).then(logs => {
    renderLogEntries(logs);
  }).catch(() => { });
};

window.closeLogModal = function () {
  if (currentLogProjectId && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unsubscribe', projectId: currentLogProjectId }));
  }
  currentLogProjectId = null;
  document.getElementById('log-modal').classList.remove('active');
};

window.handleTerminalInput = function (event) {
  const inputMap = event.target;

  // Handle literal Ctrl+C keybind specifically mapped to stop process
  if (event.ctrlKey && event.key === 'c') {
    event.preventDefault();
    inputMap.value = '';
    if (currentLogProjectId) {
      window.handleStop(currentLogProjectId);
    }
    return;
  }

  if (event.key === 'Enter') {
    const val = inputMap.value;
    if (!val || !currentLogProjectId) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'stdin',
        projectId: currentLogProjectId,
        data: val
      }));
    }
    inputMap.value = '';
  }
};

function renderLogEntries(logs) {
  const container = document.getElementById('log-entries');
  container.innerHTML = logs.map(log => createLogEntryHtml(log)).join('');
  autoScrollLogs();
}

function appendLogEntry(log) {
  const container = document.getElementById('log-entries');
  container.insertAdjacentHTML('beforeend', createLogEntryHtml(log));
  autoScrollLogs();
}

function createLogEntryHtml(log) {
  const time = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });
  let msgClass = '';
  if (log.message.includes('❌') || log.message.includes('error') || log.message.includes('Error')) {
    msgClass = 'error-log';
  } else if (log.message.includes('✅') || log.message.includes('success')) {
    msgClass = 'success-log';
  } else if (log.message.includes('⚠️') || log.message.includes('warn')) {
    msgClass = 'warning-log';
  }

  return `
    <div class="log-entry">
      <span class="log-timestamp">${time}</span>
      <span class="log-message ${msgClass}">${escapeHtml(log.message)}</span>
    </div>
  `;
}

function autoScrollLogs() {
  const autoScroll = document.getElementById('auto-scroll');
  if (autoScroll && autoScroll.checked) {
    const container = document.getElementById('log-container');
    container.scrollTop = container.scrollHeight;
  }
}

window.clearLogView = function () {
  document.getElementById('log-entries').innerHTML = '';
};

// ===========================
//  Drag & Drop
// ===========================
function setupDragAndDrop() {
  const uploadZone = document.getElementById('upload-zone');
  if (!uploadZone) return;

  ['dragenter', 'dragover'].forEach(event => {
    uploadZone.addEventListener(event, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(event => {
    uploadZone.addEventListener(event, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.remove('drag-over');
    });
  });

  uploadZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith('.zip')) {
      selectedFile = files[0];
      showSelectedFile(files[0]);
    } else {
      showToast('Please drop a .zip file', 'error');
    }
  });
}

// ===========================
//  Keyboard Shortcuts
// ===========================
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Escape to close modals
    if (e.key === 'Escape') {
      closeUploadModal();
      closeLogModal();
    }
  });
}

// ===========================
//  Utility
// ===========================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

// Make functions globally available
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.loadProjects = loadProjects;
window.uploadFiles = uploadFiles;
window.handleDelete = handleDelete;
window.handleDeploy = handleDeploy;
window.handleStop = handleStop;
window.handleRestart = handleRestart;
window.openLogModal = openLogModal;
window.closeLogModal = closeLogModal;

window.copyToClipboard = (text, btnElement) => {
  navigator.clipboard.writeText(text).then(() => {
    const originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    btnElement.classList.add('copied');
    setTimeout(() => {
      btnElement.innerHTML = originalHtml;
      btnElement.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    console.error('Failed to copy', text);
  });
};

init();

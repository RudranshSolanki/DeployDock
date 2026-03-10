const API_BASE = '/api';

export async function fetchProjects() {
    const res = await fetch(`${API_BASE}/projects`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch projects');
    return data;
}

export async function createFolder(name) {
    const res = await fetch(`${API_BASE}/projects/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to create folder');
    return data;
}

export async function deleteFolder(name) {
    const res = await fetch(`${API_BASE}/projects/folders/${encodeURIComponent(name)}`, {
        method: 'DELETE'
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to delete folder');
    return data;
}

export async function fetchProject(id) {
    const res = await fetch(`${API_BASE}/projects/${id}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch project');
    return data.project;
}

export async function uploadProject(file) {
    const formData = new FormData();
    formData.append('project', file);

    const res = await fetch(`${API_BASE}/projects/upload`, {
        method: 'POST',
        body: formData,
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Upload failed');
    return data.project;
}

export async function deployProject(id) {
    const res = await fetch(`${API_BASE}/projects/${id}/deploy`, {
        method: 'POST',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Deploy failed');
    return data.project;
}

export async function stopProject(id) {
    const res = await fetch(`${API_BASE}/projects/${id}/stop`, {
        method: 'POST',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Stop failed');
    return data.project;
}

export async function restartProject(id) {
    const res = await fetch(`${API_BASE}/projects/${id}/restart`, {
        method: 'POST',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Restart failed');
    return data.project;
}

export async function deleteProject(id) {
    const res = await fetch(`${API_BASE}/projects/${id}`, {
        method: 'DELETE',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Delete failed');
    return data;
}

export async function updateProjectFolder(id, folder) {
    const res = await fetch(`${API_BASE}/projects/${id}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to update folder');
    return data.project;
}

export async function fetchLogs(id) {
    const res = await fetch(`${API_BASE}/projects/${id}/logs`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch logs');
    return data.logs;
}

export async function fetchProxyInfo() {
    const res = await fetch(`${API_BASE}/proxy/routes`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch proxy info');
    return { proxyPort: data.proxyPort, routes: data.routes, lanIP: data.lanIP };
}

export function createWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    return new WebSocket(wsUrl);
}

export async function fetchProjectFiles(id, path = '') {
    const res = await fetch(`${API_BASE}/projects/${id}/files?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch files');
    return data.files;
}

export async function fetchFileContent(id, path) {
    const res = await fetch(`${API_BASE}/projects/${id}/file?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch file content');
    return data.content;
}

export async function saveFileContent(id, path, content) {
    const res = await fetch(`${API_BASE}/projects/${id}/file?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to save file');
    return data;
}

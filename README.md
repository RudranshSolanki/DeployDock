# DeployDock — Mini PaaS Manager

A self-hosted platform to upload, deploy, and manage your frontend/backend projects with automatic port management and internal domain routing.

## Features

- 📦 **Upload & Deploy** — Upload a ZIP file of any frontend or backend project
- 🔧 **Auto-Detection** — Automatically detects project type (Vite, Next.js, CRA, Express, Python/Flask/Django)
- 🔌 **Smart Port Management** — Automatically resolves port conflicts
- 🌐 **Internal Domain Routing** — Each project gets a `.internal` domain mapping
- 📊 **Real-time Logs** — WebSocket-powered live log streaming
- ⚡ **Process Management** — Start, stop, restart, delete projects
- 🎨 **Beautiful Dashboard** — Dark theme with glassmorphism UI

## Quick Start

### 1. Start the Backend
```bash
cd backend
npm install
npm run dev
```
The API server starts on `http://localhost:4000`

### 2. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
The dashboard opens on `http://localhost:5500`

## Config File

Include a `deploy.config.json` in your project zip root:

```json
{
  "name": "my-app",
  "type": "frontend",
  "installCommand": "npm install",
  "startCommand": "npm run dev",
  "port": 5173,
  "env": {
    "NODE_ENV": "development"
  }
}
```

### Config Options

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `name` | string | Project name | ZIP filename |
| `type` | string | `"frontend"` or `"backend"` | Auto-detected |
| `installCommand` | string | Install dependencies command | `"npm install"` |
| `startCommand` | string | Start server command | `"npm start"` |
| `port` | number | Desired port | `3000` |
| `env` | object | Environment variables | `{}` |

> **Note:** If no config file is found, DeployDock auto-detects your project type from `package.json` or `requirements.txt`.

## Port Management

DeployDock handles port conflicts automatically:

| Project | Desired Port | Assigned Port | Domain |
|---------|-------------|---------------|--------|
| project1 | 5173 | 5173 | project1.internal |
| project2 | 5173 | 5174 | project2.internal |
| api-server | 3000 | 3000 | api-server.internal |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/upload` | Upload a ZIP project |
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/projects/:id` | Get project details |
| `POST` | `/api/projects/:id/deploy` | Deploy a project |
| `POST` | `/api/projects/:id/stop` | Stop a project |
| `POST` | `/api/projects/:id/restart` | Restart a project |
| `DELETE` | `/api/projects/:id` | Delete a project |
| `GET` | `/api/projects/:id/logs` | Get project logs |
| `WS` | `/ws` | WebSocket for real-time logs |

## Tech Stack

- **Backend**: Node.js, Express, Multer, adm-zip, ws
- **Frontend**: Vite, Vanilla JS, Modern CSS

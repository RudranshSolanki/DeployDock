const net = require('net');

class PortManager {
  constructor() {
    // Track which ports are assigned to which projects
    this.assignedPorts = new Map(); // port -> projectId
    this.projectPorts = new Map(); // projectId -> port
    this.basePort = 5173;
    this.maxPort = 6200;
  }

  /**
   * Check if a port is available (not in use by OS or our projects)
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, '0.0.0.0', () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
  }

  /**
   * Find the next available port starting from the desired port
   */
  async findAvailablePort(desiredPort, projectId) {
    // If this project already has a port assigned, return it
    if (this.projectPorts.has(projectId)) {
      return this.projectPorts.get(projectId);
    }

    let port = desiredPort || this.basePort;

    while (port <= this.maxPort) {
      // Check if port is already assigned to another project
      if (this.assignedPorts.has(port)) {
        port++;
        continue;
      }

      // Check if port is available on the system
      const available = await this.isPortAvailable(port);
      if (available) {
        this.assignPort(port, projectId);
        return port;
      }
      port++;
    }

    throw new Error(`No available ports in range ${this.basePort}-${this.maxPort}`);
  }

  /**
   * Assign a port to a project
   */
  assignPort(port, projectId) {
    this.assignedPorts.set(port, projectId);
    this.projectPorts.set(projectId, port);
  }

  /**
   * Release a port from a project
   */
  releasePort(projectId) {
    const port = this.projectPorts.get(projectId);
    if (port !== undefined) {
      this.assignedPorts.delete(port);
      this.projectPorts.delete(projectId);
    }
    return port;
  }

  /**
   * Get port for a project
   */
  getPort(projectId) {
    return this.projectPorts.get(projectId);
  }

  /**
   * Get all port assignments
   */
  getAllAssignments() {
    const assignments = {};
    for (const [projectId, port] of this.projectPorts.entries()) {
      assignments[projectId] = port;
    }
    return assignments;
  }
}

module.exports = new PortManager();

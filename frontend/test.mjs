import * as fs from 'fs';
import { JSDOM } from 'jsdom';
const html = fs.readFileSync('index.html', 'utf-8');
const dom = new JSDOM(html);
const document = dom.window.document;
const window = dom.window;

// Define globals
let projects = [{id: "123", name: "frontend", status: "running", assignedPort: 5173, desiredPort: 5173, type: "frontend"}];
let proxyPort = 8080;
let lanIP = "192.168.1.5";
let activeProjectId = null;

function escapeHtml(str) { return str; }

// Inject function

try {
  showProjectDetails("123");
  console.log("SUCCESS");
  console.log(document.getElementById('project-details-view').innerHTML.substring(0, 100));
} catch (e) {
  console.error("ERROR:");
  console.error(e);
}

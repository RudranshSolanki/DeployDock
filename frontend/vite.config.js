import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 5500,
        host: '0.0.0.0', // Allow LAN access
        proxy: {
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
            },
            '/ws': {
                target: 'ws://localhost:4000',
                ws: true,
            },
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: 'index.html',
                project: 'project.html'
            }
        }
    }
});

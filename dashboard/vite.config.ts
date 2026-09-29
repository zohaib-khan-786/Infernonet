import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = 'http://127.0.0.1:8080';

/**
 * The dev server also acts as the API proxy, so the page and the API share one
 * origin.
 *
 * This is what makes the dashboard work from a phone. The two alternatives both
 * fail on a real device:
 *
 *   - Pointing the API at 127.0.0.1:8080 from a phone resolves to the *phone*.
 *     Every request 404s and the page looks broken rather than misconfigured.
 *   - Pointing it at the PC's LAN address needs the backend's CORS allowlist to
 *     include the LAN origin, and a second origin to keep in sync.
 *
 * Proxying keeps the browser on a single origin, so CORS never applies and there
 * is nothing to reconfigure per network. `host: true` binds all interfaces so
 * the dev server is reachable from the LAN at all; the backend itself is still
 * bound separately and stays where it is.
 */
const proxy = {
  '/api': { target: API_TARGET, changeOrigin: true },
  // Server-root probes. Listed explicitly because they are not under /api.
  '/healthz': { target: API_TARGET, changeOrigin: true },
  '/readyz': { target: API_TARGET, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy,
    allowedHosts: ["sylas-unnarrow-guillermina.ngrok-free.dev"]
  },
  preview: {
    port: 4173,
    proxy,
  },
  build: {
    target: 'es2022',
    // No source maps by default: this is an internal monitoring tool, and the
    // shipped bundle is meant to be auditable rather than debuggable in prod.
    sourcemap: false,
  },
});

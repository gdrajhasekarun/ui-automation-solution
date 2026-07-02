import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { registryPlugin } from './vite-plugin-registry.js'

export default defineConfig(({ command }) => ({
  // Vite needs to know its own mount path or it emits root-absolute asset URLs
  // (e.g. /@react-refresh) that the gateway has no route for. The dev server is
  // routed as "ui-dashboard" (/ui-dashboard/**), but the production build is
  // bundled into the "dashboard" service's static dir and routed as /dashboard/**
  // instead — so the two need different base paths.
  base: command === 'build' ? '/dashboard/' : '/ui/',
  plugins: [
    react(),
    registryPlugin({
      catalogUrl: 'http://localhost:8761',
      name:       'ui',
      port:       3000,
      healthPath: '/',
      // Vite's own `base` (set above) already accounts for the /ui-dashboard/ mount
      // path, so the gateway must forward the full path instead of stripping it —
      // otherwise Vite redirects back to its base and the gateway strips it again,
      // producing an infinite 302 loop.
      metadata:   { stripPrefix: 'false' },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      // /dashboard/api/... -> strip /dashboard prefix -> localhost:8000/api/...
      // This matches how the gateway routes it: /dashboard/** -> StripPrefix=1 -> dashboard:8000
      '/dashboard/api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/dashboard/, ''),
      },
    }
  },
  build: {
    outDir: '../services/dashboard/static',
    emptyOutDir: true,
  }
}))

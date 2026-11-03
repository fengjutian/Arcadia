import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  // Pre-bundle every Tauri API subpath the renderer imports. Without this,
  // adding a new subpath (e.g. `@tauri-apps/api/path`) while the dev server is
  // already running triggers a re-optimization; in-flight dynamic imports then
  // get 504 "Outdated Optimize Dep" and the page dies with "Failed to fetch
  // dynamically imported module".
  optimizeDeps: {
    include: [
      '@tauri-apps/api/core',
      '@tauri-apps/api/event',
      '@tauri-apps/api/path',
      '@tauri-apps/api/window',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ['react-markdown', 'remark-gfm'],
          tauri: ['@tauri-apps/api'],
        },
      },
    },
  },
})

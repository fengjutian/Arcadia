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
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  build: {
    // Keep Vite's advisory threshold aligned with the enforced bundle budget.
    // `npm run check:bundle` remains the source of truth and fails above 600 KiB.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll('\\', '/')
          if (!moduleId.includes('/node_modules/')) return undefined
          if (moduleId.includes('/@assistant-ui/')) return 'assistant-ui'
          if (/\/(react|react-dom|scheduler)\//.test(moduleId)) return 'react-vendor'
          if (moduleId.includes('/lucide-react/')) return 'icons'
          if (/\/(react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|unist-)/.test(moduleId)) return 'markdown'
          if (moduleId.includes('/@tauri-apps/')) return 'tauri'
          return undefined
        },
      },
    },
  },
})

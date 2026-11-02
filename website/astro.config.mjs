import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

const yamlEsm = fileURLToPath(new URL('./src/lib/yaml-esm.mjs', import.meta.url));

export default defineConfig({
  site: 'https://arcadia-browser.netlify.app',
  output: 'static',
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    resolve: { alias: { yaml: yamlEsm } },
  },
});

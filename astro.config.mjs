import { defineConfig } from 'astro/config';

// Sitio estático para GitHub Pages. El backend de voz vive aparte (Cloudflare Worker, carpeta worker/).
// SITE_URL y SITE_BASE cambian si usas dominio propio (en ese caso SITE_BASE=/).
export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || 'https://ingmatrix-pgb.github.io',
  base: process.env.SITE_BASE || '/habla-con-pablo',
});

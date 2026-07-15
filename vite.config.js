import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/proxy/mototally': {
        target: 'https://www.moto-tally.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/proxy\/mototally/, '')
      }
    }
  }
});

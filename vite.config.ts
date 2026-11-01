import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5190,
    // Keep the browser Host: the API compares it with Origin on writes (Nginx does the same with `Host $host`).
    proxy: {
      '/graphql': { target: 'http://127.0.0.1:5191', changeOrigin: false },
      '/api': { target: 'http://127.0.0.1:5191', changeOrigin: false },
      '/auth': { target: 'http://127.0.0.1:5191', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})

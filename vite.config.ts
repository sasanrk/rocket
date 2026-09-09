import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the built files load over file:// inside Electron.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})

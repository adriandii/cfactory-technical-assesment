import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev only: forward API calls to the backend. In Docker, nginx does the same.
    proxy: { '/api': 'http://localhost:3000' },
  },
})

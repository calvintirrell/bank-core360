import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Project site: served at https://calvintirrell.github.io/bank-core360/
export default defineConfig({
  base: '/bank-core360/',
  plugins: [react(), tailwindcss()],
})

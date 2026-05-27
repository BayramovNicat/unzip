import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@holmityd/unzip',
        replacement: fileURLToPath(new URL('./packages/unzip/src/index.ts', import.meta.url)),
      },
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
    ],
  },
})

import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    // A janela flutuante tem um preload próprio, com só o que ela precisa.
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), pip: resolve('src/preload/pip.ts') } } }
  },
  renderer: {
    resolve: {
      alias: { ...shared, '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()],
    // Fontes viram arquivo em vez de data: URI, para o CSP não precisar de font-src data:
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html'), pip: resolve('src/renderer/pip.html') } },
      assetsInlineLimit: (filePath: string) =>
        /\.(woff2?|ttf|otf|eot)$/.test(filePath) ? false : undefined
    }
  }
})

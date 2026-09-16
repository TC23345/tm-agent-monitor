import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // The usage worker is forked as a utilityProcess from out/main/usageWorker.js.
          usageWorker: resolve('src/main/usageWorker.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // Sandboxed Electron preloads execute as CommonJS; ESM imports fail in
        // the sandbox bundle even when the application package is type=module.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    // `.wgsl` imports as `{ wgsl }` modules for the session field (SessionField.tsx).
    plugins: [react(), wgslVitePlugin({ minify: { whitespace: true } })]
  }
})

import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/funnel/',
  plugins: [solid(), tailwindcss()],
  build: {
    target: 'esnext',
    outDir: 'dist/funnel',
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [{ name: 'ort', test: /@huggingface\/transformers/ }],
        },
        assetFileNames: (info) => {
          if (info.name?.endsWith('.wasm')) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    // depth chunk + ort wasm are lazy-loaded on first Convert, not first paint.
    chunkSizeWarningLimit: 3000,
  },
  optimizeDeps: {
    // transformers.js ships large onnx/wasm payloads — keep out of prebundle
    // until we wire the real WebGPU depth pipeline.
    exclude: ['@huggingface/transformers'],
  },
  server: {
    headers: {
      // Required later for transformers.js multithreading (SharedArrayBuffer)
      // + WebGPU model workers. Harmless for the UI shell now.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})

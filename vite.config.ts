import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dts from 'vite-plugin-dts';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    preact(),
    dts({
      include: ['src'],
      exclude: ['src/__tests__'],
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['preact', 'preact/hooks', 'preact/jsx-runtime', 'home-assistant-js-websocket'],
    },
    outDir: 'dist',
    minify: false,
    sourcemap: true,
  },
});

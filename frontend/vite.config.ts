import fs from 'node:fs';
import { compression } from 'vite-plugin-compression2';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: '../internal/assets/dist',
    rollupOptions: {
      output: {
        assetFileNames: `assets/[name].[ext]`,
        chunkFileNames: `assets/[name].js`,
        entryFileNames: `assets/[name].js`,
      },
    },
    target: 'es2022',
  },
  plugins: [
    compression({ algorithms: ['gzip', 'brotliCompress'], exclude: [/\.(?<ext>br|gz)$/u] }),
    {
      apply: 'build',
      closeBundle(): void {
        fs.writeFileSync('../internal/assets/dist/.gitkeep', '');
      },
      name: 'preserve-gitkeep',
    },
  ],
  server: {
    port: 3000,
  },
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text'],
    },
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/setup.ts'],
  },
});

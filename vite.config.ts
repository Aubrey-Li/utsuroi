import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // three.js's WebGPU build is most of the bundle; it's one download, cached after.
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5199 },
  test: { include: ['tests/**/*.test.ts'] },
});

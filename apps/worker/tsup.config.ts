import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,

  /**
   * Bundle EVERYTHING, including node_modules.
   *
   * By default tsup treats dependencies as external, which produced a 4 KB
   * bundle that imports `postgres` and `drizzle-orm` at runtime. The runtime
   * image copies only `dist`, so that binary crashes on its first import with
   * "cannot find module" — and it crashes in the container, not in CI.
   *
   * Bundling also sidesteps having to reproduce pnpm's symlinked node_modules
   * inside the image, which is the other way this goes wrong.
   */
  noExternal: [/.*/],

  // Trims the bundle but keeps a readable stack trace when the worker throws.
  minify: false,
  sourcemap: true,
});

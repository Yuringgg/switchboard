import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,

  /**
   * Bundle everything EXCEPT the embedding runtime.
   *
   * ── Why bundle at all ────────────────────────────────────────────────────
   *
   * By default tsup treats dependencies as external, which produced a 4 KB
   * bundle that imports `postgres` and `drizzle-orm` at runtime. The runtime
   * image copies only `dist`, so that binary crashed on its first import with
   * "cannot find module" — in the container, not in CI. Bundling also sidesteps
   * reproducing pnpm's symlinked node_modules inside the image.
   *
   * ── Why this is a negative lookahead rather than "match everything" ──────
   *
   * `noExternal` WINS over `external` in tsup. While this pattern matched every
   * module, the `external` list below was silently ignored: the build inlined
   * `@huggingface/transformers` (1.5 MB) and emitted five native
   * `onnxruntime_binding.node` files beside the bundle. It reported success.
   * Running it then failed with `(0, backend_2.listSupportedBackends) is not a
   * function` — a bundling artefact naming nothing recognisable, which would
   * have shipped as "embeddings mysteriously do not work in production".
   *
   * So the everything-else rule has to name its exceptions itself.
   */
  noExternal: [/^(?!@huggingface\/transformers|onnxruntime-)/],

  /**
   * ⚠ The exceptions, and they are exceptions for a hard reason.
   *
   * `@huggingface/transformers` depends on `onnxruntime-node`, which ships
   * native `.node` binaries. **esbuild cannot inline a native binary.** That is
   * the same class of failure as the `google-auth-library` crash that
   * `test/import-boundary.test.ts` exists to prevent, and it has already cost
   * this project a container twice.
   *
   * These therefore stay as runtime imports, and the Docker runtime stage
   * installs them with npm — a flat `node_modules` that plain `node` resolves.
   *
   * `packages/ai` imports them **dynamically**, so a worker whose image is
   * missing them degrades to "no embeddings" instead of failing to boot. Mail
   * keeps flowing. See `src/embed.ts` and the startup handler in `src/index.ts`.
   */
  external: ['@huggingface/transformers', /^onnxruntime/],

  // Trims the bundle but keeps a readable stack trace when the worker throws.
  minify: false,
  sourcemap: true,
});

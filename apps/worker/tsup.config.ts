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
  noExternal: [/^(?!@huggingface\/transformers|onnxruntime-|@azure\/|unpdf|tesseract\.js)/],

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
  external: ['@huggingface/transformers', /^onnxruntime/, /^@azure\//, /^unpdf/, /^tesseract\.js/],

  /*
   * ⚠ `@azure/*` joined this list on 2026-09-29, the hard way. The Azure SDK
   * reaches `https-proxy-agent`, which does `require('net')` — CommonJS, like
   * google-auth-library. Bundled into this ESM file it threw "Dynamic require
   * of \"net\" is not supported" at load, and revision 0000019 never started.
   * It is installed by npm in the runtime stage and imported dynamically in
   * `index.ts`, so a missing copy switches the file sweep off, not the worker.
   *
   * `unpdf` joined it on 2026-10-06, by choice rather than after a crash: it
   * loads PDF.js's own build with a dynamic import of a file beside it, which
   * a bundler can rewrite into something that only fails at runtime. Same
   * treatment — installed in the image, imported dynamically in
   * `file-text.ts`, so a missing copy leaves PDFs unread, nothing more.
   *
   * `tesseract.js` (pictures, the same evening) for a harder reason: it runs
   * its engine in a `worker_threads` worker loaded from a FILE PATH inside its
   * own package, plus a WebAssembly core. Bundled, that path points nowhere.
   */

  // Trims the bundle but keeps a readable stack trace when the worker throws.
  minify: false,
  sourcemap: true,
});

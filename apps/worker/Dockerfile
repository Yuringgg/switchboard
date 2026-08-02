# syntax=docker/dockerfile:1

# ── build ───────────────────────────────────────────────────────────────────
# Built from the REPOSITORY ROOT, not from apps/worker:
#   docker build -f apps/worker/Dockerfile .
# The worker depends on several workspace packages, so the build context has to
# include the whole repo, not just apps/worker.
FROM node:22-slim AS build

WORKDIR /repo
RUN corepack enable || npm install -g pnpm@11.17.0

# The whole packages tree, not an enumerated list of manifests.
#
# This previously copied packages/core and packages/db by name, which broke the
# moment the worker took a dependency on packages/adapters/gmail: pnpm could not
# resolve a workspace package whose manifest was not in the image, and the build
# failed in CI rather than anywhere near the change that caused it.
#
# Enumerating buys a slightly tighter dependency layer and costs a broken build
# every time a package is added. Copying the tree is worth the extra seconds.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages
COPY apps/worker/package.json apps/worker/

# Scripts are NOT skipped, deliberately. `--ignore-scripts` looks like the
# careful choice here, but esbuild's install script is what puts its native
# binary in place, and tsup runs on esbuild — so the build fails later, at
# bundling, for a reason that points nowhere near dependency installation.
#
# The root `prepare` hook runs `git config` and this image has no git, but it
# ends in `|| exit 0`, so it is a no-op rather than a failure.
#
# pnpm-workspace.yaml's allowBuilds decides which scripts may run: esbuild yes,
# sharp no.
RUN pnpm install --frozen-lockfile --filter @switchboard/worker...

COPY apps/worker apps/worker

# tsup bundles the workspace dependencies in, which is what makes the runtime
# image independent of the pnpm symlink farm.
RUN pnpm --filter @switchboard/worker build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# ── The one thing tsup could not bundle ──────────────────────────────────────
#
# `@huggingface/transformers` runs the embedding model (Phase 4B, ADR-003) and
# depends on `onnxruntime-node`, which ships native `.node` binaries. esbuild
# cannot inline those, so `tsup.config.ts` marks them external and they have to
# exist on disk at runtime.
#
# Installed with **npm, not pnpm**, and deliberately: npm writes a flat
# `node_modules` that a plain `node dist/index.js` resolves without any
# workspace linking. Reproducing pnpm's symlink farm in the runtime stage is the
# other way this goes wrong, and the Dockerfile above already avoids it once.
#
# Done as root BEFORE dropping to `node`, because npm needs to write here and
# the native postinstall has to run — skip it and the package resolves but
# cannot construct an inference session, which surfaces as "embeddings are
# silently unavailable" rather than as an install error.
#
# ⚠ The version is pinned to match `packages/ai/package.json`. A mismatch means
# the vectors in `message_chunks` were produced by a different model build than
# the one answering queries, which does not error — it just ranks badly.
# ⚠ Write the manifest FIRST, with `"type": "module"`.
#
# `npm install` in an empty directory creates a package.json without it, and the
# bundle tsup emits is ESM. Node then warns MODULE_TYPELESS_PACKAGE_JSON and
# "reparses as an ES module… this incurs a performance overhead" — on every
# start, forever. Caught by running the bundle against a simulated copy of this
# exact layout, because this image cannot be built locally to check.
RUN printf '{"name":"switchboard-worker-runtime","private":true,"type":"module"}\n' > package.json

RUN npm install --omit=dev --no-audit --no-fund @huggingface/transformers@4.2.0 \
 && chown -R node:node /app

# Never run as root.
USER node

COPY --from=build --chown=node:node /repo/apps/worker/dist ./dist

# Where Transformers.js caches model weights (~129 MB, quantised).
#
# Under the app directory rather than the default `~/.cache`, so it is writable
# by the `node` user and survives for the life of the container. The worker runs
# `minReplicas: 1` (ADR-011) precisely so this download happens once per
# revision rather than once per request.
ENV MODEL_CACHE_DIR=/app/.model-cache
RUN mkdir -p /app/.model-cache

EXPOSE 8080

# No shell wrapper: node must be PID 1 so it receives SIGTERM directly when
# Container Apps replaces a revision. Wrapped in `sh -c`, the signal goes to the
# shell and the worker is killed mid-event instead of draining.
CMD ["node", "dist/index.js"]

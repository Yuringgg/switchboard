# syntax=docker/dockerfile:1

# ── build ───────────────────────────────────────────────────────────────────
# Built from the REPOSITORY ROOT, not from apps/worker:
#   docker build -f apps/worker/Dockerfile .
# The worker depends on @switchboard/db and @switchboard/core as workspace
# packages, so the build context has to include them.
FROM node:22-slim AS build

WORKDIR /repo
RUN corepack enable || npm install -g pnpm@11.17.0

# Manifests first, so a code change does not invalidate the dependency layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json      packages/core/
COPY packages/db/package.json        packages/db/
COPY apps/worker/package.json        apps/worker/

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

COPY packages/core packages/core
COPY packages/db   packages/db
COPY apps/worker   apps/worker
COPY tsconfig.base.json ./

# tsup bundles the workspace dependencies in, which is what makes the runtime
# image independent of the pnpm symlink farm.
RUN pnpm --filter @switchboard/worker build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Never run as root.
USER node

COPY --from=build --chown=node:node /repo/apps/worker/dist ./dist

EXPOSE 8080

# No shell wrapper: node must be PID 1 so it receives SIGTERM directly when
# Container Apps replaces a revision. Wrapped in `sh -c`, the signal goes to the
# shell and the worker is killed mid-event instead of draining.
CMD ["node", "dist/index.js"]

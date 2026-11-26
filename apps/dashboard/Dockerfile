# syntax=docker/dockerfile:1
# The GOD dashboard image. Built ON server-f, never on the laptop or Helios (scripts/deploy/dashboard-to-helios.sh):
#   docker build -f apps/dashboard/Dockerfile --build-arg GIT_SHA=<sha> -t god-dashboard:<sha> <repo root>
# Build context is the repo root (see .dockerignore). One image, two jobs:
#   default CMD            the Next.js server  (node apps/dashboard/server.js)
#   node /app/db/src/cli.ts  the migration runner (@god/db), run by the deploy script before the container is swapped

FROM node:24-bookworm AS build
ENV CI=1 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN npm i -g pnpm@12.6.0 --no-audit --no-fund --loglevel=error
WORKDIR /repo
COPY . .
# The lockfile is frozen: remote-build.sh rewrites it on server-f, and the rewritten file must be committed first.
RUN --mount=type=cache,id=god-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --reporter=append-only \
      --filter @god/dashboard... --filter @god/db...
RUN pnpm --filter @god/dashboard build
# @god/db with only its production dependencies (pg): the migrations, the runner, nothing else.
RUN pnpm --filter @god/db deploy --prod /out/db

FROM node:24-bookworm-slim AS runtime
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="god-dashboard" org.opencontainers.image.revision="${GIT_SHA}"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 GOD_BUILD_SHA="${GIT_SHA}"
WORKDIR /app
# Next's standalone output: server.js lands in apps/dashboard because the trace root is the repo root.
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build --chown=node:node /repo/apps/dashboard/public ./apps/dashboard/public
COPY --from=build --chown=node:node /out/db /app/db
# Non-root (uid 1000). Nothing writes to the image at runtime except .next/cache, which compose mounts as tmpfs.
USER node
EXPOSE 3000
# No curl in the slim image: Node's own fetch. PORT is the one the server listens on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/dashboard/server.js"]

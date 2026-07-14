FROM node:24.7.0-bookworm-slim AS build
WORKDIR /workspace
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
COPY apps/sync-worker/package.json apps/sync-worker/package.json
RUN npm ci --workspace @edt/sync-worker --include-workspace-root
COPY apps/sync-worker apps/sync-worker
COPY docs/enterprise-digital-twin/fixtures/h1 docs/enterprise-digital-twin/fixtures/h1
RUN npm run build -w @edt/sync-worker

FROM node:24.7.0-bookworm-slim
ENV NODE_ENV=production PORT=8090 EDT_FIXTURE_ROOT=/workspace/docs/enterprise-digital-twin/fixtures/h1
WORKDIR /workspace
RUN groupadd --system --gid 10002 edt && useradd --system --uid 10002 --gid edt --home /nonexistent edt
COPY --from=build --chown=edt:edt /workspace/node_modules ./node_modules
COPY --from=build --chown=edt:edt /workspace/apps/sync-worker/dist ./apps/sync-worker/dist
COPY --from=build --chown=edt:edt /workspace/docs/enterprise-digital-twin/fixtures/h1 ./docs/enterprise-digital-twin/fixtures/h1
USER 10002:10002
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:8090/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/sync-worker/dist/main.js"]

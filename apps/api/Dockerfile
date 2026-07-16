FROM node:24.7.0-bookworm-slim AS build
WORKDIR /workspace
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace @edt/api --include-workspace-root
COPY apps/api apps/api
COPY docs/enterprise-digital-twin/fixtures/h1 docs/enterprise-digital-twin/fixtures/h1
COPY docs/enterprise-digital-twin/contracts/schemas/event-intelligence-event-changed.v1.schema.json docs/enterprise-digital-twin/contracts/schemas/event-intelligence-event-changed.v1.schema.json
RUN npm run build -w @edt/api

FROM node:24.7.0-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 EDT_FIXTURE_ROOT=/workspace/docs/enterprise-digital-twin/fixtures/h1
WORKDIR /workspace
RUN groupadd --system --gid 10001 edt && useradd --system --uid 10001 --gid edt --home /nonexistent edt
COPY --from=build --chown=edt:edt /workspace/node_modules ./node_modules
COPY --from=build --chown=edt:edt /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=edt:edt /workspace/apps/api/db ./apps/api/db
COPY --from=build --chown=edt:edt /workspace/docs/enterprise-digital-twin/fixtures/h1 ./docs/enterprise-digital-twin/fixtures/h1
COPY --from=build --chown=edt:edt /workspace/docs/enterprise-digital-twin/contracts/schemas/event-intelligence-event-changed.v1.schema.json ./docs/enterprise-digital-twin/contracts/schemas/event-intelligence-event-changed.v1.schema.json
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]

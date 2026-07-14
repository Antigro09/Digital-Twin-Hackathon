FROM node:24.7.0-bookworm-slim AS build
WORKDIR /workspace
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ARG NEXT_PUBLIC_ENABLE_DEMO_DATA=false
ENV NEXT_TELEMETRY_DISABLED=1 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_ENABLE_DEMO_DATA=${NEXT_PUBLIC_ENABLE_DEMO_DATA}
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @edt/web --include-workspace-root
COPY apps/web apps/web
RUN npm run build -w @edt/web

FROM node:24.7.0-bookworm-slim AS runtime
WORKDIR /workspace
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 10003 edt && useradd --system --uid 10003 --gid edt --home /nonexistent edt
COPY --from=build --chown=edt:edt /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=edt:edt /workspace/apps/web/.next/static ./apps/web/.next/static
USER 10003:10003
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:3000').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

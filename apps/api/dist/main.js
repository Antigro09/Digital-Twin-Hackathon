"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const adapter = new platform_fastify_1.FastifyAdapter({
        bodyLimit: 7_100_000,
        requestTimeout: 10_000,
        trustProxy: false,
        routerOptions: { ignoreTrailingSlash: false },
        ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: true } },
    });
    const app = await core_1.NestFactory.create(app_module_1.AppModule, adapter, { bufferLogs: true });
    app.useLogger(new common_1.Logger('EDT-API'));
    app.enableCors({
        origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','),
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'if-match', 'last-event-id', 'x-demo-auth-key', 'x-edt-context', 'x-request-id'],
        exposedHeaders: ['etag', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset'],
        credentials: true,
        maxAge: 600,
    });
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onSend', (_request, reply, payload, done) => {
        reply.header('x-content-type-options', 'nosniff');
        reply.header('x-frame-options', 'DENY');
        reply.header('referrer-policy', 'no-referrer');
        reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
        if (_request.url.startsWith('/v1/twin'))
            reply.header('cache-control', 'private, no-store');
        done(null, payload);
    });
    app.enableShutdownHooks();
    const port = Number(process.env.PORT ?? 8080);
    await app.listen(port, '0.0.0.0');
    common_1.Logger.log(`Enterprise Digital Twin API listening on ${port}`, 'Bootstrap');
}
void bootstrap();
//# sourceMappingURL=main.js.map
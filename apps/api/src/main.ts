import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    bodyLimit: 1_048_576,
    requestTimeout: 10_000,
    trustProxy: false,
    ignoreTrailingSlash: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: true } },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true });
  app.useLogger(new Logger('EDT-API'));
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'if-match', 'last-event-id', 'x-demo-actor', 'x-edt-context', 'x-request-id'],
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
    done(null, payload);
  });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Enterprise Digital Twin API listening on ${port}`, 'Bootstrap');
}

void bootstrap();

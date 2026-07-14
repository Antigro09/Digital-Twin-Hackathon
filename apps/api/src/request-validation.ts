import { HttpStatus } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ProblemException } from './problem';

export function requireIdempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 16 || key.length > 128) {
    throw new ProblemException(HttpStatus.BAD_REQUEST, 'idempotency_key_required', 'Idempotency-Key must contain 16 to 128 characters.');
  }
  return key;
}

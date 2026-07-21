import { HttpStatus, Injectable } from '@nestjs/common';
import { RequestContext } from './domain';
import { ProblemException } from './problem';

@Injectable()
export class DecisionWorkerService {
  runSimulation(ctx: RequestContext, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call(ctx, '/v1/decision-simulations', payload, 'simulation');
  }

  runPrediction(ctx: RequestContext, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call(ctx, '/v1/predictions', payload, 'prediction');
  }

  validatePrediction(ctx: RequestContext, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call(ctx, '/v1/predictions/validate', payload, 'prediction validation');
  }

  private async call(ctx: RequestContext, path: string, payload: Record<string, unknown>, operation: string): Promise<Record<string, unknown>> {
    const configured = process.env.AI_WORKER_URL ?? 'http://127.0.0.1:8000';
    let endpoint: URL;
    try {
      endpoint = new URL(path, configured.endsWith('/') ? configured : `${configured}/`);
    } catch {
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'decision_worker_configuration_invalid', 'The intelligence worker endpoint is invalid.', false);
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'decision_worker_configuration_invalid', 'The intelligence worker endpoint must use HTTP or HTTPS.', false);
    }
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-tenant-id': ctx.tenantId,
          'x-internal-actor-id': ctx.actor.actor_id,
          'x-internal-permissions': ctx.actor.capabilities.join(','),
          ...(process.env.AI_WORKER_SHARED_SECRET ? { 'x-internal-service-token': process.env.AI_WORKER_SHARED_SECRET } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'decision_worker_unavailable', `The ${operation} worker is unavailable.`, true);
    }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const detail = typeof body.detail === 'string' ? body.detail : `The ${operation} worker rejected the request.`;
      const code = typeof body.code === 'string' ? body.code : 'decision_worker_rejected';
      throw new ProblemException(response.status >= 400 && response.status < 600 ? response.status : HttpStatus.BAD_GATEWAY, code, detail, response.status >= 500);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ProblemException(HttpStatus.BAD_GATEWAY, 'decision_worker_response_invalid', `The ${operation} worker returned an invalid response.`, true);
    }
    // Undici may materialize response objects in a separate JS realm. Normalize
    // through JSON so downstream plain-object validation remains structural.
    return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  }
}

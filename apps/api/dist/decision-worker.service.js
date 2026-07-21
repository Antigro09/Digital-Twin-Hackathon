"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DecisionWorkerService = void 0;
const common_1 = require("@nestjs/common");
const problem_1 = require("./problem");
let DecisionWorkerService = class DecisionWorkerService {
    runSimulation(ctx, payload) {
        return this.call(ctx, '/v1/decision-simulations', payload, 'simulation');
    }
    runPrediction(ctx, payload) {
        return this.call(ctx, '/v1/predictions', payload, 'prediction');
    }
    validatePrediction(ctx, payload) {
        return this.call(ctx, '/v1/predictions/validate', payload, 'prediction validation');
    }
    async call(ctx, path, payload, operation) {
        const configured = process.env.AI_WORKER_URL ?? 'http://127.0.0.1:8000';
        let endpoint;
        try {
            endpoint = new URL(path, configured.endsWith('/') ? configured : `${configured}/`);
        }
        catch {
            throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'decision_worker_configuration_invalid', 'The intelligence worker endpoint is invalid.', false);
        }
        if (!['http:', 'https:'].includes(endpoint.protocol)) {
            throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'decision_worker_configuration_invalid', 'The intelligence worker endpoint must use HTTP or HTTPS.', false);
        }
        let response;
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
        }
        catch {
            throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'decision_worker_unavailable', `The ${operation} worker is unavailable.`, true);
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = typeof body.detail === 'string' ? body.detail : `The ${operation} worker rejected the request.`;
            const code = typeof body.code === 'string' ? body.code : 'decision_worker_rejected';
            throw new problem_1.ProblemException(response.status >= 400 && response.status < 600 ? response.status : common_1.HttpStatus.BAD_GATEWAY, code, detail, response.status >= 500);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_GATEWAY, 'decision_worker_response_invalid', `The ${operation} worker returned an invalid response.`, true);
        }
        return JSON.parse(JSON.stringify(body));
    }
};
exports.DecisionWorkerService = DecisionWorkerService;
exports.DecisionWorkerService = DecisionWorkerService = __decorate([
    (0, common_1.Injectable)()
], DecisionWorkerService);
//# sourceMappingURL=decision-worker.service.js.map
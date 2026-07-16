"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemoAuthService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const problem_1 = require("./problem");
const TOKEN_HEADER = { alg: 'HS256', kid: 'edt-local-demo-v1', typ: 'JWT' };
const MAX_TOKEN_TTL_SECONDS = 15 * 60;
const MIN_SECRET_CHARACTERS = 32;
let DemoAuthService = class DemoAuthService {
    onModuleInit() {
        if (this.enabled)
            this.configuration();
    }
    get enabled() {
        return process.env.EDT_DEMO_AUTH === 'true';
    }
    issue(actor, nowSeconds = Math.floor(Date.now() / 1_000), requestedTtlSeconds) {
        this.assertEnabled();
        const { signingSecret, ttlSeconds } = this.configuration();
        const effectiveTtl = requestedTtlSeconds ?? ttlSeconds;
        if (!Number.isSafeInteger(effectiveTtl) || effectiveTtl < 1 || effectiveTtl > MAX_TOKEN_TTL_SECONDS) {
            throw new Error(`Demo access-token TTL must be between 1 and ${MAX_TOKEN_TTL_SECONDS} seconds.`);
        }
        const claims = {
            iss: 'edt-local-demo',
            aud: 'edt-api',
            sub: actor.actor_alias,
            actor_id: actor.actor_id,
            tenant_id: actor.tenant_id,
            iat: nowSeconds,
            exp: nowSeconds + effectiveTtl,
            jti: (0, node_crypto_1.randomUUID)(),
        };
        const encodedHeader = this.encode(TOKEN_HEADER);
        const encodedClaims = this.encode(claims);
        const signature = this.sign(`${encodedHeader}.${encodedClaims}`, signingSecret);
        return {
            access_token: `${encodedHeader}.${encodedClaims}.${signature}`,
            token_type: 'Bearer',
            expires_at: new Date(claims.exp * 1_000).toISOString(),
            expires_in: effectiveTtl,
            actor_alias: actor.actor_alias,
        };
    }
    authenticate(authorization) {
        this.assertEnabled();
        if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
            throw new problem_1.ProblemException(common_1.HttpStatus.UNAUTHORIZED, 'demo_bearer_required', 'A signed local-demo Bearer token is required.');
        }
        const token = authorization.slice('Bearer '.length).trim();
        const parts = token.split('.');
        if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
            this.invalidToken();
        const [encodedHeader, encodedClaims, suppliedSignature] = parts;
        const { signingSecret } = this.configuration();
        const expectedSignature = this.sign(`${encodedHeader}.${encodedClaims}`, signingSecret);
        const supplied = Buffer.from(suppliedSignature, 'base64url');
        const expected = Buffer.from(expectedSignature, 'base64url');
        if (supplied.toString('base64url') !== suppliedSignature || supplied.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(supplied, expected))
            this.invalidToken();
        const header = this.decode(encodedHeader);
        const claims = this.decode(encodedClaims);
        if (header.alg !== TOKEN_HEADER.alg || header.typ !== TOKEN_HEADER.typ || header.kid !== TOKEN_HEADER.kid)
            this.invalidToken();
        if (claims.iss !== 'edt-local-demo' || claims.aud !== 'edt-api')
            this.invalidToken();
        if (typeof claims.sub !== 'string'
            || typeof claims.actor_id !== 'string'
            || typeof claims.tenant_id !== 'string'
            || typeof claims.jti !== 'string'
            || !Number.isSafeInteger(claims.iat)
            || !Number.isSafeInteger(claims.exp))
            this.invalidToken();
        const issuedAt = Number(claims.iat);
        const expiresAt = Number(claims.exp);
        const now = Math.floor(Date.now() / 1_000);
        if (issuedAt > now + 30 || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TOKEN_TTL_SECONDS) {
            throw new problem_1.ProblemException(common_1.HttpStatus.UNAUTHORIZED, 'demo_token_expired', 'The local-demo access token is expired or outside its permitted lifetime.');
        }
        return {
            actorAlias: claims.sub,
            actorId: claims.actor_id,
            tenantId: claims.tenant_id,
            tokenId: claims.jti,
            expiresAt: new Date(expiresAt * 1_000).toISOString(),
        };
    }
    assertBootstrapKey(value) {
        this.assertEnabled();
        const { bootstrapKey } = this.configuration();
        if (typeof value !== 'string')
            this.invalidBootstrapKey();
        const supplied = (0, node_crypto_1.createHmac)('sha256', bootstrapKey).update(value, 'utf8').digest();
        const expected = (0, node_crypto_1.createHmac)('sha256', bootstrapKey).update(bootstrapKey, 'utf8').digest();
        if (!(0, node_crypto_1.timingSafeEqual)(supplied, expected))
            this.invalidBootstrapKey();
    }
    configuration() {
        const signingSecret = process.env.EDT_DEMO_AUTH_SECRET ?? '';
        const bootstrapKey = process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY ?? '';
        if (signingSecret.length < MIN_SECRET_CHARACTERS) {
            throw new Error(`EDT_DEMO_AUTH_SECRET must contain at least ${MIN_SECRET_CHARACTERS} characters when EDT_DEMO_AUTH=true.`);
        }
        if (bootstrapKey.length < MIN_SECRET_CHARACTERS) {
            throw new Error(`EDT_DEMO_AUTH_BOOTSTRAP_KEY must contain at least ${MIN_SECRET_CHARACTERS} characters when EDT_DEMO_AUTH=true.`);
        }
        const configuredTtl = Number(process.env.EDT_DEMO_AUTH_TTL_SECONDS ?? MAX_TOKEN_TTL_SECONDS);
        const ttlSeconds = Number.isSafeInteger(configuredTtl) && configuredTtl >= 60 && configuredTtl <= MAX_TOKEN_TTL_SECONDS
            ? configuredTtl
            : MAX_TOKEN_TTL_SECONDS;
        return { signingSecret, bootstrapKey, ttlSeconds };
    }
    assertEnabled() {
        if (!this.enabled) {
            throw new problem_1.ProblemException(common_1.HttpStatus.UNAUTHORIZED, 'demo_auth_disabled', 'Local-demo authentication is disabled; configure an external identity provider.');
        }
    }
    encode(value) {
        return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    }
    decode(value) {
        try {
            const bytes = Buffer.from(value, 'base64url');
            if (bytes.toString('base64url') !== value)
                this.invalidToken();
            return JSON.parse(bytes.toString('utf8'));
        }
        catch (error) {
            if (error instanceof problem_1.ProblemException)
                throw error;
            return this.invalidToken();
        }
    }
    sign(input, secret) {
        return (0, node_crypto_1.createHmac)('sha256', secret).update(input, 'utf8').digest('base64url');
    }
    invalidToken() {
        throw new problem_1.ProblemException(common_1.HttpStatus.UNAUTHORIZED, 'invalid_demo_token', 'The local-demo access token is invalid.');
    }
    invalidBootstrapKey() {
        throw new problem_1.ProblemException(common_1.HttpStatus.UNAUTHORIZED, 'invalid_demo_credentials', 'The local-demo bootstrap credential is invalid.');
    }
};
exports.DemoAuthService = DemoAuthService;
exports.DemoAuthService = DemoAuthService = __decorate([
    (0, common_1.Injectable)()
], DemoAuthService);
//# sourceMappingURL=demo-auth.service.js.map
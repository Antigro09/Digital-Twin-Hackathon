import { OnModuleInit } from '@nestjs/common';
import { ActorAlias, ActorRecord } from './domain';
export interface DemoSession {
    access_token: string;
    token_type: 'Bearer';
    expires_at: string;
    expires_in: number;
    actor_alias: ActorAlias;
}
export interface AuthenticatedDemoPrincipal {
    actorAlias: ActorAlias;
    actorId: string;
    tenantId: string;
    tokenId: string;
    expiresAt: string;
}
export declare class DemoAuthService implements OnModuleInit {
    onModuleInit(): void;
    get enabled(): boolean;
    issue(actor: ActorRecord, nowSeconds?: number, requestedTtlSeconds?: number): DemoSession;
    authenticate(authorization: string | string[] | undefined): AuthenticatedDemoPrincipal;
    assertBootstrapKey(value: string | string[] | undefined): void;
    private configuration;
    private assertEnabled;
    private encode;
    private decode;
    private sign;
    private invalidToken;
    private invalidBootstrapKey;
}

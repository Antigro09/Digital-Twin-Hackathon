import { OnModuleInit } from '@nestjs/common';
import { AssetControlPreview, AssetControlReceipt, AssetControlState, AssetTwinSnapshot, PhysicalAsset, TelemetryFrame } from './asset-twin.types';
import { DatabaseService } from './database.service';
import { RequestContext } from './domain';
export declare const ASTER_PUMP_ASSET_ID: string;
export declare const BEACON_PUMP_ASSET_ID: string;
export declare class AssetTwinService implements OnModuleInit {
    private readonly database;
    private readonly assets;
    private readonly previews;
    private readonly receipts;
    private readonly previewIdempotency;
    private readonly executionIdempotency;
    private readonly auditByTenant;
    constructor(database: DatabaseService);
    onModuleInit(): void;
    listAssets(ctx: RequestContext): {
        items: Array<PhysicalAsset & {
            can_control: boolean;
        }>;
        next_cursor: null;
        has_more: false;
    };
    getTwin(ctx: RequestContext, assetId: string): AssetTwinSnapshot;
    advanceTelemetry(ctx: RequestContext, assetId: string, limit: number): {
        asset_id: string;
        stream_status: 'live_simulation';
        samples: TelemetryFrame[];
        current_telemetry: TelemetryFrame;
        control_state: AssetControlState;
        health: {
            score: number;
            status: 'healthy' | 'watch' | 'warning' | 'critical';
        };
        synthetic: true;
    };
    previewControl(ctx: RequestContext, assetId: string, body: Record<string, unknown>, idempotencyKey: string): Promise<AssetControlPreview & {
        etag: string;
    }>;
    executeControl(ctx: RequestContext, assetId: string, previewId: string, ifMatch: string | undefined, idempotencyKey: string): Promise<AssetControlReceipt>;
    private assetForContext;
    private assertReadCapability;
    private canControl;
    private assertControlCapability;
    private parseCommand;
    private applyCommand;
    private safetyChecks;
    private publicPreview;
    private publicAsset;
    private analytics;
    private analyticsContributions;
    private failurePrediction;
    private createAsterPump;
    private createBeaconPump;
    private initialHistory;
    private telemetryFrame;
    private readingStatus;
    private components;
    private componentDescription;
    private lifecycle;
    private healthScore;
    private healthStatus;
    private reading;
    private regression;
    private minimumDeviation;
    private assertExactKeys;
    private mean;
    private standardDeviation;
    private round;
    private appendAudit;
    private isExpired;
    private idempotencyConflict;
    private notFound;
}

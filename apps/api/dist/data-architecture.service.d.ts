import { DatabaseService } from './database.service';
import { RequestContext } from './domain';
export declare class DataArchitectureService {
    private readonly database;
    constructor(database: DatabaseService);
    overview(ctx: RequestContext): Promise<Record<string, unknown>>;
    private assertAdmin;
}

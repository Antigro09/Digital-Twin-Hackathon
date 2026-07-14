"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.synchronizeTenant = synchronizeTenant;
const workflow_1 = require("@temporalio/workflow");
const { syncTenantActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '2 minutes',
    retry: { maximumAttempts: 5, initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '30 seconds' },
});
async function synchronizeTenant(tenantId) {
    return syncTenantActivity(tenantId);
}
//# sourceMappingURL=workflows.js.map
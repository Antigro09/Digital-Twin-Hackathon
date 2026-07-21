"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_EVENT_TYPES = exports.CONNECTOR_STATUSES = exports.CONNECTOR_KINDS = exports.DATA_PLANE_IDS = exports.EVENT_OUTCOMES = exports.EVENT_SEVERITIES = exports.EVENT_CATEGORIES = exports.DATA_FOUNDATION_SCHEMA_VERSION = void 0;
exports.DATA_FOUNDATION_SCHEMA_VERSION = 'edt.data-foundation/1.0.0';
exports.EVENT_CATEGORIES = [
    'employee_change',
    'system_failure',
    'customer_change',
    'financial_change',
    'market_change',
    'operational_change',
];
exports.EVENT_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
exports.EVENT_OUTCOMES = ['observed', 'mitigated', 'resolved', 'failed', 'unknown'];
exports.DATA_PLANE_IDS = ['application_data', 'graph_data', 'ai_knowledge', 'historical_metrics'];
exports.CONNECTOR_KINDS = ['erp', 'crm', 'hris', 'accounting', 'api', 'database', 'document'];
exports.CONNECTOR_STATUSES = ['draft', 'active', 'suspended', 'archived'];
exports.DEFAULT_EVENT_TYPES = [
    { type_id: 'edt.event/EmployeeChange', category: 'employee_change', display_name: 'Employee change', description: 'A workforce, role, ownership, or employment change.' },
    { type_id: 'edt.event/SystemFailure', category: 'system_failure', display_name: 'System failure', description: 'A technology service, application, infrastructure, or API failure.' },
    { type_id: 'edt.event/CustomerChange', category: 'customer_change', display_name: 'Customer change', description: 'A customer, account, contract, or service-consumption change.' },
    { type_id: 'edt.event/FinancialChange', category: 'financial_change', display_name: 'Financial change', description: 'A revenue, expense, cost, liability, or investment change.' },
    { type_id: 'edt.event/MarketChange', category: 'market_change', display_name: 'Market change', description: 'An external market, competitor, regulatory, or macroeconomic change.' },
    { type_id: 'edt.event/OperationalChange', category: 'operational_change', display_name: 'Operational change', description: 'A process, workflow, task, asset, equipment, or delivery change.' },
];
//# sourceMappingURL=data-foundation.types.js.map
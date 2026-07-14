"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireIdempotencyKey = requireIdempotencyKey;
const common_1 = require("@nestjs/common");
const problem_1 = require("./problem");
function requireIdempotencyKey(request) {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 16 || key.length > 128) {
        throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'idempotency_key_required', 'Idempotency-Key must contain 16 to 128 characters.');
    }
    return key;
}
//# sourceMappingURL=request-validation.js.map
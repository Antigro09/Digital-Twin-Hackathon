"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProblemException = void 0;
const common_1 = require("@nestjs/common");
class ProblemException extends common_1.HttpException {
    constructor(status, code, detail, retryable = false) {
        super({
            type: `https://enterprise-digital-twin.example/problems/${code}`,
            title: code.replaceAll('_', ' '),
            status,
            code,
            detail,
            instance: 'about:blank',
            trace_id: '00000000000000000000000000000000',
            retryable,
        }, status);
    }
}
exports.ProblemException = ProblemException;
//# sourceMappingURL=problem.js.map
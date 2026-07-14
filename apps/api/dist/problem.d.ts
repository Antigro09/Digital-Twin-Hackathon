import { HttpException, HttpStatus } from '@nestjs/common';
export declare class ProblemException extends HttpException {
    constructor(status: HttpStatus, code: string, detail: string, retryable?: boolean);
}

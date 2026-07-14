import { HttpException, HttpStatus } from '@nestjs/common';

export class ProblemException extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    detail: string,
    retryable = false,
  ) {
    super(
      {
        type: `https://enterprise-digital-twin.example/problems/${code}`,
        title: code.replaceAll('_', ' '),
        status,
        code,
        detail,
        instance: 'about:blank',
        trace_id: '00000000000000000000000000000000',
        retryable,
      },
      status,
    );
  }
}

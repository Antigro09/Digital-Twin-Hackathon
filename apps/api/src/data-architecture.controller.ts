import { Controller, Get, Header, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DataArchitectureService } from './data-architecture.service';

@Controller('/v1/twin')
export class DataArchitectureController {
  constructor(
    private readonly contexts: ContextService,
    private readonly architecture: DataArchitectureService,
  ) {}

  @Get('/data-architecture')
  @Header('Cache-Control', 'private, no-store')
  overview(@Req() request: FastifyRequest): Promise<Record<string, unknown>> {
    return this.architecture.overview(this.contexts.resolve(request));
  }
}

import { Body, Controller, Get, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DemoStoreService } from './demo-store.service';
import { ProblemException } from './problem';

@Controller('/v1')
export class KnowledgeController {
  constructor(private readonly contexts: ContextService, private readonly store: DemoStoreService) {}

  @Get('/entities')
  entities(@Req() request: FastifyRequest, @Query('page_size') pageSize?: string): object {
    const size = pageSize ? Number(pageSize) : 50;
    if (!Number.isInteger(size) || size < 1 || size > 100) throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_page_size', 'page_size must be between 1 and 100.');
    return this.store.listEntities(this.contexts.resolve(request), size);
  }

  @Get('/entities/:entityId')
  entity(@Req() request: FastifyRequest, @Param('entityId') entityId: string): Record<string, unknown> {
    return this.store.getEntity(this.contexts.resolve(request), entityId);
  }

  @Post('/graph/traversals')
  traversal(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>): Record<string, unknown> {
    return this.store.traverse(this.contexts.resolve(request), body);
  }
}

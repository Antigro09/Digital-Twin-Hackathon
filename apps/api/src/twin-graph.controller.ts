import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { requireIdempotencyKey } from './request-validation';
import { TwinGraphService } from './twin-graph.service';

@Controller('/v1/twin')
export class TwinGraphController {
  constructor(
    private readonly contexts: ContextService,
    private readonly graph: TwinGraphService,
  ) {}

  @Get('/node-types')
  listNodeTypes(@Req() request: FastifyRequest): Promise<Record<string, unknown>> {
    return this.graph.listNodeTypes(this.contexts.resolve(request));
  }

  @Post('/node-types')
  @HttpCode(HttpStatus.CREATED)
  async createNodeType(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.graph.createNodeType(this.contexts.resolve(request), body, requireIdempotencyKey(request));
    this.setEtag(response, result);
    return result;
  }

  @Get('/relationship-types')
  listRelationshipTypes(@Req() request: FastifyRequest): Promise<Record<string, unknown>> {
    return this.graph.listRelationshipTypes(this.contexts.resolve(request));
  }

  @Post('/relationship-types')
  @HttpCode(HttpStatus.CREATED)
  async createRelationshipType(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.graph.createRelationshipType(this.contexts.resolve(request), body, requireIdempotencyKey(request));
    this.setEtag(response, result);
    return result;
  }

  @Post('/search')
  search(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.graph.search(this.contexts.resolve(request), body);
  }

  @Get('/critical-nodes')
  criticalNodes(@Req() request: FastifyRequest, @Query('limit') limit?: string): Promise<Record<string, unknown>> {
    return this.graph.criticalNodes(this.contexts.resolve(request), limit);
  }

  @Post('/traversals')
  traverse(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.graph.traverse(this.contexts.resolve(request), body);
  }

  @Post('/impact-analysis')
  impactAnalysis(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.graph.analyzeImpact(this.contexts.resolve(request), body);
  }

  @Get('/nodes')
  listNodes(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, string | undefined>,
  ): Promise<Record<string, unknown>> {
    return this.graph.listNodes(this.contexts.resolve(request), {
      type_id: query.type_id,
      owner_id: query.owner_id,
      state: query.state as 'active' | 'archived' | undefined,
      query: query.query,
      limit: query.limit === undefined ? undefined : Number(query.limit),
    });
  }

  @Post('/nodes')
  @HttpCode(HttpStatus.CREATED)
  async createNode(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.graph.createNode(this.contexts.resolve(request), body, requireIdempotencyKey(request));
    this.setEtag(response, result);
    return result;
  }

  @Get('/nodes/:nodeId/dependencies')
  dependencies(
    @Req() request: FastifyRequest,
    @Param('nodeId') nodeId: string,
    @Query('max_depth') maxDepth?: string,
  ): Promise<Record<string, unknown>> {
    return this.graph.analyzeDependencies(this.contexts.resolve(request), nodeId, maxDepth);
  }

  @Get('/nodes/:nodeId')
  node(@Req() request: FastifyRequest, @Param('nodeId') nodeId: string): Promise<Record<string, unknown>> {
    return this.graph.getNode(this.contexts.resolve(request), nodeId);
  }

  @Patch('/nodes/:nodeId')
  async updateNode(
    @Req() request: FastifyRequest,
    @Param('nodeId') nodeId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.graph.updateNode(
      this.contexts.resolve(request),
      nodeId,
      body,
      requireIdempotencyKey(request),
      this.ifMatch(request),
    );
    this.setEtag(response, result);
    return result;
  }

  @Delete('/nodes/:nodeId')
  async archiveNode(
    @Req() request: FastifyRequest,
    @Param('nodeId') nodeId: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.graph.updateNode(
      this.contexts.resolve(request),
      nodeId,
      { state: 'archived' },
      requireIdempotencyKey(request),
      this.ifMatch(request),
    );
    this.setEtag(response, result);
    return result;
  }

  @Get('/relationships')
  listRelationships(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, string | undefined>,
  ): Promise<Record<string, unknown>> {
    return this.graph.listRelationships(this.contexts.resolve(request), {
      node_id: query.node_id,
      type_id: query.type_id,
      state: query.state as 'active' | 'archived' | undefined,
      limit: query.limit === undefined ? undefined : Number(query.limit),
    });
  }

  @Post('/relationships')
  @HttpCode(HttpStatus.CREATED)
  async createRelationship(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.graph.createRelationship(this.contexts.resolve(request), body, requireIdempotencyKey(request));
    this.setEtag(response, result);
    return result;
  }

  @Get('/relationships/:relationshipId')
  relationship(@Req() request: FastifyRequest, @Param('relationshipId') relationshipId: string): Promise<Record<string, unknown>> {
    return this.graph.getRelationship(this.contexts.resolve(request), relationshipId);
  }

  @Patch('/relationships/:relationshipId')
  async updateRelationship(
    @Req() request: FastifyRequest,
    @Param('relationshipId') relationshipId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.graph.updateRelationship(
      this.contexts.resolve(request),
      relationshipId,
      body,
      requireIdempotencyKey(request),
      this.ifMatch(request),
    );
    this.setEtag(response, result);
    return result;
  }

  @Delete('/relationships/:relationshipId')
  async archiveRelationship(
    @Req() request: FastifyRequest,
    @Param('relationshipId') relationshipId: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.graph.updateRelationship(
      this.contexts.resolve(request),
      relationshipId,
      { state: 'archived' },
      requireIdempotencyKey(request),
      this.ifMatch(request),
    );
    this.setEtag(response, result);
    return result;
  }

  private ifMatch(request: FastifyRequest): string | undefined {
    return typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
  }

  private setEtag(response: FastifyReply, result: Record<string, unknown>): void {
    if (typeof result.etag === 'string') response.header('etag', result.etag);
  }
}

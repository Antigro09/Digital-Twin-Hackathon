import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { IntegrationRegistryService } from './integration-registry.service';
import { requireIdempotencyKey } from './request-validation';

/**
 * Administration API for connector and MCP definitions. Definitions are
 * policy metadata only; isolated workers remain responsible for execution.
 */
@Controller('/v1/twin')
export class IntegrationRegistryController {
  constructor(
    private readonly contexts: ContextService,
    private readonly registry: IntegrationRegistryService,
  ) {}

  @Post('/connectors')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  async createConnector(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.registry.createConnector(this.contexts.resolve(request), body, requireIdempotencyKey(request));
    this.setEtag(response, result);
    return result;
  }

  @Get('/connectors')
  @Header('Cache-Control', 'private, no-store')
  listConnectors(@Req() request: FastifyRequest, @Query() query: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    return this.registry.listConnectors(this.contexts.resolve(request), query);
  }

  @Get('/connectors/:connectorId')
  @Header('Cache-Control', 'private, no-store')
  async connector(
    @Req() request: FastifyRequest,
    @Param('connectorId') connectorId: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.registry.getConnector(this.contexts.resolve(request), connectorId);
    this.setEtag(response, result);
    return result;
  }

  @Patch('/connectors/:connectorId')
  @Header('Cache-Control', 'private, no-store')
  async updateConnector(
    @Req() request: FastifyRequest,
    @Param('connectorId') connectorId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.registry.updateConnector(
      this.contexts.resolve(request),
      connectorId,
      body,
      requireIdempotencyKey(request),
      this.ifMatch(request),
    );
    this.setEtag(response, result);
    return result;
  }

  @Post('/mcp-servers')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  async createMcpServer(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.registry.createMcpServer(this.contexts.resolve(request), body, requireIdempotencyKey(request));
    this.setEtag(response, result);
    return result;
  }

  @Get('/mcp-servers')
  @Header('Cache-Control', 'private, no-store')
  listMcpServers(@Req() request: FastifyRequest, @Query() query: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    return this.registry.listMcpServers(this.contexts.resolve(request), query);
  }

  @Get('/mcp-servers/:serverId')
  @Header('Cache-Control', 'private, no-store')
  async mcpServer(
    @Req() request: FastifyRequest,
    @Param('serverId') serverId: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.registry.getMcpServer(this.contexts.resolve(request), serverId);
    this.setEtag(response, result);
    return result;
  }

  @Patch('/mcp-servers/:serverId')
  @Header('Cache-Control', 'private, no-store')
  async updateMcpServer(
    @Req() request: FastifyRequest,
    @Param('serverId') serverId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.registry.updateMcpServer(
      this.contexts.resolve(request),
      serverId,
      body,
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

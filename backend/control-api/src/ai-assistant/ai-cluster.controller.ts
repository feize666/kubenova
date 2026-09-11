import {
  BadRequestException,
  Body,
  Controller,
  Optional,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { ClusterAccessService } from '../common/cluster-access.service';
import {
  AiContextAggregatorService,
  sanitizeEvidence,
} from './ai-context-aggregator.service';
import { AiProviderService } from './ai-provider.service';

@Controller('api/clusters')
@UseGuards(AuthGuard)
export class AiClusterController {
  constructor(
    private readonly providers: AiProviderService,
    private readonly clusterAccessService: ClusterAccessService,
    @Optional() private readonly contextAggregator?: AiContextAggregatorService,
  ) {}

  @Post(':clusterId/ai/chat')
  async chat(
    @Param('clusterId') clusterId: string,
    @Body()
    body: {
      agentId?: string;
      message?: string;
      context?: Record<string, unknown>;
    },
    @Req() req: any,
  ) {
    const access = await this.clusterAccessService.assertCanRead(
      req.user?.user,
      clusterId,
    );
    const message = body?.message?.trim();
    if (!message) throw new BadRequestException('message is required');
    const context = sanitizeEvidence(body?.context || {});
    return this.providers.chat(body.agentId, [
      {
        role: 'user',
        content: `集群 ${access.clusterId}\n${message}\n上下文：${JSON.stringify(context)}`,
      },
    ]);
  }

  @Post(':clusterId/ai/analyze')
  async analyze(
    @Param('clusterId') clusterId: string,
    @Body() body: { agentId?: string; evidence?: Record<string, unknown> },
    @Req() req: any,
  ) {
    const access = await this.clusterAccessService.assertCanRead(
      req.user?.user,
      clusterId,
    );
    const evidence = sanitizeEvidence(body?.evidence || {});
    const context = this.contextAggregator
      ? await this.contextAggregator.collect(access.clusterId, { evidence })
      : {
          schemaVersion: '1.0',
          generatedAt: new Date().toISOString(),
          cluster: { id: access.clusterId },
          supplementalEvidence: evidence,
          degradedSources: ['server-context-aggregator'],
        };
    const prompt = [
      `请分析集群 ${access.clusterId} 当前健康状态。`,
      '只基于服务端聚合的观测上下文和用户补充证据输出：根因候选、影响范围、置信度、优先级建议和只读排障步骤。',
      '不要臆测未提供的数据；不要输出任何凭据、密钥、令牌、kubeconfig 或其内容。',
      `观测上下文：${JSON.stringify(context)}`,
    ].join('\n');
    return this.providers
      .chat(body.agentId, [{ role: 'user', content: prompt }])
      .then((result) => ({
        clusterId: access.clusterId,
        ...result,
        context,
        // Keep the legacy field for clients while returning only the sanitized supplement.
        evidence: context.supplementalEvidence,
        generatedAt: new Date().toISOString(),
      }));
  }
}

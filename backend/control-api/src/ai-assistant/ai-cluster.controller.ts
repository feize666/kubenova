import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Optional,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { ClusterAccessService } from '../common/cluster-access.service';
import {
  AiContextAggregatorService,
  sanitizeEvidence,
} from './ai-context-aggregator.service';
import { AiProviderService } from './ai-provider.service';
import { AiAssistantAccessService } from './ai-assistant-access.service';

@Controller('api/clusters')
@UseGuards(AuthGuard)
export class AiClusterController {
  constructor(
    private readonly providers: AiProviderService,
    private readonly clusterAccessService: ClusterAccessService,
    @Optional() private readonly contextAggregator?: AiContextAggregatorService,
    @Optional() private readonly aiAssistantAccess?: AiAssistantAccessService,
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
    const namespace = typeof body?.context?.namespace === 'string' ? body.context.namespace : undefined;
    if (this.aiAssistantAccess) {
      await this.aiAssistantAccess.authorize({
        userId: req.user?.user?.id,
        username: req.user?.user?.username,
        role: req.user?.user?.role === 'admin' ? 'platform-admin' : req.user?.user?.role,
      }, { clusterId: access.clusterId, namespace, requireScope: true });
    }
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
    // The current analyzer aggregates cluster-wide health, resources and events.
    // Scoped grants must not receive that broader context until aggregation is
    // namespace-filtered end to end.
    if (String(req.user?.user?.role ?? '').toLowerCase() !== 'admin' && String(req.user?.user?.role ?? '').toLowerCase() !== 'platform-admin') {
      throw new ForbiddenException('当前分析功能聚合全群集信息，仅平台管理员可用');
    }
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
    // Analysis receives a bounded operational snapshot. Large topology/event
    // payloads make the provider spend its whole timeout on context ingestion.
    const compactContext = JSON.stringify(context).slice(0, 12_000);
    const prompt = [
      `请分析集群 ${access.clusterId} 当前健康状态。`,
      '请使用中文，控制在 800 字以内。只基于服务端聚合的观测上下文和用户补充证据输出：根因候选、影响范围、置信度、优先级建议和只读排障步骤。',
      '不要臆测未提供的数据；不要输出任何凭据、密钥、令牌、kubeconfig 或其内容。',
      `观测上下文：${compactContext}`,
    ].join('\n');
    try {
      let result;
      try {
        result = await this.providers.chat(body.agentId, [{ role: 'user', content: prompt }]);
      } catch (error) {
        // Oversized/invalid snapshots can produce an empty provider response;
        // retry with an explicit data-unavailable answer instead of a fake diagnosis.
        if (!(error instanceof Error) || !error.message.includes('空内容')) throw error;
        result = await this.providers.chat(body.agentId, [{
          role: 'user',
          content: `请用中文说明集群 ${access.clusterId} 当前缺少可解析观测数据，列出需要补充的只读指标，控制在300字以内。不要臆测集群状态。`,
        }]);
      }
      return {
        clusterId: access.clusterId,
        ...result,
        context,
        // Keep the legacy field for clients while returning only the sanitized supplement.
        evidence: context.supplementalEvidence,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`AI 分析失败：${reason}`);
    }
  }
}

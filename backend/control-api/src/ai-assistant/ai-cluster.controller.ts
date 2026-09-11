import { BadRequestException, Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { ClusterAccessService } from '../common/cluster-access.service';
import { AiProviderService } from './ai-provider.service';

@Controller('api/clusters')
@UseGuards(AuthGuard)
export class AiClusterController {
  constructor(
    private readonly providers: AiProviderService,
    private readonly clusterAccessService: ClusterAccessService,
  ) {}

  @Post(':clusterId/ai/chat')
  async chat(
    @Param('clusterId') clusterId: string,
    @Body() body: { agentId?: string; message?: string; context?: Record<string, unknown> },
    @Req() req: any,
  ) {
    const access = await this.clusterAccessService.assertCanRead(
      req.user?.user,
      clusterId,
    );
    const message = body?.message?.trim();
    if (!message) throw new BadRequestException('message is required');
    return this.providers.chat(body.agentId, [{ role: 'user', content: `集群 ${access.clusterId}\n${message}\n上下文：${JSON.stringify(body.context || {})}` }]);
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
    const evidence = body?.evidence || {};
    return this.providers.chat(body.agentId, [{ role: 'user', content: `请分析集群 ${access.clusterId} 当前健康状态。只基于以下证据输出：根因候选、影响范围、置信度、优先级建议和只读排障步骤。证据：${JSON.stringify(evidence)}` }]).then((result) => ({ clusterId: access.clusterId, ...result, evidence, generatedAt: new Date().toISOString() }));
  }
}

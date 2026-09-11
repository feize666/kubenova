import { BadRequestException, Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { AiProviderService } from './ai-provider.service';

@Controller('api/clusters')
@UseGuards(AuthGuard)
export class AiClusterController {
  constructor(private readonly providers: AiProviderService) {}

  @Post(':clusterId/ai/chat')
  chat(@Param('clusterId') clusterId: string, @Body() body: { agentId?: string; message?: string; context?: Record<string, unknown> }, @Req() req: any) {
    const message = body?.message?.trim();
    if (!message) throw new BadRequestException('message is required');
    return this.providers.chat(body.agentId, [{ role: 'user', content: `集群 ${clusterId}\n${message}\n上下文：${JSON.stringify(body.context || {})}` }]);
  }

  @Post(':clusterId/ai/analyze')
  analyze(@Param('clusterId') clusterId: string, @Body() body: { agentId?: string; evidence?: Record<string, unknown> }) {
    const evidence = body?.evidence || {};
    return this.providers.chat(body.agentId, [{ role: 'user', content: `请分析集群 ${clusterId} 当前健康状态。只基于以下证据输出：根因候选、影响范围、置信度、优先级建议和只读排障步骤。证据：${JSON.stringify(evidence)}` }]).then((result) => ({ clusterId, ...result, evidence, generatedAt: new Date().toISOString() }));
  }
}

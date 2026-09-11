import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../platform/database/prisma.service';

export const AI_PROVIDER_VENDORS = [
  'openai',
  'azure-openai',
  'anthropic',
  'gemini',
  'qwen',
  'volcengine',
  'deepseek',
  'openai-compatible',
  'ollama',
] as const;
export type AiProviderVendor = (typeof AI_PROVIDER_VENDORS)[number];

export const AI_AGENT_TOOLS = [
  'query_prometheus',
  'query_elasticsearch',
  'list_active_alerts',
  'get_metric_range',
  'get_resource_events',
  'get_resource_topology',
  'get_pod_logs',
  'get_kubernetes_resource',
] as const;

export interface AiProviderInput {
  name: string;
  vendor: string;
  baseUrl: string;
  modelName: string;
  apiKey?: string;
  enabled?: boolean;
  isDefault?: boolean;
  config?: Record<string, unknown>;
}

export interface AiAgentInput {
  name: string;
  providerId: string;
  systemPrompt?: string;
  tools?: string[];
  enabled?: boolean;
  isDefault?: boolean;
}

export type AiActor = { id?: string; username?: string; role?: string };

function actorId(actor?: AiActor): string | undefined {
  return actor?.id?.trim() || undefined;
}

@Injectable()
export class AiProviderService {
  private readonly key = createHash('sha256')
    .update(process.env.AI_CREDENTIAL_ENCRYPTION_KEY || 'kubenova-development-key-change-me')
    .digest();

  constructor(private readonly prisma: PrismaService) {}

  listVendors(): Array<{ id: string; label: string; defaultBaseUrl: string }> {
    const labels: Record<string, string> = {
      openai: 'OpenAI',
      'azure-openai': 'Azure OpenAI',
      anthropic: 'Anthropic Claude',
      gemini: 'Google Gemini',
      qwen: '阿里云百炼 / Qwen',
      volcengine: '火山引擎 Ark / 豆包',
      deepseek: 'DeepSeek',
      'openai-compatible': 'OpenAI Compatible',
      ollama: 'Ollama（本地）',
    };
    return AI_PROVIDER_VENDORS.map((id) => ({
      id,
      label: labels[id],
      defaultBaseUrl: this.defaultBaseUrl(id),
    }));
  }

  async listProviders() {
    const providers = await this.prisma.aiProvider.findMany({
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    return providers.map((provider) => this.publicProvider(provider));
  }

  async createProvider(input: AiProviderInput, actor?: AiActor) {
    this.validateInput(input);
    const isDefault = Boolean(input.isDefault);
    if (isDefault) await this.prisma.aiProvider.updateMany({ data: { isDefault: false } });
    const key = input.apiKey?.trim();
    const provider = await this.prisma.aiProvider.create({
      data: {
        name: input.name.trim(),
        vendor: input.vendor,
        baseUrl: this.normalizeUrl(input.baseUrl),
        modelName: input.modelName.trim(),
        apiKeyCiphertext: key ? this.encrypt(key) : undefined,
        apiKeyLast4: key ? key.slice(-4) : undefined,
        enabled: input.enabled ?? true,
        isDefault,
        configJson: input.config as object | undefined,
      },
    });
    await this.audit(actor, 'create', provider.id, `创建 AI Provider ${provider.name}`);
    return this.publicProvider(provider);
  }

  async updateProvider(id: string, input: Partial<AiProviderInput>, actor?: AiActor) {
    const existing = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('AI Provider 不存在');
    if (input.vendor && !AI_PROVIDER_VENDORS.includes(input.vendor as AiProviderVendor)) {
      throw new BadRequestException('不支持的 AI Provider 厂商');
    }
    if (input.isDefault) await this.prisma.aiProvider.updateMany({ data: { isDefault: false } });
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.vendor !== undefined) data.vendor = input.vendor;
    if (input.baseUrl !== undefined) data.baseUrl = this.normalizeUrl(input.baseUrl);
    if (input.modelName !== undefined) data.modelName = input.modelName.trim();
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    if (input.config !== undefined) data.configJson = input.config;
    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim();
      data.apiKeyCiphertext = key ? this.encrypt(key) : null;
      data.apiKeyLast4 = key ? key.slice(-4) : null;
    }
    const provider = await this.prisma.aiProvider.update({ where: { id }, data });
    await this.audit(actor, 'update', id, `更新 AI Provider ${provider.name}`);
    return this.publicProvider(provider);
  }

  async deleteProvider(id: string, actor?: AiActor) {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException('AI Provider 不存在');
    await this.prisma.aiProvider.delete({ where: { id } });
    await this.audit(actor, 'delete', id, `删除 AI Provider ${provider.name}`);
    return { deleted: true, id };
  }

  async testProvider(id: string): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException('AI Provider 不存在');
    if (!provider.apiKeyCiphertext && provider.vendor !== 'ollama') {
      return { ok: false, latencyMs: 0, message: 'API Key 未配置' };
    }
    const started = Date.now();
    try {
      const response = await this.requestProvider(provider, [{ role: 'user', content: 'ping' }], 8_000);
      return { ok: true, latencyMs: Date.now() - started, message: response.slice(0, 200) || '连接成功' };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : '连接失败' };
    }
  }

  async listAgents() {
    const agents = await this.prisma.aiAgentProfile.findMany({
      include: { provider: true },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      providerId: agent.providerId,
      providerName: agent.provider.name,
      vendor: agent.provider.vendor,
      systemPrompt: agent.systemPrompt,
      tools: Array.isArray(agent.toolsJson) ? agent.toolsJson : [],
      enabled: agent.enabled,
      isDefault: agent.isDefault,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    }));
  }

  async createAgent(input: AiAgentInput, actor?: AiActor) {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id: input.providerId } });
    if (!provider) throw new NotFoundException('AI Provider 不存在');
    const tools = this.normalizeTools(input.tools);
    if (input.isDefault) await this.prisma.aiAgentProfile.updateMany({ data: { isDefault: false } });
    const agent = await this.prisma.aiAgentProfile.create({
      data: {
        name: input.name.trim(), providerId: input.providerId,
        systemPrompt: input.systemPrompt?.trim() || undefined,
        toolsJson: tools, enabled: input.enabled ?? true, isDefault: Boolean(input.isDefault),
      }, include: { provider: true },
    });
    await this.audit(actor, 'create', agent.id, `创建 AI Agent ${agent.name}`);
    return (await this.listAgents()).find((item) => item.id === agent.id);
  }

  async updateAgent(id: string, input: Partial<AiAgentInput>, actor?: AiActor) {
    const existing = await this.prisma.aiAgentProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('AI Agent 不存在');
    if (input.providerId) {
      const provider = await this.prisma.aiProvider.findUnique({ where: { id: input.providerId } });
      if (!provider) throw new NotFoundException('AI Provider 不存在');
    }
    if (input.isDefault) await this.prisma.aiAgentProfile.updateMany({ data: { isDefault: false } });
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.providerId !== undefined) data.providerId = input.providerId;
    if (input.systemPrompt !== undefined) data.systemPrompt = input.systemPrompt.trim();
    if (input.tools !== undefined) data.toolsJson = this.normalizeTools(input.tools);
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    await this.prisma.aiAgentProfile.update({ where: { id }, data });
    await this.audit(actor, 'update', id, `更新 AI Agent ${input.name ?? existing.name}`);
    return (await this.listAgents()).find((item) => item.id === id);
  }

  async chat(agentId: string | undefined, messages: Array<{ role: string; content: string }>) {
    const agent = agentId
      ? await this.prisma.aiAgentProfile.findUnique({ where: { id: agentId }, include: { provider: true } })
      : await this.prisma.aiAgentProfile.findFirst({ where: { enabled: true, isDefault: true }, include: { provider: true } });
    const provider = agent?.provider ?? await this.prisma.aiProvider.findFirst({ where: { enabled: true, isDefault: true } });
    if (!provider) throw new BadRequestException('未配置可用的 AI Provider');
    const content = await this.requestProvider(provider, messages, 30_000);
    return { content, providerId: provider.id, agentId: agent?.id };
  }

  private async requestProvider(provider: any, messages: Array<{ role: string; content: string }>, timeoutMs: number): Promise<string> {
    const key = provider.apiKeyCiphertext ? this.decrypt(provider.apiKeyCiphertext) : '';
    const vendor = provider.vendor as string;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let url = `${this.normalizeUrl(provider.baseUrl)}/chat/completions`;
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body: unknown = { model: provider.modelName, messages, max_tokens: 2048, temperature: 0.2 };
      if (key) headers.Authorization = `Bearer ${key}`;
      if (vendor === 'anthropic') {
        url = `${this.normalizeUrl(provider.baseUrl)}/messages`;
        headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
        body = { model: provider.modelName, max_tokens: 2048, messages: messages.filter((item) => item.role !== 'system') };
      } else if (vendor === 'gemini') {
        url = `${this.normalizeUrl(provider.baseUrl)}/models/${provider.modelName}:generateContent?key=${encodeURIComponent(key)}`;
        headers = { 'Content-Type': 'application/json' };
        body = { contents: messages.filter((item) => item.role !== 'system').map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })) };
      }
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      const raw = await response.text();
      let parsed: any = {};
      try { parsed = JSON.parse(raw); } catch { /* handled below */ }
      if (!response.ok) throw new Error(`Provider 返回 ${response.status}: ${String(parsed?.error?.message || parsed?.message || raw).slice(0, 240)}`);
      const content = parsed?.choices?.[0]?.message?.content || parsed?.content?.[0]?.text || parsed?.candidates?.[0]?.content?.parts?.[0]?.text || parsed?.output_text;
      if (!content) throw new Error('Provider 返回空内容');
      return String(content);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new ServiceUnavailableException('AI Provider 请求超时');
      throw error;
    } finally { clearTimeout(timer); }
  }

  private publicProvider(provider: any) {
    return { id: provider.id, name: provider.name, vendor: provider.vendor, baseUrl: provider.baseUrl, modelName: provider.modelName, apiKeyConfigured: Boolean(provider.apiKeyCiphertext), apiKeyLast4: provider.apiKeyLast4 || '', enabled: provider.enabled, isDefault: provider.isDefault, config: provider.configJson || {}, createdAt: provider.createdAt.toISOString(), updatedAt: provider.updatedAt.toISOString() };
  }
  private validateInput(input: AiProviderInput) {
    if (!input.name?.trim() || !input.baseUrl?.trim() || !input.modelName?.trim()) throw new BadRequestException('name、baseUrl、modelName 为必填项');
    if (!AI_PROVIDER_VENDORS.includes(input.vendor as AiProviderVendor)) throw new BadRequestException('不支持的 AI Provider 厂商');
    try { new URL(input.baseUrl); } catch { throw new BadRequestException('baseUrl 格式无效'); }
  }
  private normalizeTools(tools?: string[]) {
    const values = tools ?? [...AI_AGENT_TOOLS];
    const unknown = values.filter((tool) => !(AI_AGENT_TOOLS as readonly string[]).includes(tool));
    if (unknown.length) throw new BadRequestException(`Agent 工具未在白名单中: ${unknown.join(', ')}`);
    return [...new Set(values)];
  }
  private defaultBaseUrl(vendor: string) { const defaults: Record<string, string> = { openai: 'https://api.openai.com/v1', 'azure-openai': '', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta', qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1', volcengine: 'https://ark.cn-beijing.volces.com/api/v3', deepseek: 'https://api.deepseek.com/v1', 'openai-compatible': 'http://localhost:11434/v1', ollama: 'http://localhost:11434/v1' }; return defaults[vendor] || ''; }
  private normalizeUrl(value: string) { return value.trim().replace(/\/+$/, ''); }
  private encrypt(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`; }
  private decrypt(value: string) { const [ivRaw, tagRaw, dataRaw] = value.split('.'); const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivRaw, 'base64url')); decipher.setAuthTag(Buffer.from(tagRaw, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8'); }
  private async audit(actor: AiActor | undefined, action: string, resourceId: string, message: string) { await this.prisma.auditLog.create({ data: { actorUserId: actorId(actor), action, resourceType: 'AiProvider', resourceId, message } }).catch(() => undefined); }
}

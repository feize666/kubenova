/**
 * AI 模型配置持久化工具
 *
 * 配置存储路径：{项目根目录}/.env.ai.local
 * 格式：KEY=VALUE（每行一条，不需要引号）
 *
 * 启动时由 loadAiEnvFile() 读取并写入 process.env，
 * 运行时由 saveAiConfig() 更新内存与文件。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// 项目根目录：backend/control-api/src/../../../.. => 项目根
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const AI_ENV_FILE = resolve(PROJECT_ROOT, '.env.ai.local');

export interface AiModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  maxTokens: number;
  timeoutMs: number;
  isConfigured: boolean;
}

/** 从文件解析 KEY=VALUE 格式 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/** 将键值对序列化为 KEY=VALUE 格式 */
function serializeEnvFile(record: Record<string, string>): string {
  return (
    Object.entries(record)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n'
  );
}

/** 启动时调用，从 .env.ai.local 加载配置到 process.env */
export function loadAiEnvFile(): void {
  if (!existsSync(AI_ENV_FILE)) return;
  try {
    const content = readFileSync(AI_ENV_FILE, 'utf-8');
    const parsed = parseEnvFile(content);
    for (const [key, value] of Object.entries(parsed)) {
      // 只在 process.env 中不存在时写入，避免覆盖启动参数
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = value;
      }
    }
  } catch {
    // 忽略读取错误，不影响服务启动
  }
}

/** 读取当前 AI 配置（从 process.env） */
export function readAiConfig(): AiModelConfig {
  const apiKey = process.env.AI_MODEL_API_KEY || '';
  const rawBaseUrl =
    process.env.AI_MODEL_BASE_URL || 'https://api.openai.com/v1';
  return {
    baseUrl: rawBaseUrl.replace(/\/+$/, ''), // 去除末尾斜杠，防止URL拼接双斜杠
    apiKey,
    modelName: process.env.AI_MODEL_NAME || 'gpt-4o-mini',
    maxTokens: parseInt(process.env.AI_MODEL_MAX_TOKENS || '2048', 10),
    timeoutMs: parseInt(process.env.AI_MODEL_TIMEOUT_MS || '30000', 10),
    isConfigured: apiKey.length > 0,
  };
}

/**
 * 直接从文件读取 AI 配置，不依赖 process.env 缓存。
 * 用于每次 LLM 调用时获取最新配置，支持热更新（无需重启进程）。
 * 如果文件不存在则回退到 process.env。
 */
export function readAiConfigFromFile(): AiModelConfig {
  let fileEnv: Record<string, string> = {};
  if (existsSync(AI_ENV_FILE)) {
    try {
      fileEnv = parseEnvFile(readFileSync(AI_ENV_FILE, 'utf-8'));
    } catch {
      // 读取失败时回退到 process.env
    }
  }

  const get = (key: string, fallback: string): string =>
    fileEnv[key] || process.env[key] || fallback;

  const apiKey = get('AI_MODEL_API_KEY', '');
  const rawBaseUrl = get('AI_MODEL_BASE_URL', 'https://api.openai.com/v1');
  return {
    baseUrl: rawBaseUrl.replace(/\/+$/, ''),
    apiKey,
    modelName: get('AI_MODEL_NAME', 'gpt-4o-mini'),
    maxTokens: parseInt(get('AI_MODEL_MAX_TOKENS', '2048'), 10),
    timeoutMs: parseInt(get('AI_MODEL_TIMEOUT_MS', '30000'), 10),
    isConfigured: apiKey.length > 0,
  };
}

/**
 * 将新配置写入 process.env 并持久化到 .env.ai.local。
 * 空字符串表示清除该字段（从文件删除但不强制清空 process.env 中已有的值）。
 */
export function saveAiConfig(config: Partial<AiModelConfig>): AiModelConfig {
  // 读取现有文件内容（如果存在）
  let existing: Record<string, string> = {};
  if (existsSync(AI_ENV_FILE)) {
    try {
      existing = parseEnvFile(readFileSync(AI_ENV_FILE, 'utf-8'));
    } catch {
      // 忽略，使用空对象
    }
  }

  const updates: Record<string, string> = {};

  if (config.baseUrl !== undefined) {
    const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, ''); // 去除末尾斜杠
    updates['AI_MODEL_BASE_URL'] = normalizedBaseUrl;
    process.env.AI_MODEL_BASE_URL = normalizedBaseUrl;
  }
  if (config.apiKey !== undefined) {
    updates['AI_MODEL_API_KEY'] = config.apiKey;
    process.env.AI_MODEL_API_KEY = config.apiKey;
  }
  if (config.modelName !== undefined) {
    updates['AI_MODEL_NAME'] = config.modelName;
    process.env.AI_MODEL_NAME = config.modelName;
  }
  if (config.maxTokens !== undefined) {
    updates['AI_MODEL_MAX_TOKENS'] = String(config.maxTokens);
    process.env.AI_MODEL_MAX_TOKENS = String(config.maxTokens);
  }
  if (config.timeoutMs !== undefined) {
    updates['AI_MODEL_TIMEOUT_MS'] = String(config.timeoutMs);
    process.env.AI_MODEL_TIMEOUT_MS = String(config.timeoutMs);
  }

  const merged = { ...existing, ...updates };

  // 确保目录存在
  const dir = dirname(AI_ENV_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    writeFileSync(AI_ENV_FILE, serializeEnvFile(merged), 'utf-8');
  } catch {
    // 写入失败时不阻断响应，内存中的 process.env 已更新
  }

  return readAiConfig();
}

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { TopologyGraphV2Response } from './topology-graph.contract';

const DEFAULT_CACHE_TTL_SECONDS = 300;
const MIN_CACHE_TTL_SECONDS = 30;
const MAX_CACHE_TTL_SECONDS = 3600;

@Injectable()
export class TopologyGraphCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(TopologyGraphCacheService.name);
  private readonly redis: Redis;
  private readonly ttlSeconds: number;

  constructor() {
    this.ttlSeconds = boundedInteger(
      process.env.TOPOLOGY_GRAPH_V2_CACHE_TTL_SECONDS,
      DEFAULT_CACHE_TTL_SECONDS,
      MIN_CACHE_TTL_SECONDS,
      MAX_CACHE_TTL_SECONDS,
    );
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      connectTimeout: 1_000,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
    });
    this.redis.on('error', (error: Error) => {
      this.logger.warn(`topology-cache redis_error=${error.message}`);
    });
  }

  async get(key: string): Promise<TopologyGraphV2Response | null> {
    try {
      const value = await this.redis.get(key);
      if (!value) return null;
      const parsed = JSON.parse(value) as Partial<TopologyGraphV2Response>;
      if (
        parsed.schemaVersion !== '2.0' ||
        !Array.isArray(parsed.resources) ||
        !Array.isArray(parsed.relations)
      ) {
        this.logger.warn(`topology-cache invalid_payload key=${key}`);
        return null;
      }
      return parsed as TopologyGraphV2Response;
    } catch (error) {
      this.logger.warn(
        `topology-cache get_failed key=${key} error=${message(error)}`,
      );
      return null;
    }
  }

  async set(key: string, value: TopologyGraphV2Response): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `topology-cache set_failed key=${key} error=${message(error)}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}

export function boundedInteger(
  rawValue: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import type { AppConfig } from './platform/config/env.schema';
import { PrismaService } from './platform/database/prisma.service';

const scryptAsync = promisify(scrypt);

async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(plain, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  /**
   * 应用启动后自动 seed 默认管理员账号（若不存在）
   */
  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get<string>('defaultAdminEmail')!;
    const password = this.config.get<string>('defaultAdminPassword')!;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      this.logger.log(`[seed] admin already exists: ${email}`);
      return;
    }

    const passwordHash = await hashPassword(password);
    await this.prisma.user.create({
      data: {
        email,
        name: 'Admin',
        passwordHash,
        role: 'admin',
        isActive: true,
      },
    });

    this.logger.log(`[seed] default admin created: ${email}`);
  }
}

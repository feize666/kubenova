import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { AuthorizationInvalidation } from '../common/authorization-invalidation';
import { PrismaService } from '../platform/database/prisma.service';

@Injectable()
export class RuntimeInvalidationService implements OnModuleDestroy {
  private connection?: Promise<AuthorizationInvalidation>;
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    if (process.env.RUNTIME_PUSH_REVOCATION_ENABLED !== 'true') throw new ServiceUnavailableException('Runtime push revocation disabled');
    const pending = this.connection;
    if (pending) {
      const listener = await pending;
      if (!listener.available && this.connection === pending) {
        this.connection = undefined;
        await listener.close().catch(() => {});
      }
    }
    this.connection ??= this.connect().catch(error => { this.connection = undefined; throw error; });
    return this.connection;
  }

  private async connect() {
    const rows = await this.prisma.$queryRaw<Array<{ schema: string; count: bigint }>>`
      SELECT current_schema() AS schema, count(*) AS count FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND t.tgenabled='O'
      AND t.tgname IN ('kubenova_user_authorization_changed','kubenova_grant_authorization_changed')`;
    if (Number(rows[0]?.count) !== 2 || !process.env.DATABASE_URL) throw new ServiceUnavailableException('Authorization notification migration required');
    return AuthorizationInvalidation.connect(process.env.DATABASE_URL, rows[0].schema);
  }

  async onModuleDestroy() { await (await this.connection)?.close(); }
}

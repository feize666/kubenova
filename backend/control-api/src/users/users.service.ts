import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import {
  appendAudit,
  assertWritePermission,
  type PlatformRole,
} from '../common/governance';
import { PrismaService } from '../platform/database/prisma.service';

const scryptAsync = promisify(scrypt);

// ---------------------------------------------------------------------------
// Password helpers (bcrypt 未在依赖中，改用 Node.js 内置 crypto/scrypt)
// ---------------------------------------------------------------------------
async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(plain, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

// 对外暴露供 auth 模块复用（可选）
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derivedKey = (await scryptAsync(plain, salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(hash, 'hex');
  return timingSafeEqual(derivedKey, storedBuffer);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResourceState = 'active' | 'disabled';

interface Actor {
  username?: string;
  role?: PlatformRole;
}

type RbacBindingKind = 'RoleBinding' | 'ClusterRoleBinding';
type RbacSubjectKind = 'User' | 'Group' | 'ServiceAccount';

export interface RbacSubjectRef {
  kind?: RbacSubjectKind;
  name?: string;
  namespace?: string;
}

export interface UserListItem {
  id: string;
  username: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedUsersResult {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

export interface RbacListItem {
  id: string;
  name: string;
  kind: RbacBindingKind;
  namespace: string;
  subject: string;
  subjectKind: RbacSubjectKind;
  subjectNamespace: string;
  subjectRef?: {
    kind: RbacSubjectKind;
    name: string;
    namespace: string;
  };
  state: ResourceState;
  version: number;
  updatedAt: string;
}

export interface UsersListResponse {
  items: UserListItem[];
  total: number;
  timestamp: string;
}

export interface UsersRbacResponse {
  items: RbacListItem[];
  total: number;
  timestamp: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role?: string;
}

export interface UpdateUserRequest {
  username?: string;
  name?: string;
  role?: string;
  password?: string;
}

export interface CreateRbacRequest {
  name: string;
  kind: RbacBindingKind;
  namespace: string;
  subject?: string;
  subjectKind?: RbacSubjectKind;
  subjectNamespace?: string;
  subjectRef?: RbacSubjectRef;
}

export interface UpdateRbacRequest {
  name?: string;
  kind?: RbacBindingKind;
  namespace?: string;
  subject?: string;
  subjectKind?: RbacSubjectKind;
  subjectNamespace?: string;
  subjectRef?: RbacSubjectRef;
}

export interface UsersListQuery {
  keyword?: string;
  role?: string;
  isActive?: string;
  page?: string;
  pageSize?: string;
}

export interface RbacListQuery {
  keyword?: string;
  kind?: string;
  page?: string;
  pageSize?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Users — 数据库 CRUD
  // -------------------------------------------------------------------------

  /**
   * 列表查询（数据库分页）
   */
  async listUsers(query: UsersListQuery = {}): Promise<PaginatedUsersResult> {
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 10);

    const where: {
      role?: string;
      isActive?: boolean;
      OR?: Array<{ email?: { contains: string }; name?: { contains: string } }>;
    } = {};

    if (query.role) {
      where.role = query.role.trim();
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.keyword?.trim()) {
      const kw = query.keyword.trim();
      where.OR = [{ email: { contains: kw } }, { name: { contains: kw } }];
    }

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      items: rows.map((row) => this.toUserItem(row)),
      total,
      page,
      pageSize,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 单条查询
   */
  async findById(id: string): Promise<UserListItem | null> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return row ? this.toUserItem(row) : null;
  }

  /**
   * 创建用户（密码 scrypt hash）
   */
  async createUser(
    actor: Actor | undefined,
    body: CreateUserRequest,
  ): Promise<UserListItem> {
    assertWritePermission(actor);

    const username = body?.username?.trim();
    const name = username;
    const password = body?.password;
    const role = body?.role?.trim() || 'user';

    if (!username) throw new BadRequestException('username 不能为空');
    if (!password) throw new BadRequestException('password 不能为空');

    const existing = await this.prisma.user.findUnique({
      where: { email: username },
    });
    if (existing) throw new BadRequestException('username 已存在');

    const passwordHash = await hashPassword(password);

    const row = await this.prisma.user.create({
      data: { email: username, name, passwordHash, role, isActive: true },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.audit(actor, 'create', 'users', row.id);
    return this.toUserItem(row);
  }

  /**
   * 更新用户（可选修改密码）
   */
  async updateUser(
    actor: Actor | undefined,
    id: string,
    body: UpdateUserRequest,
  ): Promise<UserListItem> {
    assertWritePermission(actor);

    await this.mustFindUser(id);

    const data: {
      email?: string;
      name?: string;
      role?: string;
      passwordHash?: string;
    } = {};

    if (body.username !== undefined) {
      const username = this.requiredTrim(body.username, 'username');
      const existing = await this.prisma.user.findFirst({
        where: {
          email: username,
          id: { not: id },
        },
        select: { id: true },
      });
      if (existing) throw new BadRequestException('username 已存在');
      data.email = username;
      data.name = username;
    }
    if (body.name !== undefined) {
      data.name = this.requiredTrim(body.name, 'name');
    }
    if (body.role !== undefined) {
      data.role = this.requiredTrim(body.role, 'role');
    }
    if (body.password !== undefined) {
      if (!body.password) throw new BadRequestException('password 不能为空');
      data.passwordHash = await hashPassword(body.password);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('更新内容不能为空');
    }

    const row = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.audit(actor, 'update', 'users', row.id);
    return this.toUserItem(row);
  }

  /** 真删除 */
  async deleteUser(
    actor: Actor | undefined,
    id: string,
  ): Promise<{ id: string; deleted: true; state: 'deleted' }> {
    assertWritePermission(actor);
    await this.mustFindUser(id);

    await this.prisma.user.delete({ where: { id } });

    this.audit(actor, 'delete', 'users', id);
    return { id, deleted: true, state: 'deleted' };
  }

  /**
   * 启用 / 禁用
   */
  async setState(
    actor: Actor | undefined,
    id: string,
    isActive: boolean,
  ): Promise<UserListItem> {
    assertWritePermission(actor);
    await this.mustFindUser(id);

    const row = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.audit(actor, isActive ? 'enable' : 'disable', 'users', id);
    return this.toUserItem(row);
  }

  // -------------------------------------------------------------------------
  // 向后兼容 — 旧 controller 方法签名的适配层
  // -------------------------------------------------------------------------

  setUserState(
    actor: Actor | undefined,
    id: string,
    nextState: ResourceState,
  ): Promise<UserListItem> {
    return this.setState(actor, id, nextState === 'active');
  }

  // -------------------------------------------------------------------------
  // RBAC — 数据库持久化
  // -------------------------------------------------------------------------

  /** 列表（数据库过滤 + 分页） */
  async listRbac(query: RbacListQuery = {}): Promise<UsersRbacResponse> {
    const keyword = query.keyword?.trim().toLowerCase();
    const kind = query.kind?.trim();
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 10);

    const where: {
      kind?: string;
      OR?: Array<{
        name?: { contains: string; mode: 'insensitive' };
        namespace?: { contains: string; mode: 'insensitive' };
        subject?: { contains: string; mode: 'insensitive' };
      }>;
    } = {};

    if (kind) {
      where.kind = kind;
    }
    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { namespace: { contains: keyword, mode: 'insensitive' } },
        { subject: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const repo = this.rbacRepo();
    const [total, rows] = await Promise.all([
      repo.count({ where }),
      repo.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((item: RbacBindingRecord) => this.toRbacListItem(item)),
      total,
      timestamp: new Date().toISOString(),
    };
  }

  async createRbac(
    actor: Actor | undefined,
    body: CreateRbacRequest,
  ): Promise<RbacListItem> {
    assertWritePermission(actor);
    const name = body?.name?.trim();
    const namespace = body?.namespace?.trim() ?? '';
    const kind = body?.kind;
    const subjectInput = this.resolveSubjectInput(body);

    if (!name || !this.isRbacKind(kind)) {
      throw new BadRequestException(
        'name/kind/subject 为必填字段，kind 仅支持 RoleBinding/ClusterRoleBinding',
      );
    }

    this.assertRbacBindingFields({
      kind,
      namespace,
      subject: subjectInput.subject,
      subjectKind: subjectInput.subjectKind,
      subjectNamespace: subjectInput.subjectNamespace,
    });

    const created = await this.rbacRepo().create({
      data: {
        name,
        kind,
        namespace: kind === 'RoleBinding' ? namespace : '',
        subject: subjectInput.subject,
        subjectKind: subjectInput.subjectKind,
        subjectNamespace:
          subjectInput.subjectKind === 'ServiceAccount'
            ? subjectInput.subjectNamespace
            : '',
        state: 'active',
      },
    });

    this.audit(actor, 'create', 'rbac', created.id);
    return this.toRbacListItem(created);
  }

  async updateRbac(
    actor: Actor | undefined,
    id: string,
    body: UpdateRbacRequest,
  ): Promise<RbacListItem> {
    assertWritePermission(actor);
    const item = await this.findRbac(id);
    const itemDto = this.toRbacListItem(item);

    const nextName =
      body.name !== undefined
        ? this.requiredTrim(body.name, 'name')
        : item.name;
    const nextKindRaw = body.kind ?? item.kind;
    if (!this.isRbacKind(nextKindRaw)) {
      throw new BadRequestException(
        'kind 仅支持 RoleBinding 或 ClusterRoleBinding',
      );
    }
    const nextKind: RbacBindingKind = nextKindRaw;
    const nextSubjectInput = this.resolveSubjectInput(body, itemDto);
    const nextNamespace =
      body.namespace !== undefined ? body.namespace.trim() : item.namespace;

    if (body.kind !== undefined) {
      if (!this.isRbacKind(body.kind)) {
        throw new BadRequestException(
          'kind 仅支持 RoleBinding 或 ClusterRoleBinding',
        );
      }
    }
    if (
      body.subjectKind !== undefined &&
      !this.isRbacSubjectKind(body.subjectKind)
    ) {
      throw new BadRequestException(
        'subjectKind 仅支持 User、Group、ServiceAccount',
      );
    }

    this.assertRbacBindingFields({
      kind: nextKind,
      namespace: nextNamespace,
      subject: nextSubjectInput.subject,
      subjectKind: nextSubjectInput.subjectKind,
      subjectNamespace: nextSubjectInput.subjectNamespace,
    });

    const updated = await this.rbacRepo().update({
      where: { id },
      data: {
        name: nextName,
        kind: nextKind,
        namespace: nextKind === 'RoleBinding' ? nextNamespace : '',
        subject: nextSubjectInput.subject,
        subjectKind: nextSubjectInput.subjectKind,
        subjectNamespace:
          nextSubjectInput.subjectKind === 'ServiceAccount'
            ? nextSubjectInput.subjectNamespace
            : '',
        version: { increment: 1 },
      },
    });

    this.audit(actor, 'update', 'rbac', updated.id);
    return this.toRbacListItem(updated);
  }

  async deleteRbac(
    actor: Actor | undefined,
    id: string,
  ): Promise<{ id: string; deleted: true; state: 'deleted'; version: number }> {
    assertWritePermission(actor);
    const removed = await this.findRbac(id);
    await this.rbacRepo().delete({ where: { id } });
    this.audit(actor, 'delete', 'rbac', removed.id);

    return {
      id: removed.id,
      deleted: true,
      state: 'deleted',
      version: removed.version + 1,
    };
  }

  async setRbacState(
    actor: Actor | undefined,
    id: string,
    nextState: ResourceState,
  ): Promise<RbacListItem> {
    assertWritePermission(actor);
    const updated = await this.rbacRepo().update({
      where: { id },
      data: {
        state: nextState,
        version: { increment: 1 },
      },
    });
    this.audit(
      actor,
      nextState === 'active' ? 'enable' : 'disable',
      'rbac',
      updated.id,
    );
    return this.toRbacListItem(updated);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async mustFindUser(id: string): Promise<void> {
    const exists = await this.prisma.user.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('用户不存在');
  }

  private toUserItem(row: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): UserListItem {
    return {
      id: row.id,
      username: row.email,
      name: row.name ?? '',
      role: row.role,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private requiredTrim(value: string, field: string): string {
    const next = value?.trim();
    if (!next) throw new BadRequestException(`${field} 不能为空`);
    return next;
  }

  private parsePositiveInt(
    value: string | undefined,
    fallback: number,
  ): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  private async findRbac(id: string): Promise<RbacBindingRecord> {
    const item = await this.rbacRepo().findUnique({ where: { id } });
    if (!item) throw new NotFoundException('RBAC 绑定不存在');
    return item;
  }

  private rbacRepo(): {
    count: (args: unknown) => Promise<number>;
    findMany: (args: unknown) => Promise<RbacBindingRecord[]>;
    findUnique: (args: unknown) => Promise<RbacBindingRecord | null>;
    create: (args: unknown) => Promise<RbacBindingRecord>;
    update: (args: unknown) => Promise<RbacBindingRecord>;
    delete: (args: unknown) => Promise<RbacBindingRecord>;
  } {
    return (this.prisma as unknown as { rbacBinding: unknown }).rbacBinding as {
      count: (args: unknown) => Promise<number>;
      findMany: (args: unknown) => Promise<RbacBindingRecord[]>;
      findUnique: (args: unknown) => Promise<RbacBindingRecord | null>;
      create: (args: unknown) => Promise<RbacBindingRecord>;
      update: (args: unknown) => Promise<RbacBindingRecord>;
      delete: (args: unknown) => Promise<RbacBindingRecord>;
    };
  }

  private audit(
    actor: Actor | undefined,
    action: 'create' | 'update' | 'delete' | 'enable' | 'disable',
    resourceType: string,
    resourceId: string,
  ): void {
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action,
      resourceType,
      resourceId,
      result: 'success',
    });
  }

  private isRbacKind(value: unknown): value is RbacBindingKind {
    return value === 'RoleBinding' || value === 'ClusterRoleBinding';
  }

  private isRbacSubjectKind(value: unknown): value is RbacSubjectKind {
    return value === 'User' || value === 'Group' || value === 'ServiceAccount';
  }

  private assertRbacBindingFields(input: {
    kind: RbacBindingKind;
    namespace: string;
    subject: string;
    subjectKind: RbacSubjectKind;
    subjectNamespace: string;
  }): void {
    const { kind, namespace, subject, subjectKind, subjectNamespace } = input;

    if (!this.isRbacSubjectKind(subjectKind)) {
      throw new BadRequestException(
        'subjectKind 仅支持 User、Group、ServiceAccount',
      );
    }

    const allowedSubjectKindsByBinding: Record<
      RbacBindingKind,
      RbacSubjectKind[]
    > = {
      RoleBinding: ['User', 'ServiceAccount'],
      ClusterRoleBinding: ['User', 'Group', 'ServiceAccount'],
    };
    if (!allowedSubjectKindsByBinding[kind].includes(subjectKind)) {
      throw new BadRequestException(`${kind} 不支持 ${subjectKind} 主体`);
    }

    if (kind === 'RoleBinding' && !namespace) {
      throw new BadRequestException('RoleBinding 需要指定 namespace');
    }

    if (subject.includes('@')) {
      throw new BadRequestException('RBAC subject 不能包含 @ 字符');
    }

    if (!/^[a-zA-Z0-9:._-]{2,64}$/.test(subject)) {
      throw new BadRequestException(
        'RBAC subject 仅支持字母数字:._-，长度 2-64',
      );
    }

    if (subjectKind === 'ServiceAccount') {
      if (!subjectNamespace) {
        throw new BadRequestException('ServiceAccount 需要 subjectNamespace');
      }
      if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(subjectNamespace)) {
        throw new BadRequestException('subjectNamespace 需符合 DNS-1123 label');
      }
    }

    if (subjectKind === 'User' && subject.includes(':')) {
      throw new BadRequestException('User 主体不应包含 : 前缀');
    }

    if (
      subjectKind === 'Group' &&
      !subject.includes('-') &&
      !subject.includes(':')
    ) {
      throw new BadRequestException(
        'Group 主体建议使用组标识（例如 dev-team 或 corp:ops）',
      );
    }
  }

  private toRbacListItem(item: RbacBindingRecord): RbacListItem {
    const kind = this.isRbacKind(item.kind) ? item.kind : 'RoleBinding';
    const subjectKind = this.isRbacSubjectKind(item.subjectKind)
      ? item.subjectKind
      : 'User';
    const subjectNamespace =
      subjectKind === 'ServiceAccount' ? (item.subjectNamespace ?? '') : '';
    const state: ResourceState =
      item.state === 'disabled' ? 'disabled' : 'active';

    return {
      id: item.id,
      name: item.name,
      kind,
      namespace: kind === 'RoleBinding' ? item.namespace : '',
      subject: item.subject,
      subjectKind,
      subjectNamespace,
      state,
      version: item.version,
      subjectRef: {
        kind: subjectKind,
        name: item.subject,
        namespace: subjectNamespace,
      },
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private resolveSubjectInput(
    body: CreateRbacRequest | UpdateRbacRequest,
    current?: RbacListItem,
  ): {
    subject: string;
    subjectKind: RbacSubjectKind;
    subjectNamespace: string;
  } {
    const nextKind =
      body.subjectRef?.kind ??
      body.subjectKind ??
      current?.subjectKind ??
      'User';
    const subject =
      body.subjectRef?.name?.trim() ??
      (body.subject !== undefined
        ? this.requiredTrim(body.subject, 'subject')
        : (current?.subject ?? ''));
    const subjectNamespace =
      body.subjectRef?.namespace?.trim() ??
      (body.subjectNamespace !== undefined
        ? body.subjectNamespace.trim()
        : (current?.subjectNamespace ?? ''));

    if (!subject) {
      throw new BadRequestException('subject 不能为空');
    }
    if (!this.isRbacSubjectKind(nextKind)) {
      throw new BadRequestException(
        'subjectKind 仅支持 User、Group、ServiceAccount',
      );
    }

    return {
      subject,
      subjectKind: nextKind,
      subjectNamespace,
    };
  }
}

interface RbacBindingRecord {
  id: string;
  name: string;
  kind: string;
  namespace: string;
  subject: string;
  subjectKind: string;
  subjectNamespace: string;
  state: string;
  version: number;
  updatedAt: Date;
}

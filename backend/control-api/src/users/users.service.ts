import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { ConfigService } from '@nestjs/config';
import {
  appendAudit,
  assertAdministrationPermission,
  type PlatformRole,
} from '../common/governance';
import { PrismaService } from '../platform/database/prisma.service';
import type { NamespaceIdentityService } from '../common/namespace-identity.service';
import { validatedEndpoint } from '../auth/oidc-flow.service';

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
  id?: string;
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
  mfaEnabled?: boolean;
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

export interface TablePreferenceResponse {
  tableKey: string;
  value: unknown;
  updatedAt: string | null;
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

export interface UpdateTablePreferenceRequest {
  value?: unknown;
}

export interface UsersListQuery {
  keyword?: string;
  role?: string;
  isActive?: string;
  page?: string;
  pageSize?: string;
}

export interface RbacListQuery {
  clusterId?: string;
  keyword?: string;
  kind?: string;
  namespace?: string;
  subject?: string;
  subjectKind?: string;
  state?: string;
  sort?: string | string[];
  page?: string;
  pageSize?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class UsersService {
  async listExternalIdentities(actor: Actor | undefined, userId: string) {
    assertAdministrationPermission(actor);
    const items = await this.prisma.externalIdentity.findMany({
      where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, issuer: true, subject: true, createdAt: true }, take: 100,
    });
    return { items };
  }

  async bindExternalIdentity(actor: Actor | undefined, userId: string, body: unknown) {
    assertAdministrationPermission(actor);
    await this.assertSuperadministrator(actor, userId);
    const input = body as { issuer?: unknown; subject?: unknown } | null;
    if (!actor?.id || !userId || typeof input?.issuer !== 'string' || typeof input.subject !== 'string'
      || !input.subject.trim() || input.subject.length > 255 || input.issuer.length > 2048
      || input.subject !== input.subject.trim() || input.issuer !== input.issuer.trim()) {
      throw new BadRequestException('Valid issuer and subject required');
    }
    const endpoint = validatedEndpoint(input.issuer);
    if (endpoint.search) throw new BadRequestException('Issuer must not contain query parameters');
    const issuer = input.issuer;
    const subject = input.subject;
    try {
      return await this.prisma.$transaction(async tx => {
        // Lock the account so disable and binding cannot race past each other.
        const updated = await tx.user.updateMany({ where: { id: userId, isActive: true }, data: { authzVersion: { increment: 1 } } });
        if (!updated.count) throw new BadRequestException('User unavailable');
        const identity = await tx.externalIdentity.create({
          data: { userId, issuer, subject }, select: { id: true, issuer: true, subject: true, createdAt: true },
        });
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { authzVersion: true } });
        await tx.authorizationChange.create({ data: { actorUserId: actor.id!, affectedUserId: userId, version: user.authzVersion, reason: `identity-bound:${identity.id}` } });
        return identity;
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') throw new ConflictException('External identity already bound');
      throw error;
    }
  }

  async unbindExternalIdentity(actor: Actor | undefined, userId: string, identityId: string) {
    assertAdministrationPermission(actor);
    await this.assertSuperadministrator(actor, userId);
    if (!actor?.id || !userId || !identityId) throw new BadRequestException('Identity required');
    return this.prisma.$transaction(async tx => {
      const updated = await tx.user.updateMany({ where: { id: userId }, data: { authzVersion: { increment: 1 } } });
      if (!updated.count) throw new NotFoundException('User not found');
      const removed = await tx.externalIdentity.deleteMany({ where: { id: identityId, userId } });
      if (!removed.count) throw new NotFoundException('Identity not found');
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { authzVersion: true } });
      await tx.authorizationChange.create({ data: { actorUserId: actor.id!, affectedUserId: userId, version: user.authzVersion, reason: `identity-unbound:${identityId}` } });
      return { removed: true };
    });
  }

  async listGroupMembers(actor: Actor | undefined, groupId: string, pageValue = '1') {
    assertAdministrationPermission(actor);
    const page = Number(pageValue);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * 20)) throw new BadRequestException('Invalid page');
    const group = await this.prisma.identityGroup.findUnique({ where: { id: groupId }, select: { id: true, name: true, active: true, externalId: true } });
    if (!group) throw new NotFoundException('Group not found');
    const where = { groupId };
    const items = await this.prisma.groupMembership.findMany({
      where, skip: (page - 1) * 20, take: 20, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, state: true, validFrom: true, expiresAt: true, user: { select: { id: true, email: true, name: true, isActive: true } } },
    });
    const total = await this.prisma.groupMembership.count({ where });
    return { group: { id: group.id, name: group.name, active: group.active, managedExternally: Boolean(group.externalId) }, items, total, page, pageSize: 20 };
  }
  async setGroupMembership(actor: Actor | undefined, groupId: string, userId: string, active: boolean) {
    assertAdministrationPermission(actor);
    if (!actor?.id || !groupId?.trim() || !userId?.trim()) throw new BadRequestException('Identity required');
    const actorId = actor.id;
    return this.prisma.$transaction(async tx => {
      const group = await tx.identityGroup.findUnique({ where: { id: groupId } });
      if (!group) throw new NotFoundException('Group not found');
      if (group.externalId) throw new ForbiddenException('Membership is managed by the identity provider');
      if (active && !group.active) throw new BadRequestException('Group disabled');
      const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true } });
      if (!user || (active && !user.isActive)) throw new BadRequestException('User unavailable');
      if (active) {
        await tx.groupMembership.upsert({
          where: { groupId_userId: { groupId, userId } },
          create: { groupId, userId },
          update: { state: 'active', validFrom: new Date(), expiresAt: null },
        });
      } else {
        const changed = await tx.groupMembership.updateMany({ where: { groupId, userId, state: 'active' }, data: { state: 'disabled' } });
        if (!changed.count) return { groupId, userId, active };
      }
      await tx.user.update({ where: { id: userId }, data: { authzVersion: { increment: 1 } } });
      await tx.authorizationChange.create({ data: { actorUserId: actorId, affectedUserId: userId, reason: `group-member-${active ? 'added' : 'removed'}:${groupId}` } });
      return { groupId, userId, active };
    }, { isolationLevel: 'Serializable' });
  }
  async createIdentityGroup(actor: Actor | undefined, body: unknown) {
    assertAdministrationPermission(actor);
    if (!actor?.id) throw new BadRequestException('Actor identity required');
    const actorId = actor.id;
    const name = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).name : undefined;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 128) throw new BadRequestException('Group name must contain 1-128 characters');
    return this.prisma.$transaction(async tx => {
      const group = await tx.identityGroup.create({ data: { name: name.trim() }, select: { id: true, name: true, active: true } });
      await tx.authorizationChange.create({ data: { actorUserId: actorId, reason: `group-created:${group.id}`, version: 1 } });
      return group;
    });
  }
  async listGrantGroups(actor: Actor | undefined, keyword = '') {
    assertAdministrationPermission(actor);
    if (typeof keyword !== 'string' || keyword.length > 200) throw new BadRequestException('Invalid group search');
    const items = await this.prisma.identityGroup.findMany({
      where: { active: true, ...(keyword.trim() ? { name: { contains: keyword.trim(), mode: 'insensitive' as const } } : {}) },
      select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100,
    });
    return { items };
  }
  async listAuthorizationChanges(actor: Actor | undefined, query: { grantId?: string; page?: string; pageSize?: string } = {}) {
    assertAdministrationPermission(actor);
    const page = query.page === undefined ? 1 : Number(query.page);
    const pageSize = query.pageSize === undefined ? 20 : Number(query.pageSize);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger((page - 1) * pageSize)) throw new BadRequestException('Invalid pagination');
    if (query.grantId !== undefined && typeof query.grantId !== 'string') throw new BadRequestException('Invalid grant ID');
    const where = query.grantId?.trim() ? { grantId: query.grantId.trim() } : {};
    const items = await this.prisma.authorizationChange.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, actorUserId: true, affectedUserId: true, grantId: true, version: true, reason: true, committedAt: true },
    });
    const total = await this.prisma.authorizationChange.count({ where });
    return { items, total, page, pageSize };
  }
  async createAccessGrant(actor: Actor | undefined, body: unknown) {
    assertAdministrationPermission(actor);
    if (!actor?.id) throw new BadRequestException('Actor identity required');
    const actorId = actor.id;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid grant');
    const input = body as Record<string, unknown>;
    const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
    const userId = text(input.userId);
    const groupId = text(input.groupId);
    const clusterId = text(input.clusterId);
    const role = text(input.role);
    if (Boolean(userId) === Boolean(groupId) || !clusterId || !['cluster-admin', 'operator', 'viewer'].includes(role)) throw new BadRequestException('Invalid principal, cluster or role');
    if (!Array.isArray(input.namespaces) || !input.namespaces.length || input.namespaces.length > 100 || input.namespaces.some(value => !text(value))) throw new BadRequestException('Explicit namespace scope required');
    if (!Array.isArray(input.capabilities) || input.capabilities.some(value => !['logs', 'exec', 'secrets', 'kubeconfig'].includes(String(value)))) throw new BadRequestException('Invalid capabilities');
    const now = new Date();
    const validFrom = input.validFrom === undefined ? now : new Date(text(input.validFrom));
    const expiresAt = input.expiresAt === undefined || input.expiresAt === null ? null : new Date(text(input.expiresAt));
    if (!Number.isFinite(validFrom.getTime()) || (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= validFrom || expiresAt <= now))) throw new BadRequestException('Invalid validity interval');
    if (!this.namespaceIdentity) throw new BadRequestException('Namespace resolver unavailable');
    const namespaces: Array<{ namespaceName: string; namespaceUid: string }> = [];
    for (const name of new Set(input.namespaces.map(text))) {
      const uid = await this.namespaceIdentity.resolve(clusterId, name);
      namespaces.push({ namespaceName: name, namespaceUid: uid });
    }
    const capabilities = [...new Set(input.capabilities as string[])];
    return this.prisma.$transaction(async tx => {
      const cluster = await tx.clusterRegistry.findUnique({
        where: { id: clusterId }, select: { id: true, deletedAt: true },
      });
      if (!cluster || cluster.deletedAt) throw new BadRequestException('Cluster unavailable');
      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true } });
        if (!user?.isActive) throw new BadRequestException('User unavailable');
      } else {
        const group = await tx.identityGroup.findUnique({ where: { id: groupId }, select: { active: true } });
        if (!group?.active) throw new BadRequestException('Group unavailable');
      }
      const grant = await tx.accessGrant.create({ data: {
        userId: userId || null, groupId: groupId || null, clusterId, role, validFrom, expiresAt,
        createdByUserId: actorId, updatedByUserId: actorId,
        namespaces: { create: namespaces }, capabilities: { create: capabilities.map(capability => ({ capability })) },
      }, select: { id: true, version: true } });
      const userIds = userId ? [userId] : (await tx.groupMembership.findMany({ where: { groupId }, select: { userId: true } })).map(member => member.userId);
      if (userIds.length) await tx.user.updateMany({ where: { id: { in: userIds } }, data: { authzVersion: { increment: 1 } } });
      await tx.authorizationChange.create({ data: { actorUserId: actorId, affectedUserId: userId || null, grantId: grant.id, version: grant.version, reason: 'grant-created' } });
      return grant;
    });
  }
  async revokeAccessGrant(actor: Actor | undefined, id: string) {
    assertAdministrationPermission(actor);
    if (!actor?.id) throw new BadRequestException('Actor identity required');
    const actorId = actor.id;
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.accessGrant.findUnique({ where: { id } });
      if (!grant) throw new NotFoundException('Access grant not found');
      if (grant.revokedAt) return { id, revoked: true };
      const changed = await tx.accessGrant.updateMany({
        where: { id, version: grant.version, revokedAt: null },
        data: { state: 'revoked', revokedAt: new Date(), updatedByUserId: actor.id, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('Access grant changed; reload and retry');
      const userIds = grant.userId ? [grant.userId] : grant.groupId
        ? (await tx.groupMembership.findMany({ where: { groupId: grant.groupId }, select: { userId: true } })).map(member => member.userId)
        : [];
      if (userIds.length) await tx.user.updateMany({ where: { id: { in: userIds } }, data: { authzVersion: { increment: 1 } } });
      await tx.authorizationChange.create({ data: { actorUserId: actorId, affectedUserId: grant.userId, grantId: id, version: grant.version + 1, reason: 'grant-revoked' } });
      return { id, revoked: true };
    });
  }
  async listAccessGrants(clusterId?: string, actor?: Actor): Promise<{ items: unknown[]; total: number; timestamp: string }> {
    assertAdministrationPermission(actor);
    const rows = await this.prisma.accessGrant.findMany({
      where: clusterId?.trim() ? { clusterId: clusterId.trim() } : {},
      include: { user: { select: { id: true, email: true, name: true } }, group: { select: { id: true, name: true } }, cluster: { select: { id: true, name: true } }, namespaces: true, capabilities: true },
      orderBy: { updatedAt: 'desc' },
    });
    const items = rows.map(row => ({ id: row.id, principal: row.user ? { type: 'user', id: row.user.id, username: row.user.email, name: row.user.name } : row.group ? { type: 'group', ...row.group } : null, cluster: row.cluster, role: row.role, state: row.state, validFrom: row.validFrom.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null, namespaces: row.namespaces.map(item => ({ name: item.namespaceName, uid: item.namespaceUid })), capabilities: row.capabilities.map(item => item.capability), version: row.version, updatedAt: row.updatedAt.toISOString() }));
    return { items, total: items.length, timestamp: new Date().toISOString() };
  }
  constructor(private readonly prisma: PrismaService, @Optional() @Inject('NamespaceIdentityResolver') private readonly namespaceIdentity?: NamespaceIdentityService, @Optional() private readonly config?: ConfigService) {}

  private async assertSuperadministrator(actor: Actor | undefined, protectedTargetId?: string): Promise<void> {
    const designatedId = this.config?.get<string>('superadminUserId');
    // Unrelated account administration retains the existing administrator boundary.
    if (protectedTargetId !== undefined && protectedTargetId !== designatedId) return;
    if (!designatedId || actor?.id !== designatedId) {
      throw new ForbiddenException('Explicit superadministrator identity required');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: designatedId }, select: { isActive: true, role: true },
    });
    if (!user?.isActive) throw new ForbiddenException('Active superadministrator required');
    assertAdministrationPermission(user);
  }

  // -------------------------------------------------------------------------
  // Users — 数据库 CRUD
  // -------------------------------------------------------------------------

  /**
   * 列表查询（数据库分页）
   */
  async listUsers(query: UsersListQuery = {}, actor?: Actor): Promise<PaginatedUsersResult> {
    assertAdministrationPermission(actor);
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
          mfaEnabled: true,
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
  async findById(id: string, actor?: Actor): Promise<UserListItem | null> {
    assertAdministrationPermission(actor);
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        mfaEnabled: true,
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
    assertAdministrationPermission(actor);

    const username = body?.username?.trim();
    const name = username;
    const password = body?.password;
    if (body?.role !== undefined && body.role !== 'user') {
      throw new BadRequestException('创建账号时不能分配管理角色');
    }
    const role = 'user';

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
        mfaEnabled: true,
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
    assertAdministrationPermission(actor);
    await this.assertSuperadministrator(actor, id);

    if (body.role !== undefined) {
      throw new BadRequestException('账号资料编辑不支持角色变更');
    }
    await this.mustFindUser(id);

    const data: {
      email?: string;
      name?: string;
      passwordHash?: string;
      authzVersion?: { increment: number };
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
    if (body.password !== undefined) {
      if (!body.password) throw new BadRequestException('password 不能为空');
      data.passwordHash = await hashPassword(body.password);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('更新内容不能为空');
    }
    if (body.password !== undefined || body.username !== undefined) {
      data.authzVersion = { increment: 1 };
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
        mfaEnabled: true,
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
    assertAdministrationPermission(actor);
    await this.assertSuperadministrator(actor, id);
    await this.mustFindUser(id);
    await this.assertNotLastAdministrator(id, 'user');

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
    assertAdministrationPermission(actor);
    await this.assertSuperadministrator(actor, id);
    await this.mustFindUser(id);
    if (!isActive) await this.assertNotLastAdministrator(id, 'disabled');

    const row = await this.prisma.user.update({
      where: { id },
      data: { isActive, authzVersion: { increment: 1 } },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        mfaEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.audit(actor, isActive ? 'enable' : 'disable', 'users', id);
    return this.toUserItem(row);
  }

  async setMfaEnabled(actor: Actor | undefined, id: string, enabled: boolean): Promise<{ id: string; mfaEnabled: boolean }> {
    assertAdministrationPermission(actor);
    await this.assertSuperadministrator(actor);
    if (typeof enabled !== 'boolean') throw new BadRequestException('enabled must be boolean');
    throw new ServiceUnavailableException('MFA administration requires verified reauthentication and atomic reset support');
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
  // Preferences — per-user table view preferences
  // -------------------------------------------------------------------------

  async getTablePreference(
    actor: Actor | undefined,
    tableKey: string,
  ): Promise<TablePreferenceResponse> {
    const userId = this.requireActorUserId(actor);
    const normalizedTableKey = this.normalizeTableKey(tableKey);
    const key = this.toTablePreferenceKey(normalizedTableKey);
    const repo = this.preferenceRepo();
    if (!repo) {
      return {
        tableKey: normalizedTableKey,
        value: null,
        updatedAt: null,
      };
    }

    const row = await this.readTablePreference(() =>
      repo.findUnique({
        where: { userId_key: { userId, key } },
      }),
    );

    if (!row) {
      return {
        tableKey: normalizedTableKey,
        value: null,
        updatedAt: null,
      };
    }

    return this.toTablePreferenceResponse(normalizedTableKey, row);
  }

  async saveTablePreference(
    actor: Actor | undefined,
    tableKey: string,
    body: UpdateTablePreferenceRequest,
  ): Promise<TablePreferenceResponse> {
    const userId = this.requireActorUserId(actor);
    const normalizedTableKey = this.normalizeTableKey(tableKey);
    if (
      !body ||
      !Object.prototype.hasOwnProperty.call(body, 'value') ||
      body.value === undefined
    ) {
      throw new BadRequestException('value 不能为空');
    }

    const key = this.toTablePreferenceKey(normalizedTableKey);
    const repo = this.preferenceRepo();
    if (!repo) {
      return this.toTablePreferenceResponse(normalizedTableKey, {
        id: 'volatile',
        userId,
        key,
        value: body.value,
        updatedAt: new Date(),
      });
    }
    const row = await this.writeTablePreference(
      () =>
        repo.upsert({
          where: { userId_key: { userId, key } },
          create: {
            userId,
            key,
            value: body.value,
          },
          update: {
            value: body.value,
          },
        }),
      { userId, key, value: body.value },
    );

    return this.toTablePreferenceResponse(normalizedTableKey, row);
  }

  // -------------------------------------------------------------------------
  // RBAC — 数据库持久化
  // -------------------------------------------------------------------------

  /** 列表（数据库过滤 + 分页） */
  async listRbac(query: RbacListQuery = {}): Promise<UsersRbacResponse> {
    const clusterId = query.clusterId?.trim();
    const keyword = query.keyword?.trim().toLowerCase();
    const kind = query.kind?.trim();
    const namespace = query.namespace?.trim();
    const subject = query.subject?.trim();
    const subjectKind = query.subjectKind?.trim();
    const state = query.state?.trim();
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 10);
    const orderBy = this.resolveRbacOrderBy(query.sort);

    const where: {
      AND?: Array<Record<string, unknown>>;
      kind?: string;
      namespace?: string;
      subjectKind?: string;
      state?: string;
      subject?: { contains: string; mode: 'insensitive' };
      OR?: Array<{
        name?: { contains: string; mode: 'insensitive' };
        namespace?: { contains: string; mode: 'insensitive' };
        subject?: { contains: string; mode: 'insensitive' };
      }>;
    } = {};

    if (kind) {
      where.kind = kind;
    }
    if (namespace) {
      where.namespace = namespace;
    }
    if (subjectKind) {
      where.subjectKind = subjectKind;
    }
    if (state) {
      where.state = state;
    }
    if (subject) {
      where.subject = { contains: subject, mode: 'insensitive' };
    }
    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { namespace: { contains: keyword, mode: 'insensitive' } },
        { subject: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    if (clusterId) {
      const namespaces = await this.prisma.namespaceRecord.findMany({
        where: {
          clusterId,
          state: { not: 'deleted' },
        },
        select: { name: true },
      });
      const namespaceNames = namespaces
        .map((item) => item.name)
        .filter(Boolean);
      where.AND = [
        {
          OR: [
            { kind: 'ClusterRoleBinding' },
            ...(namespaceNames.length > 0
              ? [{ kind: 'RoleBinding', namespace: { in: namespaceNames } }]
              : []),
          ],
        },
      ];
    }

    const repo = this.rbacRepo();
    const [total, rows] = await Promise.all([
      repo.count({ where }),
      repo.findMany({
        where,
        orderBy,
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

  private resolveRbacOrderBy(
    sort?: string | string[],
  ): Array<Record<string, 'asc' | 'desc'>> {
    const firstSort = Array.isArray(sort) ? sort[0] : sort;
    const [rawField, rawOrder] = String(firstSort ?? 'updatedAt:desc').split(
      ':',
    );
    const field = rawField?.trim();
    const order: 'asc' | 'desc' = rawOrder?.trim() === 'asc' ? 'asc' : 'desc';
    const allowedFields = new Set([
      'name',
      'kind',
      'namespace',
      'subject',
      'state',
      'updatedAt',
    ]);
    const resolvedField = allowedFields.has(field) ? field : 'updatedAt';
    return [{ [resolvedField]: order }, { id: 'asc' }];
  }

  async createRbac(
    actor: Actor | undefined,
    body: CreateRbacRequest,
  ): Promise<RbacListItem> {
    assertAdministrationPermission(actor);
    const name = this.requiredTrim(body?.name, 'name');
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

    const created = await this.persistRbacWrite(() =>
      this.rbacRepo().create({
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
      }),
    );

    this.audit(actor, 'create', 'rbac', created.id);
    return this.toRbacListItem(created);
  }

  async updateRbac(
    actor: Actor | undefined,
    id: string,
    body: UpdateRbacRequest,
  ): Promise<RbacListItem> {
    assertAdministrationPermission(actor);
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

    const updated = await this.persistRbacWrite(() =>
      this.rbacRepo().update({
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
      }),
    );

    this.audit(actor, 'update', 'rbac', updated.id);
    return this.toRbacListItem(updated);
  }

  async deleteRbac(
    actor: Actor | undefined,
    id: string,
  ): Promise<{ id: string; deleted: true; state: 'deleted'; version: number }> {
    assertAdministrationPermission(actor);
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
    assertAdministrationPermission(actor);
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

  private async assertNotLastAdministrator(id: string, nextRole: unknown): Promise<void> {
    if (id === this.config?.get<string>('superadminUserId')) {
      throw new BadRequestException('Cannot delete or disable the designated superadministrator; transfer the deployment designation first');
    }
    const current = await this.prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
    if (!current || !current.isActive || !['admin', 'platform-admin'].includes(current.role)) return;
    if (typeof nextRole === 'string' && ['admin', 'platform-admin'].includes(nextRole)) return;
    const count = await this.prisma.user.count({ where: { isActive: true, role: { in: ['admin', 'platform-admin'] } } });
    if (count <= 1) throw new BadRequestException('不能移除最后一个平台管理员');
  }

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
    mfaEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): UserListItem {
    return {
      id: row.id,
      username: row.email,
      name: row.name ?? '',
      role: row.role,
      isActive: row.isActive,
      mfaEnabled: row.mfaEnabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private requiredTrim(value: unknown, field: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} 必须为字符串`);
    }
    const next = value.trim();
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

  private preferenceRepo(): {
    findUnique: (args: unknown) => Promise<UserPreferenceRecord | null>;
    upsert: (args: unknown) => Promise<UserPreferenceRecord>;
  } | null {
    const repo = (this.prisma as unknown as { userPreference?: unknown })
      .userPreference as
      | {
          findUnique: (args: unknown) => Promise<UserPreferenceRecord | null>;
          upsert: (args: unknown) => Promise<UserPreferenceRecord>;
        }
      | undefined;
    if (
      !repo ||
      typeof repo.findUnique !== 'function' ||
      typeof repo.upsert !== 'function'
    ) {
      return null;
    }
    return repo;
  }

  private requireActorUserId(actor: Actor | undefined): string {
    const userId = actor?.id?.trim();
    if (!userId) throw new BadRequestException('当前用户无效');
    return userId;
  }

  private normalizeTableKey(tableKey: string): string {
    const normalized = tableKey?.trim();
    if (!normalized) throw new BadRequestException('tableKey 不能为空');
    if (normalized.length > 120) {
      throw new BadRequestException('tableKey 长度不能超过 120');
    }
    return normalized;
  }

  private toTablePreferenceKey(tableKey: string): string {
    return `table:${tableKey}`;
  }

  private toTablePreferenceResponse(
    tableKey: string,
    row: UserPreferenceRecord,
  ): TablePreferenceResponse {
    return {
      tableKey,
      value: row.value,
      updatedAt: row.updatedAt.toISOString(),
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

  private async persistRbacWrite(
    write: () => Promise<RbacBindingRecord>,
  ): Promise<RbacBindingRecord> {
    try {
      return await write();
    } catch (error) {
      if (this.isPrismaBusinessError(error)) {
        throw new BadRequestException(
          'RBAC 绑定数据无效，请检查名称和主体配置',
        );
      }
      throw error;
    }
  }

  private isPrismaBusinessError(error: unknown): boolean {
    const maybePrismaError = error as {
      code?: string;
      name?: string;
    };
    return (
      maybePrismaError.name === 'PrismaClientValidationError' ||
      ['P2000', 'P2002', 'P2003', 'P2011', 'P2012'].includes(
        maybePrismaError.code ?? '',
      )
    );
  }

  private async readTablePreference(
    read: () => Promise<UserPreferenceRecord | null>,
  ): Promise<UserPreferenceRecord | null> {
    try {
      return await read();
    } catch (error) {
      if (this.isPreferenceStoreUnavailable(error)) {
        return null;
      }
      throw error;
    }
  }

  private async writeTablePreference(
    write: () => Promise<UserPreferenceRecord>,
    fallback: { userId: string; key: string; value: unknown },
  ): Promise<UserPreferenceRecord> {
    try {
      return await write();
    } catch (error) {
      if (this.isPreferenceStoreUnavailable(error)) {
        return {
          id: 'volatile',
          userId: fallback.userId,
          key: fallback.key,
          value: fallback.value,
          updatedAt: new Date(),
        };
      }
      throw error;
    }
  }

  private isPreferenceStoreUnavailable(error: unknown): boolean {
    const maybePrismaError = error as {
      code?: string;
      message?: string;
      name?: string;
    };
    const message = maybePrismaError.message ?? '';
    return (
      maybePrismaError.code === 'P2021' ||
      maybePrismaError.code === 'P2022' ||
      maybePrismaError.name === 'PrismaClientUnknownRequestError' ||
      message.includes('UserPreference') ||
      message.includes('userPreference') ||
      message.includes('user_preferences')
    );
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

interface UserPreferenceRecord {
  id: string;
  userId: string;
  key: string;
  value: unknown;
  updatedAt: Date;
}

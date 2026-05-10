/**
 * Auth 集成测试 (e2e)
 *
 * 测试范围：
 *   - POST /api/auth/login  成功登录
 *   - POST /api/auth/login  错误密码返回 401
 *   - POST /api/auth/login  缺少字段返回 400（DTO 校验）
 *   - POST /api/auth/refresh token 刷新
 *   - POST /api/auth/refresh 无效 refreshToken 返回 401
 *   - GET  /api/auth/me     获取当前用户（需 Bearer token）
 *   - GET  /api/auth/me     无 token 返回 401
 *   - POST /api/auth/logout 正常退出
 *   - POST /api/auth/logout 无 token 返回 401
 *
 * 数据库隔离策略：
 *   用 jest mock 替换 PrismaService，所有 Prisma 调用均为 in-memory mock。
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import { PrismaService } from '../src/platform/database/prisma.service';

// ──────────────────────────────────────────────
// 固定测试数据
// ──────────────────────────────────────────────

const FIXED_NOW = new Date('2026-04-14T00:00:00.000Z');
const FIXED_EXPIRES = new Date('2026-04-14T00:30:00.000Z');
const SESSION_ID = 'session-abc-123';
const REFRESH_TOKEN_HASH = 'sha256-hashed-refresh-token';

const MOCK_USER = {
  id: 'user-001',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'platform-admin',
  isActive: true,
  passwordHash:
    'sha256:8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', // sha256('admin')
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

const MOCK_SESSION = {
  id: SESSION_ID,
  userId: MOCK_USER.id,
  refreshTokenHash: REFRESH_TOKEN_HASH,
  expiresAt: FIXED_EXPIRES,
  revokedAt: null,
  createdAt: FIXED_NOW,
  user: MOCK_USER,
};

// ──────────────────────────────────────────────
// PrismaService Mock 工厂
// ──────────────────────────────────────────────

function buildPrismaMock() {
  return {
    user: {
      findFirst: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    $disconnect: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  };
}

// ──────────────────────────────────────────────
// 应用构建辅助（仅加载 AuthModule，不依赖数据库）
// ──────────────────────────────────────────────

async function buildApp(
  prismaMock: ReturnType<typeof buildPrismaMock>,
): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      AuthModule,
    ],
    providers: [
      {
        provide: APP_INTERCEPTOR,
        useClass: ResponseEnvelopeInterceptor,
      },
      {
        provide: APP_FILTER,
        useClass: HttpExceptionFilter,
      },
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

// ──────────────────────────────────────────────
// 测试套件
// ──────────────────────────────────────────────

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeAll(async () => {
    prisma = buildPrismaMock();
    app = await buildApp(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────
  // POST /api/auth/login
  // ──────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('应返回 accessToken、refreshToken 和用户信息（成功登录）', async () => {
      prisma.user.findFirst.mockResolvedValue(MOCK_USER);
      prisma.session.create.mockResolvedValue(MOCK_SESSION);

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'admin@example.com', password: 'admin' })
        .expect(200);

      expect(res.body).toMatchObject({
        data: expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          expiresAt: expect.any(String),
          user: expect.objectContaining({
            username: 'admin@example.com',
            role: 'platform-admin',
          }),
        }),
      });
      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
    });

    it('错误密码应返回 401', async () => {
      prisma.user.findFirst.mockResolvedValue(MOCK_USER);

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'admin@example.com', password: 'wrong-password' })
        .expect(401);

      expect(res.body).toMatchObject({
        error: expect.objectContaining({
          code: 'AUTH_LOGIN_FAILED',
        }),
      });
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('用户不存在应返回 401', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'nouser@example.com', password: 'anything' })
        .expect(401);
    });

    it('缺少 username 字段应返回 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ password: 'admin' })
        .expect(400);
    });

    it('缺少 password 字段应返回 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'admin@example.com' })
        .expect(400);
    });

    it('空 body 应返回 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({})
        .expect(400);
    });
  });

  // ──────────────────────────────────────────
  // POST /api/auth/refresh
  // ──────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('有效 refreshToken 应换取新的 accessToken 和 refreshToken', async () => {
      prisma.session.findFirst.mockResolvedValue(MOCK_SESSION);
      prisma.session.updateMany.mockResolvedValue({ count: 1 });
      prisma.session.create.mockResolvedValue({
        ...MOCK_SESSION,
        id: 'session-new-456',
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'valid-refresh-token-base64url' })
        .expect(200);

      expect(res.body).toMatchObject({
        data: expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        }),
      });
      // 旧 session 应被撤销
      expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
      // 新 session 应被创建
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
    });

    it('无效 refreshToken 应返回 401', async () => {
      prisma.session.findFirst.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-or-expired-token' })
        .expect(401);

      expect(res.body).toMatchObject({
        error: expect.objectContaining({
          code: 'AUTH_REFRESH_FAILED',
        }),
      });
    });

    it('缺少 refreshToken 字段应返回 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({})
        .expect(400);
    });
  });

  // ──────────────────────────────────────────
  // GET /api/auth/me
  // ──────────────────────────────────────────

  describe('GET /api/auth/me', () => {
    it('携带有效 Bearer token 应返回当前用户信息', async () => {
      prisma.session.findFirst.mockResolvedValue(MOCK_SESSION);

      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${SESSION_ID}`)
        .expect(200);

      expect(res.body).toMatchObject({
        data: expect.objectContaining({
          user: expect.objectContaining({
            username: MOCK_USER.email,
            role: MOCK_USER.role,
          }),
          expiresAt: expect.any(String),
        }),
      });
    });

    it('无 Authorization 头应返回 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);

      expect(res.body).toMatchObject({
        error: expect.objectContaining({
          code: 'AUTH_TOKEN_MISSING',
        }),
      });
    });

    it('无效 token 应返回 401', async () => {
      prisma.session.findFirst.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(res.body).toMatchObject({
        error: expect.objectContaining({
          code: 'AUTH_TOKEN_INVALID',
        }),
      });
    });
  });

  // ──────────────────────────────────────────
  // POST /api/auth/logout
  // ──────────────────────────────────────────

  describe('POST /api/auth/logout', () => {
    it('携带有效 Bearer token 应成功退出并返回 message', async () => {
      // 第一次调用 findFirst 用于 AuthGuard 验证
      prisma.session.findFirst.mockResolvedValue(MOCK_SESSION);
      prisma.session.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${SESSION_ID}`)
        .expect(200);

      expect(res.body).toMatchObject({
        data: expect.objectContaining({
          message: expect.stringContaining('退出'),
        }),
      });
      expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
    });

    it('无 Authorization 头应返回 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .expect(401);

      expect(res.body).toMatchObject({
        error: expect.objectContaining({
          code: 'AUTH_TOKEN_MISSING',
        }),
      });
    });

    it('过期 token 应返回 401', async () => {
      prisma.session.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer expired-session-id')
        .expect(401);
    });
  });
});

# control-api（NestJS）

KubeNova 平台业务后端（BFF）骨架。

## 已实现接口

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/clusters`

## 演示账号

- `username=admin@local.dev` / `password=admin123456`

## 启动

```bash
npm install
npm run start:dev
```

默认端口：`4000`

登录接口 `POST /api/auth/login` 当前请求体字段为：

```json
{
  "username": "admin@local.dev",
  "password": "admin123456"
}
```

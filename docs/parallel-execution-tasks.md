# 并行执行清单（2026-05-12）

## 目标范围

- [ ] P0.1 修复日志/终端 WebSocket 回落 `127.0.0.1` 导致连接失败/超时
- [ ] P0.2 日志页补齐 Headlamp 关键功能：`美化` `格式化` `查找` `清除` `下载`
- [ ] P0.3 日志输出区改为站内 terminal 黑色工作区风格并保持移动端可用
- [ ] P0.4 日志/终端端到端回归：创建会话、连接、断线重连、退出

## 后续范围

- [ ] P1.1 全站继续铺开 `集群筛选 + 名称空间联动`（剩余页面）
- [ ] P2.1 全站继续铺开 `排序 + 分页` 并补齐漏列排序

## 并行分工

- [ ] A 切片（worktree）：连接链路与回落策略（`control-api` + `frontend ws`）
- [ ] B 切片（worktree）：日志 UI 功能对齐与样式
- [ ] 主线程：集成、最小相关验证、服务健康检查、产物清理

## 验收门禁

- [ ] `frontend`: `eslint`（改动文件）+ `tsc --noEmit`
- [ ] `backend/control-api`: `npm run build`
- [ ] `backend/runtime-gateway`: `go build ./...` + `go test ./...`
- [ ] `scripts/dev-status.sh`: `frontend/control-api/runtime-gateway` 全健康

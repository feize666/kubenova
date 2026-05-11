# 自主并行开发总计划（worktree + subagent）

## 0. 目标与边界

- 目标：在现有仓库基础上持续推进剩余功能，优先补齐 `live metrics` 真链路与关键回归测试，保持可持续交付节奏。
- 边界：仅处理当前仓库内需求与 spec；不引入未授权外部系统变更；不执行破坏性 git 操作。
- 约束：按功能切片并行；每个切片独立 worktree；最小相关验证通过后才可集成。

## 1. 阶段拆分

### Phase A: 基线收敛

- A1. 盘点现有未完成 spec 任务与代码偏差。
- A2. 冻结并行切片边界（后端 metrics、前端 dashboard/pods、回归测试、脚本测试）。
- A3. 建立统一验收门禁（命令、通过标准、失败上报格式）。

验收标准：

- 形成可执行切片清单；
- 每个切片具备独立输入/输出/验证命令；
- 标明并行/串行依赖。

### Phase B: 功能开发（主并行阶段）

- B1. `live metrics provider gateway + adapter`（后端）
- B2. `dashboard 顶部面板 + pod 行指标`（前端）
- B3. `metrics 缺失态 + freshness window`（前后端协同）
- B4. 相关 API 契约与类型对齐（前端 API/contract）

验收标准：

- 关键路径可跑通；
- API 返回与 UI 展示一致；
- 缺失态不伪造数据；
- 降级逻辑可用。

### Phase C: 回归与稳定性

- C1. 菜单交互回归、数据同步新鲜度回归、Pod 操作区回归。
- C2. 拓扑与集群详情相关遗留测试补齐（按优先级分批）。
- C3. 清理测试产物并复核仓库整洁度。

验收标准：

- 最小相关测试通过；
- 无新增高优先级回归；
- 会话产物已清理。

### Phase D: 交付与滚动迭代

- D1. 输出完成项/阻塞项/风险项。
- D2. 更新下一轮并行清单。
- D3. 按同一流程继续迭代。

## 2. 并行切片矩阵（worktree 方案）

### Slice S1（后端 metrics 真链路）

- scope:
  - `backend/control-api/src/dashboard/*`
  - `backend/control-api/src/monitoring/*`
  - `backend/control-api/src/metrics/*`
- worktree: `../wt-s1-metrics-backend`
- deliverables:
  - live metrics provider 聚合入口
  - fallback 到旧摘要字段的降级路径
  - 关键 service 测试补齐
- verify:
  - 后端相关单测（仅 metrics/dashboard/monitoring）

### Slice S2（前端 dashboard + pods 指标）

- scope:
  - `frontend/src/app/page.tsx`
  - `frontend/src/app/workloads/pods/page.tsx`
  - `frontend/src/components/dashboard-charts.tsx`
  - `frontend/src/components/visual-system.tsx`
- worktree: `../wt-s2-metrics-frontend`
- deliverables:
  - 顶部 CPU/Memory 面板接入 live snapshot
  - Pod 行级 CPU/Memory 单位展示对齐
  - 缺失态显式 `unavailable`
- verify:
  - 前端相关测试（dashboard/pods 目标用例）
  - 必要时最小 lint/typecheck

### Slice S3（API 契约与 freshness window）

- scope:
  - `frontend/src/lib/api/dashboard.ts`
  - `frontend/src/lib/api/monitoring.ts`
  - `frontend/src/lib/contracts/*`（仅必要文件）
- worktree: `../wt-s3-api-freshness`
- deliverables:
  - snapshot + history 字段契约补齐
  - freshness window 复用逻辑
  - 缺失/回退行为可观测
- verify:
  - API 层测试或最小调用验证

### Slice S4（遗留回归测试批次 1）

- scope:
  - `frontend`/`backend` 对应测试文件（仅本批回归）
  - `scripts` 中测试辅助脚本（如需）
- worktree: `../wt-s4-regression-batch1`
- deliverables:
  - 先补最关键回归：数据新鲜度、菜单交互、Pod 操作区
- verify:
  - 对应测试命令逐项通过

## 3. subagent 执行与回收规则

1. 主线程先创建切片任务卡，再分派 subagent。
2. subagent 只允许在其切片 scope 改动。
3. subagent 返回后，主线程必须先审阅再集成。
4. 一旦“结果被读取或集成”，主线程当回合立即关闭该 subagent。
5. 禁止在任务完成后挂起待用；后续新任务一律新建 subagent。

## 4. 集成顺序与依赖

- 串行依赖：
  1. S1（后端链路）先于 S2/S3 的最终对齐验证。
  2. S2 与 S3 可并行开发，集成时先合 S3 再合 S2。
  3. S4 在 S1~S3 初步合入后执行，避免测试基线反复重写。

## 5. 验收门禁

- 代码门禁：
  - 改动不越界；
  - 无明显类型或构建错误；
  - 不引入无关依赖。
- 测试门禁：
  - 每切片最小相关验证通过；
  - 失败时记录命令、错误摘要、影响范围。
- 质量门禁：
  - 缺失态展示准确；
  - 降级路径不掩盖错误；
  - 关键页面无阻塞性退化。

## 6. 风险与回滚

- 风险 R1：前后端契约不一致导致页面空态异常。
  - 缓解：先合 S1 + S3 契约，再合 S2 UI。
- 风险 R2：并行切片改动交叉。
  - 缓解：严格 scope，冲突交由主线程重排合入顺序。
- 风险 R3：回归测试数量大导致周期拉长。
  - 缓解：按“高风险优先”分批；每批可独立验收。

回滚策略：

- 切片级回滚：仅回退该切片合入提交，不影响其他切片。
- 功能级降级：保留旧指标摘要路径，live metrics 异常时自动回退。

## 7. 会话清理清单

- 清理项：
  - 测试截图、trace、临时 markdown、浏览器输出、临时日志
- 保留项：
  - 真正需要追溯的测试结果与变更说明
- 要求：
  - 在同一工作会话内完成清理，除非用户明确要求保留

# 并发控制迁移到 Autumn 改造方案

## 一、背景分析

### 1.1 当前并发控制实现

**实现方式：**
- 数据库层面：`plan_configs.max_concurrent_requests` 配置并发限制
- RPC 函数：`auth_credit_usage_chunk_47_from_team` 查询并发配置
- 代码兜底：默认值 2（extract 模式默认 200）
- Redis 队列：使用 `concurrency-limit.ts` 管理并发队列

**配置层级：**
```
organization_overrides.max_concurrent_requests (最高优先级)
  ↓
plan_configs.max_concurrent_requests (通过 team.plan_id 关联)
  ↓
RPC 函数默认值 (extract: 200, 其他: 2)
  ↓
代码兜底值 (2)
```

**当前问题：**
1. 配置分散在数据库和代码中，不统一
2. 并发限制和 credits 管理分离，升级 plan 时需要多处修改
3. 配置修改需要重启服务才能生效
4. 维护成本高，容易出错

### 1.2 Autumn 现有机制

**已实现的 Feature：**
```typescript
const CREDITS_FEATURE_ID = "credits";  // credits 管理
const TEAM_FEATURE_ID = "team";        // team entity 管理
```

**Autumn API 能力：**
- `autumnClient.check()` - 检查配额是否足够
- `autumnClient.lock()` - 锁定配额
- `autumnClient.finalize()` - 释放配额
- 支持多 feature 类型管理
- 支持层级配额配置
- 支持实时配置更新

## 二、改造方案

### 2.1 设计目标

**统一管理：**
- credits 和 concurrency 都在 Autumn 中管理
- 配置统一在 Autumn Dashboard 中维护
- 升级 plan 时自动提升所有配额

**简化架构：**
- 移除数据库中的并发配置逻辑
- 统一使用 Autumn API 进行配额检查
- 保留数据库逻辑作为降级方案

**实时生效：**
- Autumn 配置修改后实时生效
- 无需重启服务

### 2.2 技术方案

**新增 Autumn Feature：**
```typescript
const CONCURRENCY_FEATURE_ID = "concurrency";
```

**Autumn 配置：**
1. 在 Autumn Dashboard 中创建 `CONCURRENCY` feature
2. 在各个 plan 中配置并发限制配额：
   - free: 10
   - hobby: 50
   - standard: 100
   - growth: 250
   - scale: 500

**代码实现：**
```typescript
// apps/api/src/services/autumn/autumn.service.ts
const CONCURRENCY_FEATURE_ID = "concurrency";

async checkConcurrency(teamId: string): Promise<{
  allowed: boolean;
  remaining: number;
} | null> {
  if (!autumnClient || this.isPreviewTeam(teamId)) {
    return null;
  }
  try {
    const orgId = await this.resolveOrgId(teamId);
    if (!isAutumnCheckEnabled(orgId)) return null;

    const customerId = await this.ensureTrackingContext(teamId);
    const { allowed, balance } = await autumnClient.check({
      customerId,
      entityId: teamId,
      featureId: CONCURRENCY_FEATURE_ID,
      requiredBalance: 1,
    });

    const remaining = balance?.remaining ?? 0;
    return { allowed, remaining };
  } catch (error) {
    logger.error("Autumn checkConcurrency failed", { teamId, error });
    return null;
  }
}

async lockConcurrency(teamId: string): Promise<string | null> {
  if (!autumnClient || this.isPreviewTeam(teamId)) {
    return null;
  }
  const lockId = `concurrency_${randomUUID()}`;

  try {
    const orgId = await this.resolveOrgTeamId(teamId);
    if (!isAutumnEnabled(orgId)) return null;

    const customerId = await this.ensureTrackingContext(teamId);
    const { allowed } = await autumnClient.check({
      customerId,
      entityId: teamId,
      featureId: CONCURRENCY_FEATURE_ID,
      requiredBalance: 1,
      lock: {
        enabled: true,
        lockId,
        expiresAt: Date.now() + 60000, // 1分钟超时
      },
    });

    if (!allowed) {
      return null;
    }
    return lockId;
  } catch (error) {
    logger.error("Autumn lockConcurrency failed", { teamId, error });
    return null;
  }
}

async unlockConcurrency(lockId: string): Promise<void> {
  if (!autumnClient) return;

  try {
    await autumnClient.balances.finalize({
      lockId,
      action: "release",
    });
  } catch (error) {
    logger.error("Autumn unlockConcurrency failed", { lockId, error });
  }
}
```

**修改并发控制逻辑：**
```typescript
// apps/api/src/lib/concurrency-limit.ts
import { autumnService } from "../services/autumn/autumn.service";

export async function getTeamConcurrencyLimit(teamId: string): Promise<number> {
  // 优先使用 Autumn
  const autumnResult = await autumnService.checkConcurrency(teamId);
  if (autumnResult !== null) {
    return autumnResult.remaining;
  }

  // 降级到数据库查询
  const acuc = await getACUCTeam(teamId);
  return acuc?.concurrency ?? 2;
}
```

### 2.3 实施步骤

**阶段1：Autumn 配置（0.5天）**
1. 登录 Autumn Dashboard
2. 创建 `CONCURRENCY` feature
3. 在各个 plan 中配置并发限制配额
4. 测试配置是否生效

**阶段2：代码实现（1.5-2天）**
1. 在 `autumn.service.ts` 中添加并发控制方法
2. 修改 `concurrency-limit.ts` 使用 Autumn API
3. 保留数据库逻辑作为降级方案
4. 添加 feature flag 控制迁移

**阶段3：测试验证（0.5天）**
1. 单元测试
2. 集成测试
3. 灰度发布测试

**阶段4：清理优化（可选）**
1. 移除不再需要的数据库逻辑
2. 清理 Redis 队列相关代码
3. 更新文档

## 三、风险评估

### 3.1 技术风险

**风险等级：低**

**原因：**
- Autumn 机制成熟，credits 管理已稳定运行
- 可以保留数据库逻辑作为降级方案
- 可以通过 feature flag 逐步迁移

**缓解措施：**
1. 保留数据库查询逻辑作为降级方案
2. 添加详细的日志和监控
3. 灰度发布，逐步切换流量

### 3.2 业务风险

**风险等级：低**

**原因：**
- 并发限制是保护机制，不是核心功能
- 即使 Autumn 失效，降级方案也能保证系统正常运行

**缓解措施：**
1. 充分的测试验证
2. 监控并发限制的准确性
3. 准备回滚方案

## 四、工作量估算

**开发工作量：2-3天**
- Autumn 配置：0.5天
- 代码修改：1.5-2天
- 测试验证：0.5天

**测试工作量：1-2天**
- 单元测试：0.5天
- 集成测试：1天
- 回归测试：0.5天

**总计：3-5天**

## 五、临时测试配置（当前开发分支）

### 5.1 手动配置组织级别并发限制

为了测试当前开发分支的代码更改，已手动配置组织级别的并发限制：

**执行的 SQL：**
```sql
INSERT INTO public.organization_overrides (organization_id, max_concurrent_requests)
VALUES ('2458267e-47ba-4f1a-b455-06e4edbad126', 300)
ON CONFLICT (organization_id) 
DO UPDATE SET max_concurrent_requests = EXCLUDED.max_concurrent_requests;
```

**影响的 API Key：** `fc-e65f930ac573422d963a88d664fa9cbc`

**当前状态：** ✅ 已生效，Dashboard API 返回 `concurrency: 300`

### 5.2 Dashboard 接口临时修改

**修改文件：** `apps/api/src/controllers/dashboard/credit-usage.ts`

**修改内容：**
- 添加对 `organization_overrides` 表的查询
- 优先使用 `organization_overrides.max_concurrent_requests`
- 降级到 `plan_configs.max_concurrent_requests`

**部署方式：** 临时直接修改容器中的编译代码 `/app/dist/src/controllers/dashboard/credit-usage.js`

**持久化方案：** 需要重新构建容器以应用源代码修改：
```bash
docker compose build --no-cache api
docker compose restart api
```

### 5.3 RPC 函数修改（未执行）

**修改文件：** `scripts/00-init.sql`

**修改内容：**
- 在 `auth_credit_usage_chunk_47_from_team` 函数中添加 `organization_overrides` 表的 LEFT JOIN
- 使用 `COALESCE` 优先返回 `organization_overrides.max_concurrent_requests`

**执行状态：** ❌ 未执行

**执行方式：** 需要手动在 Supabase SQL Editor 中执行修改后的 SQL 语句

**影响范围：** RPC 函数主要用于认证和信用检查，不影响 Dashboard 接口

## 六、预期收益

**技术收益：**
1. 统一管理 credits 和 concurrency
2. 简化代码架构，降低维护成本
3. 配置实时生效，提升运营效率
4. 为后续功能扩展打下基础

**业务收益：**
1. 升级 plan 时自动提升所有配额
2. 配置管理更直观，减少配置错误
3. 支持更灵活的配额策略

## 六、后续优化

**短期优化：**
1. 添加并发限制的监控和告警
2. 优化并发队列的管理逻辑
3. 添加并发限制的实时查询 API

**长期优化：**
1. 支持动态调整并发限制
2. 支持基于时间段的自适应并发限制
3. 支持基于任务类型的差异化并发限制

## 七、附录

### 7.1 相关文档

- [Autumn 配置指南](./AUTUMN_CONFIG_GUIDE.md)
- [Team-Org-User 架构分析](./TEAM_ORG_USER_ARCHITECTURE.md)

### 7.2 相关代码文件

- `apps/api/src/services/autumn/autumn.service.ts`
- `apps/api/src/services/autumn/usage.ts`
- `apps/api/src/lib/concurrency-limit.ts`
- `apps/api/src/services/queue-jobs.ts`
- `scripts/00-init.sql`

### 7.3 相关数据库表

- `public.plan_configs`
- `public.organization_overrides`
- `public.team_overrides`

---

**文档版本：** 1.0
**创建日期：** 2026-04-15
**最后更新：** 2026-04-15

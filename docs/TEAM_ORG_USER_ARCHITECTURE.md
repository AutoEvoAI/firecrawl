# Firecrawl Team-Organization-User 架构分析

## 文档概述

本文档深入分析Firecrawl系统中Team、Organization、User三个概念的设计初衷、使用方式，以及相关的计费模型和防滥用机制。

**更新时间**: 2026-04-15  
**分析版本**: 当前生产版本

---

## 1. 设计初衷与概念定义

### 1.1 三层架构设计

Firecrawl采用三层架构设计，支持多租户和团队协作：

```
User (用户)
  ↓ N:M
Team (团队)
  ↓ N:1
Organization (组织)
```

**概念定义：**

- **User**: 系统的最终用户，可以登录Dashboard和使用API
- **Team**: 工作单元，拥有独立的API keys、配置和权限边界
- **Organization**: 组织容器，用于企业级管理和多Team协调

### 1.2 设计目标

**1. 多租户支持**
- Organization作为顶层租户边界
- 支持企业用户统一管理多个Team
- 便于计费和权限隔离

**2. 团队协作**
- User可以加入多个Team
- Team内部可以有多个成员
- 支持不同角色权限（owner, member等）

**3. 灵活配置**
- Team级别配置覆盖（team_overrides）
- Organization级别配置覆盖（organization_overrides）
- 支持不同Team有不同的功能限制

**4. 计费灵活性**
- 支持按Team订阅（subscriptions表关联team_id）
- 支持组织级别统一计费（Autumn Customer=Organization）
- 支持集成优惠券和特殊配置

---

## 2. 数据库结构分析

### 2.1 核心表结构

**Users表**
```sql
CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  email text UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
- 存储用户基本信息
- 与Supabase Auth集成

**Organizations表**
```sql
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
- 组织基本信息
- 作为Autumn的Customer

**Teams表**
```sql
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan_id text,
  credits bigint DEFAULT 0,
  is_admin boolean DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
- 团队核心信息
- 包含plan_id和credits字段
- org_id外键关联到Organization

**User-Teams关联表**
```sql
CREATE TABLE public.user_teams (
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);
```
- 用户和团队的多对多关系
- 支持角色权限

**Organization-Teams关联表**
```sql
CREATE TABLE public.organization_teams (
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (organization_id, team_id)
);
```
- 组织和团队的多对多关系
- **冗余设计**（teams表已有org_id外键）

### 2.2 配置覆盖表

**Team Overrides表**
```sql
CREATE TABLE public.team_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid UNIQUE REFERENCES public.teams(id) ON DELETE CASCADE,
  max_credits bigint,
  max_concurrent_requests integer,
  rate_limits jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
- 团队级别的配置覆盖
- 用于集成优惠券和特殊配置

**Organization Overrides表**
```sql
CREATE TABLE public.organization_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid UNIQUE NOT NULL,
  max_credits bigint,
  max_concurrent_requests integer,
  concurrent_browsers integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
- 组织级别的配置覆盖
- 用于企业级统一配置

### 2.3 计费相关表

**Subscriptions表**
```sql
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid UNIQUE REFERENCES public.teams(id) ON DELETE CASCADE,
  stripe_subscription_id text UNIQUE,
  stripe_price_id text,
  status text DEFAULT 'active',
  is_extract boolean DEFAULT false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
- **关键发现**: 订阅关联team_id，说明订阅是按Team的
- 支持extract和普通订阅分离

**Plan Configs表**
```sql
CREATE TABLE public.plan_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  max_credits bigint,
  max_concurrent_requests integer,
  max_team_members integer,
  features jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
- 计划配置模板
- 默认包含free, hobby, standard, growth, scale等计划

---

## 3. Autumn计费模型分析

### 3.1 Autumn层级结构

Firecrawl与Autumn的集成采用以下模型：

```
Autumn Customer = Organization (orgId)
  ↓
Autumn Entity = Team (teamId)
  ↓
Feature: CREDITS (credits)
```

**关键点：**

1. **Customer级别**: Organization作为Autumn的Customer
   - 每个Organization创建时使用`autoEnablePlanId = "free"`
   - Credits在Customer级别管理

2. **Entity级别**: Team作为Autumn的Entity
   - Team创建时使用`TEAM_FEATURE_ID = "team"`
   - **Team entity不包含独立的credits**

3. **Feature级别**: Credits作为Feature
   - 通过`CREDITS_FEATURE_ID = "credits"`管理
   - 在Customer级别共享

### 3.2 计费逻辑

**getTeamBalance函数逻辑：**
```typescript
// 1. 先尝试从Entity级别获取balance
const entity = await autumnClient.entities.get({
  customerId: orgId,
  entityId: teamId,
});
balances = entity?.balances;

// 2. 如果Entity没有CREDITS feature，fallback到Customer级别
if (!balances?.[CREDITS_FEATURE_ID]) {
  const customer = await autumnClient.customers.getOrCreate({
    customerId: orgId,
    autoEnablePlanId: "free",
  });
  balances = customer?.balances;
}
```

**关键发现：**
- Credits在Organization级别共享
- 同一Organization下的所有Team共享额度
- Team只是权限隔离，不影响计费

### 3.3 订费模型矛盾

**矛盾点分析：**

1. **数据库层面**: subscriptions表关联team_id
   - 说明订阅是按Team的
   - 每个Team可以有独立的订阅

2. **Autumn层面**: 计费在Organization级别
   - Credits在Customer (Organization)级别管理
   - 同一Organization下的Team共享额度

3. **实际影响**:
   - 如果一个Organization有多个Team，每个Team可以有独立的订阅
   - 但Credits是共享的，可能导致计费混乱
   - 需要明确订阅和Credits的关系

---

## 4. 多Team防滥用机制

### 4.1 当前防滥用设计

**Team级别防滥用：**
- 同一Organization下的多个Team共享Credits
- 创建多个Team不会获得多个free额度
- Team entity使用`TEAM_FEATURE_ID`，不包含独立的credits

**验证逻辑：**
```
用户创建Organization → Customer获得free plan额度
用户创建Team1 → Entity创建，无独立credits
用户创建Team2 → Entity创建，无独立credits
Team1和Team2共享Organization的credits
```

**结论**: 当前设计在Team级别已正确防止滥用

### 4.2 多Org滥用风险

**潜在风险：**
- 用户可以创建多个Organization
- 每个Organization获得独立的free plan额度
- 每个Organization下可创建多个Team
- 用户通过创建多个Organization获取多个free额度

**风险示例：**
```
用户创建Org1 → 获得free额度1000
用户创建Org2 → 获得free额度1000
用户创建Org3 → 获得free额度1000
总free额度: 3000 (滥用风险)
```

### 4.3 建议的防滥用方案

**方案1: 数据库层面限制（推荐）**
```sql
-- 创建user_organizations表，限制用户只能属于一个org
CREATE TABLE public.user_organizations (
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text DEFAULT 'owner',
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id) -- 一个用户只能属于一个org
);
```

**方案2: 应用层面限制**
- 在`createOrganization`时检查用户是否已属于其他org
- 在`createTeam`时检查用户的org归属
- 在`handle_new_user` trigger中确保只创建一个org

**方案3: 简化模型（最简单）**
- 移除Organization概念，直接User -> Team
- User可以直接属于多个Team
- Credits在User级别管理

**推荐方案2（应用层面限制）：**
- 不需要修改数据库结构
- 在关键位置添加检查逻辑
- 保持现有架构的灵活性
- 实现成本较低

---

## 5. Credits管理分析

### 5.1 Credits存储位置

**数据库层面：**
- `teams.credits`字段：存储credits值
- **问题**: 这个字段应该是缓存或历史记录，不应该硬编码初始值

**Autumn层面：**
- Credits在Customer (Organization)级别管理
- 通过Autumn API实时获取余额
- 是真实的credits来源

### 5.2 Credits获取逻辑

**正确的逻辑应该是：**
1. 新创建的team的credits应该从Autumn的plan配置中获取
2. Dashboard显示credits时应该从Autumn获取
3. 数据库中的`teams.credits`字段只是缓存或历史记录

**当前实现：**
- `getCreditUsage`已经实现了从Autumn获取余额的逻辑
- 需要确保所有地方都使用这个逻辑
- 不应该在数据库中硬编码初始credits

### 5.3 API Key与Credits的关系

**API Key继承Team的Credits：**
- API Key属于Team（通过team_id外键）
- 当使用API Key时，系统通过team ID从Autumn查询余额
- 不需要在数据库中存储credits，直接从Autumn实时获取

**当前实现：**
- API key列表现在显示team和organization信息
- Credits应该从Autumn实时获取

---

## 6. 架构复杂度分析

### 6.1 当前架构的复杂度

**冗余设计：**
1. `organization_teams`表是冗余的（teams表已有org_id外键）
2. `teams.credits`字段与Autumn的credits管理重复
3. subscriptions表关联team_id，但计费在org级别

**灵活性 vs 复杂度：**
- 支持多租户和团队协作
- 支持多级配置覆盖
- 但增加了理解和维护成本

### 6.2 简化建议

**短期简化：**
1. 移除`organization_teams`表的冗余
2. 明确subscriptions和Credits的关系
3. 添加用户只能属于一个org的限制

**长期简化：**
1. 考虑是否真的需要Organization概念
2. 评估是否可以直接User -> Team -> Credits
3. 简化配置覆盖层级

---

## 7. 总结与建议

### 7.1 设计初衷总结

**原始设计目标：**
1. 支持多租户架构（Organization作为顶层租户）
2. 支持团队协作（User可以加入多个Team）
3. 支持灵活配置（多级配置覆盖）
4. 支持计费灵活性（按Team订阅，按Org计费）

### 7.2 当前问题

1. **计费模型矛盾**: subscriptions按team，但Credits按org
2. **多Org滥用风险**: 用户可以创建多个org获取多个free额度
3. **架构复杂度**: 存在冗余设计，增加维护成本
4. **Credits管理**: 数据库字段与Autumn管理重复

### 7.3 建议的改进方案

**立即实施：**
1. 添加应用层面限制：用户只能属于一个Organization
2. 明确Credits管理：所有credits从Autumn获取，数据库字段仅作缓存
3. 移除冗余表：删除`organization_teams`表

### 7.4 临时解决方案（已实施）

**方案概述：**
禁用手动创建Organization和Team的功能，用户只能使用系统自动创建的默认Organization和Team。

**实施细节：**

1. **禁用手动创建路由**
   ```typescript
   // Organization Management (read-only to prevent manual creation)
   router.get("/organizations", getOrganizations);
   // router.post("/organizations", createOrganization); // Disabled

   // Team Management (read-only to prevent manual creation)
   router.get("/teams", getTeams);
   // router.post("/teams", createTeam); // Disabled
   ```

2. **自动创建机制**
   - 用户注册时，`handle_new_user_6` trigger自动创建：
     - User记录
     - Team记录（默认team）
     - Organization记录（默认org）
     - API Key记录
   - 每个用户自动获得一个默认team和一个默认org

3. **API Key创建**
   - Dashboard中的API Key创建功能保持可用
   - API Key自动关联到用户的默认team
   - 用户无法切换到其他team（因为没有其他team）

**防滥用效果：**

1. **防止多Org滥用**
   - 用户无法手动创建多个Organization
   - 每个用户只能有一个默认Organization
   - 每个Organization只能获得一个free plan额度

2. **防止多Team滥用**
   - 用户无法手动创建多个Team
   - 每个用户只能有一个默认Team
   - 所有API Key都属于同一个Team

3. **Credits管理简化**
   - Credits在Organization级别管理
   - 每个用户只有一个Organization
   - Credits归属清晰，不会出现共享混乱

**付费关联分析：**

1. **订阅关联**
   - subscriptions表关联team_id
   - 每个用户只有一个team
   - 订阅和team的关系是一对一
   - 不会出现多team共享一个org credits但各自独立订阅的矛盾

2. **Autumn计费**
   - Customer = Organization（每个用户一个）
   - Entity = Team（每个用户一个）
   - Credits在Customer级别管理
   - 计费关系清晰：User → Organization → Credits

3. **计费矛盾解决**
   - 原问题：subscriptions按team，但Credits按org
   - 新方案：每个用户只有一个team和一个org
   - 计费关系简化为：User ↔ Team ↔ Organization ↔ Credits
   - 不存在多team共享一个org的复杂情况

**实施状态：**
- ✅ 已禁用org和team的创建路由
- ✅ 已移除Dashboard中的org/team创建入口
- ✅ API Key创建功能保持正常
- ✅ 用户只能使用默认team和org

**优势：**
1. 实施简单，无需修改数据库结构
2. 完全防止多org和多team滥用
3. 简化了计费模型，解决了计费矛盾
4. 保持了API Key创建的核心功能

**局限性：**
1. 失去了多team协作的能力
2. 失去了企业级多team管理的灵活性
3. 如果未来需要多team功能，需要重新设计

**适用场景：**
- 当前阶段：适用于个人用户和小团队
- 未来扩展：如果需要企业级功能，需要重新设计架构

**中期优化：**
1. 统一计费模型：明确subscriptions和Credits的关系
2. 简化配置覆盖：减少配置层级
3. 完善文档：明确各概念的使用场景

**长期重构：**
1. 评估是否需要Organization概念
2. 考虑简化为User -> Team -> Credits
3. 根据实际使用情况调整架构

### 7.4 实施优先级

**高优先级：**
- 防止多Org滥用（应用层面限制）
- 统一Credits管理逻辑

**中优先级：**
- 移除冗余设计
- 统一计费模型

**低优先级：**
- 长期架构重构
- 简化概念层级

---

## 8. 附录

### 8.1 相关代码文件

- 数据库结构: `/scripts/00-init.sql`
- Team字段: `/scripts/01-add-team-fields.sql`
- Autumn服务: `/apps/api/src/services/autumn/autumn.service.ts`
- 计费服务: `/apps/api/src/services/billing/credit_billing.ts`
- 组织管理: `/apps/api/src/controllers/dashboard/organizations.ts`
- 团队管理: `/apps/api/src/controllers/dashboard/team.ts`

### 8.2 相关文档

- Autumn配置指南: `/docs/AUTUMN_CONFIG_GUIDE.md`
- 浏览器服务分析: `/docs/BROWSER_SERVICE_ANALYSIS.md`

### 8.3 关键函数

- `getTeamBalance`: 从Autumn获取team余额
- `ensureTeamProvisioned`: 确保team在Autumn中已创建
- `trackCredits`: 跟踪credits使用情况
- `checkCredits`: 检查credits是否足够

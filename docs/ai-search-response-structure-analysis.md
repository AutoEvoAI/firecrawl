# AI 搜索响应结构分析与改进建议

## 问题分析

### 当前实际情况

从用户测试的终端输出可以看到，当前 API 响应只返回三个字段：

```json
{
  "success": true,
  "data": {
    "web": [
      {
        "url": "https://www.geeksforgeeks.org/machine-learning/machine-learning-algorithms/",
        "title": "Machine Learning Algorithms - GeeksforGeeks",
        "description": "Your All-in-One Learning Portal..."
      }
    ]
  }
}
```

**只返回**：`url`, `title`, `description`

### 类型定义现状

查看 `apps/api/src/lib/entities.ts:146-157`，`WebSearchResult` 接口定义如下：

```typescript
export interface WebSearchResult {
  url: string;
  title: string;
  description: string;
  position?: number;
  category?: string;
  // SearXNG metadata (for internal use in reranking/aggregation)
  searxngScore?: number;
  engines?: string[];
  publishedDate?: string;
  author?: string;
  relevanceScore?: number;  // AI Reranker 相关性评分
  hitCount?: number;
}
```

**问题根源**：
1. ✅ 类型定义完整（包括 `relevanceScore`, `searxngScore` 等关键字段）
2. ❌ 实际响应中这些字段未被填充或被过滤掉
3. ❌ Response Builder 或序列化环节可能过滤了这些字段

### 设计文档要求

根据设计文档 `AI 搜索平台架构设计方案-v1.md`：

**第76行**：每条 `web` / `news` 结果新增可选字段（仅 `aiMode` 开启时出现）：
- `relevanceScore`：0-1 的相关性评分，来自 AI Reranker

**第84-88行**：响应顶层新增可选字段（仅 `includeExtra` 指定时出现）：
- `aiMetadata`：包含 `expandedQueries`, `autoCategories`, `rerankModel`, `totalCandidates`, `processingTimeMs`

**第639-644行**：SearXNG 元数据字段应保留供 AI Reranker 使用：
- `score`：SearXNG 的多引擎加权评分
- `engines`：命中的引擎列表
- `publishedDate`：发布日期
- `author`：作者

## 竞品参考分析

### Tavily 搜索响应结构

```json
{
  "query": "Who is Leo Messi?",
  "answer": "Lionel Messi, born in 1987, is an Argentine footballer...",
  "results": [
    {
      "title": "Lionel Messi Facts | Britannica",
      "url": "https://www.britannica.com/facts/Lionel-Messi",
      "content": "Lionel Messi, an Argentine footballer, is widely regarded...",
      "score": 0.81025416,  // ⭐ 相关性评分
      "raw_content": null,
      "favicon": "https://britannica.com/favicon.png",
      "images": [
        {
          "url": "<string>",
          "description": "<string>"
        }
      ]
    }
  ],
  "response_time": "1.67",
  "auto_parameters": {
    "topic": "general",
    "search_depth": "basic"
  }
}
```

**亮点字段**：
- ✅ `score`: 0.81025416 - 直接的相关性评分
- ✅ `content`: 完整内容片段（不只是description）
- ✅ `favicon`: 网站图标
- ✅ `answer`: AI 生成的直接回答
- ✅ `response_time`: 响应时间
- ✅ `auto_parameters`: 自动参数选择

### Exa 搜索响应结构

```json
{
  "requestId": "b5947044c4b78efa9552a7c89b306d95",
  "results": [
    {
      "title": "A Comprehensive Overview of Large Language Models",
      "url": "https://arxiv.org/pdf/2307.06435.pdf",
      "publishedDate": "2023-11-16T01:36:32.547Z",
      "author": "Humza Naveed, University of Engineering and Technology (UET), Lahore, Pakistan",
      "id": "https://arxiv.org/abs/2307.06435",
      "image": "https://arxiv.org/pdf/2307.06435.pdf/page_1.png",
      "favicon": "https://arxiv.org/favicon.ico",
      "text": "Abstract Large Language Models (LLMs) have recently demonstrated remarkable capabilities...",
      "highlights": [
        "Such requirements have limited their adoption..."
      ],
      "highlightScores": [
        0.4600165784358978
      ],
      "summary": "This overview paper on Large Language Models (LLMs) highlights key developments...",
      "subpages": [
        {
          "id": "https://arxiv.org/abs/2303.17580",
          "url": "https://arxiv.org/pdf/2303.17580.pdf",
          "title": "HuggingGPT: Solving AI Tasks with ChatGPT and its Friends in Hugging Face",
          "author": "Yongliang Shen, Microsoft Research Asia...",
          "publishedDate": "2023-11-16T01:36:20.486Z",
          "text": "HuggingGPT: Solving AI Tasks with ChatGPT and its Friends in Hugging Face...",
          "summary": "HuggingGPT is a framework using ChatGPT as a central controller...",
          "highlights": ["2) Recently, some researchers started to investigate the integration..."],
          "highlightScores": [0.32679107785224915]
        }
      ],
      "extras": {
        "links": []
      }
    }
  ],
  "searchType": "auto",
  "costDollars": {
    "total": 0.007,
    "breakDown": [...]
  }
}
```

**亮点字段**：
- ✅ `publishedDate`: 完整的发布日期（ISO 8601格式）
- ✅ `author`: 详细的作者信息
- ✅ `highlights`: 关键片段高亮
- ✅ `highlightScores`: 高亮片段的相关性评分
- ✅ `summary`: AI 生成的摘要
- ✅ `subpages`: 相关子页面
- ✅ `image`: 页面预览图
- ✅ `favicon`: 网站图标
- ✅ `costDollars`: 成本信息

## 推荐的完整响应结构

### 基础响应结构（必选字段）

```typescript
export interface WebSearchResult {
  // 基础字段（当前已有）
  url: string;
  title: string;
  description: string;

  // ⭐ 相关性评分（体现AI搜索价值）
  score: number;                 // 0-1，AI Reranker 计算的相关性评分（统一命名）

  // 元数据字段（提升搜索质量）
  publishedDate?: string;       // ISO 8601 格式的发布日期
  author?: string;               // 作者信息
  favicon?: string;              // 网站图标 URL
  image?: string;                // 页面预览图 URL

  // 内部字段（可选返回）
  position?: number;             // 排名位置
  category?: string;             // 分类
  hitCount?: number;             // 跨查询命中次数

  // 高级字段（AI 特有）
  highlights?: string[];          // 关键片段高亮
  highlightScores?: number[];     // 高亮片段的相关性评分
  summary?: string;               // AI 生成的摘要
}

// 扩展字段（通过 includeExtra 按需返回）
export interface WebSearchResultExtended {
  searxngScore?: number;          // 0-1，SearXNG 原始评分（扩展字段）
  engines?: string[];            // 命中的搜索引擎列表（扩展字段）
}
```

### 顶层响应结构

```typescript
export interface SearchV2Response {
  // 结果列表
  web?: WebSearchResult[];
  images?: ImageSearchResult[];
  news?: NewsSearchResult[];
  
  // ⭐ AI 元数据（体现AI搜索价值）
  aiMetadata?: {
    expandedQueries: string[];           // AI 扩展的查询列表
    autoCategories: string[];            // AI 自动推断的类别
    rerankModel: string;                 // 使用的 rerank 模型名称
    totalCandidates: number;             // rerank 前的候选总数
    processingTimeMs: number;            // AI 管线总耗时
    phaseTimes?: Record<string, number>; // 各阶段耗时
    cacheHit?: boolean;                  // 是否命中缓存
    intent?: string;                     // 意图分类结果
  };
  
  // 额外信息（通过 includeExtra 控制）
  extra?: {
    suggestions?: string[];              // 搜索建议
    answers?: Array<{ text: string; url: string }>;  // 直接回答
    corrections?: string[];              // 拼写纠正
    knowledgeCards?: Array<{             // 知识卡片
      title: string;
      content: any;
      img_src?: string;
      urls?: string[];
    }>;
  };
  
  // 性能和元信息
  responseTime?: number;                 // 总响应时间（毫秒）
  searchType?: string;                   // 搜索类型（auto/basic/deep）
  requestId?: string;                    // 请求ID
}
```

## 实现建议

### 1. 立即修复（P0）

**目标**：让现有的字段能够正确返回

**步骤**：
1. 检查 Response Builder 的序列化逻辑
2. 确保 `relevanceScore` 和 `searxngScore` 被正确填充
3. 从 SearXNG 完整响应中提取 `publishedDate`, `author`, `favicon`
4. 添加字段过滤逻辑（通过 `includeExtra` 或新参数控制）

**代码位置**：
- `apps/api/src/lib/ai-search/response-builder.ts` - Response Builder
- `apps/api/src/lib/ai-search/result-parser.ts` - 结果解析器
- `apps/api/src/search/v2/searxng.ts` - SearXNG 适配器

### 2. 短期实现（P1）

**目标**：添加核心 AI 特有字段

**新增字段**：
- `aiMetadata.expandedQueries` - 从 Query Expander 获取
- `aiMetadata.autoCategories` - 从 Intent Classifier 获取
- `aiMetadata.processingTimeMs` - 各阶段耗时统计
- `highlights` 和 `highlightScores` - 从内容中提取关键片段
- `summary` - 使用 LLM 生成摘要

### 3. 中期实现（P2）

**目标**：增强用户体验的字段

**新增字段**：
- `favicon` - 从 SearXNG 或网页中提取
- `image` - 页面预览图
- `answer` - AI 生成的直接回答（类似 Tavily）
- `subpages` - 相关子页面（类似 Exa）

## 字段优先级评估

| 字段 | 优先级 | 重要性 | 原因 |
|------|--------|--------|------|
| `relevanceScore` | P0 | ⭐⭐⭐⭐⭐ | 体现 AI 搜索核心价值 |
| `searxngScore` | P0 | ⭐⭐⭐⭐⭐ | 搜索结果质量指标 |
| `aiMetadata.expandedQueries` | P0 | ⭐⭐⭐⭐⭐ | 展示 AI 扩展能力 |
| `publishedDate` | P0 | ⭐⭐⭐⭐ | 时效性判断 |
| `author` | P0 | ⭐⭐⭐⭐ | 权威性判断 |
| `aiMetadata.processingTimeMs` | P1 | ⭐⭐⭐⭐ | 性能监控 |
| `highlights` | P1 | ⭐⭐⭐⭐ | 用户体验提升 |
| `summary` | P1 | ⭐⭐⭐⭐ | AI 能力展示 |
| `favicon` | P2 | ⭐⭐⭐ | 视觉体验 |
| `image` | P2 | ⭐⭐⭐ | 视觉体验 |
| `answer` | P2 | ⭐⭐⭐ | 直接回答能力 |
| `subpages` | P3 | ⭐⭐ | 高级功能 |

## 当前问题排查清单

1. **Response Builder 过滤问题**
   - 检查 `buildSearchResponse` 函数是否过滤了字段
   - 检查序列化逻辑（JSON.stringify）是否有自定义 replacer

2. **SearXNG 响应解析问题**
   - 检查 `parseSearXNGResponse` 是否完整解析所有字段
   - 检查是否从 SearXNG JSON 中提取了 `score`, `publishedDate`, `author`

3. **AI Reranker 未工作**
   - 检查 `twoLevelRerank` 是否被调用
   - 检查 `relevanceScore` 是否被计算和附加

4. **AI Metadata 未填充**
   - 检查 Query Expander 和 Intent Classifier 是否工作
   - 检查 `aiMetadata` 是否被正确附加

## 总结

当前响应结构过于简化，缺失大量关键信息，特别是：
- ❌ **没有相关性评分** - 无法体现 AI 搜索价值
- ❌ **没有 AI 扩展信息** - 用户不知道 AI 做了什么
- ❌ **没有元数据** - 缺少时效性、权威性判断依据

建议按照上述优先级逐步实现，至少确保 P0 字段能够正确返回，这样才能体现 AI 搜索平台的核心价值。

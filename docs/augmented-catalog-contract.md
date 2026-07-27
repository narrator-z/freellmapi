# freellmapi-augmented 目录契约与规则（客户端消费侧要求）

> 基于 freellmapi 客户端 `server/src/services/catalog-sync.ts`、`server/src/providers/index.ts`
> 与 freellmapi-augmented 流水线（build/parse 脚本）双向核对整理。2026-07-27。

## 1. 接口与消费流程

- **端点**：`https://git.260123.xyz/narrator-z/freellmapi-augmented/raw/branch/main/output/augmented_catalog.json`
- **节奏**：客户端每 12 小时拉取一次；启动后 10 秒首拉；拉取失败时回放缓存（`settings.catalog_applied_json`，schemaVersion 3）。
- **消费顺序**：`fetch → isCatalog() 形状校验 → registerFromCatalog(platforms) → applyCatalog(models/quirks/embeddings/transcription) → 写缓存`。
- **version**：单调递增（当前为日期 `YYYY-MM-DD`），用于客户端判断新旧；回退产物标 `tier=fallback`。

## 2. 顶层 schema

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` / `generatedAt` | ✅ | 字符串 |
| `platforms[]` | ✅ | 见 §3 |
| `models[]` | ✅ | 见 §4 |
| `quirks[]` | ✅ | 见 §5 |
| `embeddings[]` | 可选 | 省略 = 客户端保留内置基线不动；见 §6 |
| `transcriptionModels[]` | 可选 | 省略 = 客户端不动现有转录行；见 §6 |
| `counts` / `_unresolved` | 可选 | 客户端不消费，仅流水线质量门禁用 |

**演化原则**：新增顶层键必须可选。老客户端的 `isCatalog` 会忽略未知键，但 `models[]` 里出现未知 `modality` 会被老版本**当作 chat 模型入库** —— 新模态必须走新顶层键（`transcriptionModels` 就是先例），禁止塞进 `models[]`。

## 3. platform 条目规则

必填：`id`、`name`、`url`（取 key 页面）、`keyless`、`apiBaseUrl`、`adapter`。可选：`timeoutMs`、`forceSingleToolCall`、`extraHeaders`、`quota.poolKey`。

- **`apiBaseUrl` 为空** → 客户端不会自动注册；若客户端也没有静态注册，该平台所有模型被静默跳过（计入 `skippedUnknownPlatform`）。
- **`adapter` 必须真实**。`openai-compat` 声明意味着客户端会按 OpenAI Chat Completions 直接调用。反例：cheahjs 源的 `google-ai-studio`（原生 Gemini API）声明 `openai-compat` 且 base 为空 —— 客户端已被迫静态注册兜底。
- **`yangmao-*` 前缀是保留约定**：客户端把 7 个大厂 wrapper 别名到真实 provider（`yangmao-alibaba→qwen` 等）并用 wrapper 的连接数据注册目标；**新增大厂 wrapper 需要客户端同步加别名表**，否则模型被跳过（当前 `yangmao-anthropic`/`yangmao-openai` 即此状态）。
- 平台 `id` 全目录唯一；`url` 用于 Keys 页"获取密钥"链接。

## 4. model 条目规则（核心）

必填：`platform`、`modelId`、`displayName`、`intelligenceRank`、`speedRank`、`sizeLabel`、`limits{rpm,rpd,tpm,tpd}`、`monthlyTokenBudget`、`contextWindow`、`enabled`、`supportsVision`、`supportsTools`。可选：`modality`（默认 text）、`mediaNote`。

- **⚠️ `modelId` 必须是 provider API 可直接调用的 ID，不是显示名。** 这是当前目录最大的数据质量问题：
  - 显示名行会原样入库，调用时 404；
  - 与客户端基线的真实 ID 行冲突时，会**挤掉可用行**（groq 案例：目录 `Llama 3.3 70B` vs 基线 `llama-3.3-70b-versatile`）。
  - **建议流水线新增 `apiModelId` 字段**（客户端可优先消费，缺省回退 `modelId`），并在解析层完成映射：
    - groq：`Llama 3.3 70B → llama-3.3-70b-versatile`（客户端已临时硬编 5 条，正解在流水线）
    - google-ai-studio：slug 化 + TTS 特例（客户端已兜底）
    - openrouter：需要查 OpenRouter models API 的 `publisher/slug`（免费版带 `:free`），9 个模型待解
    - yangmao 大厂：anyscale 要 `meta-llama/` 前缀、moonshot 要 `kimi-k2-0711-preview` 式 ID 等，10 个模型待解
- **`platform` 必须存在于 `platforms[]`**（流水线干净化已强制）。
- **`platform+modelId` 全目录唯一**。
- **垃圾行零容忍**：数据源的章节标题/label 行（案例：`Open and Proprietary Mistral models`）必须在解析层过滤，客户端 blocklist 只是兜底。
- **`enabled=false` 语义 = 该模型上游已死**，客户端强制禁用且不可被用户覆盖；只有确实下线的模型才标 false。
- `modality: image|audio` → 入 `media_models`，平台必须在客户端媒体注册表内；转录模型不要走 `modality`，走 `transcriptionModels[]`。

## 5. quirk 规则

- `slug` 唯一；`severity ∈ {blocker, warning, info}`。
- `targets[].platform` 必须是真实平台 id 或 `null`（全局）；**引用不存在平台的 quirk 会被流水线干净化丢弃**（已强制）。
- quirk 是纯内容：客户端每次全量替换。

## 6. embeddings / transcriptionModels 规则

- **embeddings**：`family/platform/modelId/displayName/dimensions(number)/priority(number)/enabled(boolean)` 为 `isCatalog` 硬校验项，缺一整个目录被拒。`platform` 必须在客户端嵌入注册表内。省略该键 = 客户端保留内置基线（当前目录即省略状态，正常）。
- **transcriptionModels**：`platform/modelId/displayName/priority/enabled` 硬校验；可选 `subtitleFormats[]`、`maxBytes`、`requestStyle`、`quotaLabel`。`platform` 目前仅支持 `groq`/`cloudflare`，新增平台需先扩客户端 `TRANSCRIPTION_PLATFORMS`。

## 7. 当前目录（2026-07-27）数据问题清单

| 问题 | 位置 | 状态 |
|---|---|---|
| 显示名 modelId ×17 + 空 apiBaseUrl + 错 adapter | cheahjs `google-ai-studio` | 客户端已静态注册+slug 兜底；流水线应输出 apiModelId |
| 垃圾标题行 ×1 | cheahjs `mistral-la-plateforme` | 客户端 blocklist 兜底；流水线应过滤 |
| 显示名 modelId ×5（与基线冲突） | base `groq` | 客户端硬编覆盖表；**建议上游 base 修** |
| 显示名 modelId ×9 | base `openrouter` | ❌ 未解，需查 OpenRouter API |
| 显示名 modelId ×10 | yangmao 大厂模型 | ❌ 未解，需逐厂映射 |
| wrapper 无别名映射 ×2 | `yangmao-anthropic`/`yangmao-openai` | 客户端按设计跳过（目标非兼容/付费） |

## 8. 流水线侧建议的落地顺序

1. 模型条目增加 `apiModelId`（先覆盖 §7 的 36 个已知问题行）；
2. cheahjs/yangmao 解析层过滤非模型行（无版本号/含空格的"句子式"名称加白名单人工复核）；
3. `review.py` 门禁加一条：**modelId 含空格的行数回归**（当前基线 ~41 行，只许降不许升）；
4. 客户端随后改为优先消费 `apiModelId`，删除硬编覆盖表。

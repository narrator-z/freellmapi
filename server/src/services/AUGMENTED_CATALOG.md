# Augmented Catalog 同步（fork 自有数据源）

> 本文件记录 **augmented catalog** 在 fork 中的实现思路、两个 v1-lineage 影子平台的静态注册方式，以及后续如何更新数据源。
> 配套代码：`augmented-catalog-sync.ts`（本目录）。

## 1. 背景与动机

fork 在重合并到上游 `tashfeenahmed/freellmapi` 时采用了上游的 `catalog-sync.ts`，其 `syncCatalog()`
走**签名校验 API**（`api.freellmapi.co/v1/latest` + Ed25519 响应头验签 + `version`/`tier` 门控）。
这导致 fork 原本的 **augmented catalog**（裸 git-raw JSON、免签名）被静默切到了上游数据源，
且 `AUGMENTED_CATALOG_URL`、`registerFromCatalog`、`YANGMAO_PLATFORM_ALIASES` 等被上游 rebase 删除。

目标：让 fork 继续从**自己的 augmented catalog** 取数据，且数据源可随时改 URL 更新，无需改代码。

## 2. 实现思路（路径 C 的干净版）

新增一个**自包含模块** `augmented-catalog-sync.ts`（从 fork 旧 `catalog-sync.ts` 复制后，类型/函数
全局加 `Augmented*` 前缀，避免与上游 `catalog-sync.ts` 冲突）：

- 直接拉取 fork 的 augmented JSON：`AUGMENTED_CATALOG_URL`
  （默认 `https://git.260123.xyz/narrator-z/freellmapi-augmented/raw/branch/main/output/augmented_catalog.json`，可用 env 覆盖）。
- **免签名**；用 `isAugmentedCatalog()` 做形状校验（`platforms[]`、`models[]`、`quirks[]`、`version`、`tier` 等）。
- `applyAugmentedCatalog()` 写入 models / quirks / media / embeddings / transcription 表。
- 设置键**隔离**为 `augmented_catalog_*`，避免启动期上游 `reapplyCachedCatalog()` 把 augmented payload 误判为非 `isCatalog` 而清空。
- 上游的 `syncCatalog()`（签名校验）**保持不动**，作为 fallback / 可选路径。
- 接线：`catalog-sync.ts` 的 `startCatalogSync(scheduler)` 在启动期 `reapplyCachedAugmentedCatalog()`，
  随后循环 `void syncAugmentedCatalog()`。`server/src/index.ts` 的调用点不变。

### 为什么不复用上游 transport
fork 的 augmented JSON 是裸 JSON、无 `x-catalog-signature`，而上游 `catalogPublicKey()` 用写死公钥验签，
直接改 `CATALOG_BASE_URL` 指回会被 `catalog response missing signature` 丢弃。因此选择独立模块，
而非去 patch 上游的验签逻辑。

## 3. 两个 v1-lineage 影子平台的静态注册

augmented catalog 里有两个 fork 历史平台：`google-ai-studio`、`mistral-la-plateforme`。
它们与规范的 `google` / `mistral` **同一后端**，但想保留各自的 platform id（方便数据源单独标记/覆盖）。

做法（**静态注册**，非 apply 时 remap）：

1. 扩展共享类型联合：在 `shared/types.ts` 的 `Platform` 联合中加入
   `'google-ai-studio'` 和 `'mistral-la-plateforme'`（`Platform` 被 client/server 共用，已验证两端 tsc 通过）。
2. 给 `GoogleProvider` 增加可选参数 `platform?` / `name?`（默认 `'google'` / `'Google AI Studio'`），
   使其能在**不改动核心逻辑**的前提下以别的 platform id 注册。
3. 在 `server/src/providers/index.ts` 注册：
   - `google-ai-studio` → `new GoogleProvider({ platform: 'google-ai-studio', name: 'Google AI Studio (Extended)', timeoutMs: 60_000 })`
     （原生 Gemini 后端，更广的 Gemini/Gemma 覆盖；catalog 条目无 `apiBaseUrl`、adapter 标 `openai-compat`，故必须静态注册）
   - `mistral-la-plateforme` → `new OpenAICompatProvider({ platform: 'mistral-la-plateforme', name: 'Mistral (La Plateforme)', baseUrl: 'https://api.mistral.ai/v1' })`
4. 这两个平台由 `providers/index.ts` 静态注册后，`registerFromCatalog()` 会因 `providers.has(id)` 命中而跳过，不会重复注册。

> 注意：apply 阶段**不再**把这两个平台的模型 remap 到 `google`/`mistral`，模型按其真实 platform id 落地，
> 由上面静态注册的 provider 承接路由。

## 4. 后续更新 / 使用记录

### 换数据源（最常用）
- 设环境变量 `AUGMENTED_CATALOG_URL` 指向你自己的 augmented catalog JSON。
- 想回退到上游签名 catalog：设 `CATALOG_BASE_URL`（上游 `syncCatalog()` 仍在，可二选一）。

### augmented catalog JSON 形状（数据源侧，精确规格）

顶层对象须通过 `isAugmentedCatalog()` 形状校验，否则整包被丢弃、沿用上次缓存。

**顶层字段（来源 `AugmentedCatalog` + `isAugmentedCatalog`）**

| 字段 | 必填 | 说明 |
|------|------|------|
| `version` | ✅ | 字符串。**必须 `>= '2026.06.07'`（字典序）**，否则 reapply 缓存时被丢弃。⚠️ 用 `YYYY.MM.DD` 且**月份/日期补零**（`2026.07.29` 而非 `2026.7.9`）——字典序比较下 `2026.7.9` 会被误判大于 `2026.10.01`。 |
| `generatedAt` | ✅ | ISO 时间字符串，如 `2026-07-29T00:00:00Z`。 |
| `models` | ✅ | `AugmentedCatalogModel[]`，非空。 |
| `quirks` | ✅ | `CatalogQuirk[]`，非空；每项 `{ slug: string, targets: {platform: string\|null, modelGlob: string\|null}[], title, body, severity }`。 |
| `tier` | ⬜ | 推荐填（`free`/`premium`），会写入 `augmented_catalog_applied_tier`。 |
| `platforms` | ⬜ | **仅当要让 catalog 自动注册「新」provider 时才需要**。那两个静态平台无需条目（即便有也会被 `providers.has(id)` 跳过）。 |
| `embeddings` / `transcriptionModels` / `counts` | ⬜ | 可选。 |
| `schemaVersion` | ⬜ | apply 不校验；reapply 缓存时 `< 3` 会被丢弃，缺失自动回填 `3`。建议直接写 `3`。 |

**`models[]` 每项字段（`AugmentedCatalogModel`）**

| 字段 | 必填 | 类型 / 说明 |
|------|------|------|
| `platform` | ✅ | 已注册 platform id（如 `google-ai-studio` / `mistral-la-plateforme`）。**未知 platform → 计 `skippedUnknownPlatform` 跳过，不进 DB、不报错。** |
| `modelId` | ✅ | 模型标识。`google-ai-studio` 多为人类展示名（带空格，如 `Gemini 2.5 Pro`），apply 时会 slug。 |
| `displayName` | ✅ | 展示名。 |
| `enabled` | ✅ | `false` = 上游标记死模型，强制禁用。 |
| `limits` | ✅ | 对象，**4 个键都要有**：`{ rpm, rpd, tpm, tpd }`，值可为 `null`。 |
| `supportsVision` / `supportsTools` | ✅ | 布尔。 |
| `intelligenceRank` / `speedRank` | ✅ | `number \| null`。 |
| `sizeLabel` | ✅ | `string \| null`。 |
| `monthlyTokenBudget` | ✅ | `string \| null`。 |
| `contextWindow` | ✅ | `number \| null`。 |
| `apiModelId` | ⬜ | **强烈建议**。真正可调用的 API id（如 `gemini-2.5-pro`、`mistral-large-latest`）。缺失时：`google-ai-studio`/`google` → 回退 `googleStudioApiModelId(modelId)` slug；其他 → 回退 `modelId`。 |
| `modality` / `mediaNote` | ⬜ | 可选。 |

**`platforms[]` 每项字段（`CatalogPlatform`，仅自注册新 provider 时需要）**

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` / `name` / `url` / `keyless` / `apiBaseUrl` / `adapter` | ✅ | 基础字段。 |
| `adapter` | ✅ | 取值 `google`/`cohere`/`cloudflare`/`aihorde`/`openai-compat`（其他或缺失 → `openai-compat`）。 |
| `apiBaseUrl` | ✅ | 缺失则该平台被跳过（`[catalog] skipping <id>: no apiBaseUrl`）。 |
| `timeoutMs` / `forceSingleToolCall` / `extraHeaders` / `quota` | ⬜ | 可选。 |

### 两个 v1-lineage 平台的数据源要求（本次重点）

- **`platforms[]` 无需加这两个条目**——已在 `providers/index.ts` 静态注册；catalog 里有也会被跳过，不会冲突。
- **`google-ai-studio`**
  - 走原生 Gemini API。最稳妥：给 `apiModelId` 填真正的 Gemini 模型 id（如 `gemini-2.5-pro`、`gemini-2.5-flash-latest`）。
  - 若只给 `modelId` 展示名（如 `Gemini 2.5 Pro`），apply 会 slug 成 `gemini-2.5-pro`；但 slug 规则不保证覆盖所有命名，建议**显式 `apiModelId`** 更可靠。
  - 把比规范 `google` 更广的 Gemini/Gemma 模型放这个 platform。
- **`mistral-la-plateforme`**
  - 走 `OpenAICompatProvider` @ `https://api.mistral.ai/v1`。直接给 Mistral API 模型 id（如 `mistral-large-latest`、`codestral-latest`）到 `modelId`（或 `apiModelId`）。
- **剔除 junk 行**：section header / 标签行（如 `mistral-la-plateforme:Open and Proprietary Mistral models`）不要进 `models[]`（`CATALOG_MODEL_JUNK` 有兜底，但数据源侧应直接过滤）。

### 生效与失败表现

- 端点：`AUGMENTED_CATALOG_URL`（默认 git.260123.xyz 那份，可 env 覆盖）。须返回 HTTP 2xx + 合法 JSON（fetch 20s 超时）。
- 启动 10s 后首次拉取，之后**每 12 小时**轮询一次；重启立即拉；`CATALOG_SYNC_DISABLED=1` 可关。改完数据源最多 12h 生效（重启即立即生效）。
- 拉取/形状失败只写 `augmented_catalog_last_error` 设置，不崩，沿用上次缓存。

### 数据源修改要求清单（改之前自查）

1. `version` 用 `YYYY.MM.DD` 且**月份/日期补零**，且 `>= 2026.06.07`。
2. `generatedAt`、`models[]`、`quirks[]` 三个必填顶层字段都在且非空。
3. 每个 `models[]` 项：`platform`/`modelId`/`displayName`/`enabled`/`limits`(4 键)/`supportsVision`/`supportsTools` 齐全；`limits` 4 个键都存在（值可 null）。
4. `google-ai-studio` 的展示名模型显式给 `apiModelId`（真正 Gemini id）；`mistral-la-plateforme` 给 Mistral API id。
5. 所有 `models[].platform` 都是**已注册** id；未知 id 会被静默跳过。
6. `platforms[]` 里**不要**放 `google-ai-studio` / `mistral-la-plateforme`（已静态注册）；要自注册新 provider 才放，且必须有 `apiBaseUrl` + 合法 `adapter`。
7. 过滤掉 junk / 标签行，保证纯模型条目。
8. JSON 可被公网以 2xx 拉到（注意 git raw 的 redirect / MIME）。

### 加一个新平台
1. 在 `shared/types.ts` 的 `Platform` 联合追加 id（记得两端 tsc 校验）。
2. 二选一：
   - **静态注册**：在 `providers/index.ts` 加 `register(new XxxProvider({ platform: '<id>', ... }))`（适用于无 `apiBaseUrl` 或需手工调参的平台）。
   - **catalog 自注册**：保证 catalog `platforms[]` 条目带 `apiBaseUrl` + 正确的 `adapter`（`google`/`cohere`/`cloudflare`/`aihorde`/`openai-compat`），`registerFromCatalog()` 会自动建。

### 改 `google-ai-studio` / `mistral-la-plateforme` 的注册参数
直接改 `providers/index.ts` 里对应的 `register(...)` 调用（baseUrl / timeout / name 等）。

### 同步节奏
`startCatalogSync(scheduler)` 启动时先 `reapplyCachedAugmentedCatalog()`（用上次缓存），然后按调度器间隔轮询 `syncAugmentedCatalog()`。

## 5. 已知约束 / 坑

- `Platform` 联合被 client 共用，新增平台务必跑 `npm run build -w client`（`tsc -b`）确认未冲破客户端穷举。
- `augmented-live.test.ts` 仅在设了 `AUG_PATH` 时运行（CI 不跑）；它断言 `hasProvider('google-ai-studio')` / `hasProvider('mistral-la-plateforme')` 为 `true`。
- 本地 `vitest` 因 `better-sqlite3` 原生绑定未编译跑不了，测试以 CI（Linux）为准。
- `server/dist/` 是 gitignore 的构建缓存；里面若残留旧静态注册是脏产物，从源码重新构建即覆盖，不影响 git/CI。

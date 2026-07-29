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

### augmented catalog JSON 形状（数据源侧）
顶层需满足 `isAugmentedCatalog()`：
```
{
  "version": "2026.xx.xx",
  "tier": "free" | "premium",
  "generatedAt": "<iso datetime>",
  "counts": { ... },
  "platforms": [ { "id", "name", "url", "keyless", "apiBaseUrl", "adapter", ... } ],
  "models": [ { "platform", "modelId", "displayName", "apiModelId"?, "modality"? , ... } ],
  "quirks": [ ... ]
}
```
- `models[].platform` 为上面的 platform id（如 `google-ai-studio`）。
- `google-ai-studio` 的展示名模型（含空格）会在 apply 时经 `googleStudioApiModelId()` slug 成 API id；
  若 catalog 已给 `apiModelId` 则优先用。

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

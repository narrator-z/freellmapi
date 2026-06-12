import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Locale = 'en' | 'zh'

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Navigation
    'nav.models': 'Models',
    'nav.playground': 'Playground',
    'nav.keys': 'Keys',
    'nav.analytics': 'Analytics',
    'nav.premium': 'Premium',
    'nav.signOut': 'Sign out',
    'nav.theme': 'Theme',

    // Common
    'common.loading': 'Loading…',
    'common.save': 'Save',
    'common.discard': 'Discard',
    'common.unsavedChanges': 'Unsaved changes',
    'common.saveChanges': 'Save changes',
    'common.saving': 'Saving…',
    'common.apply': 'Apply',
    'common.applying': 'Applying…',
    'common.applied': 'Applied',
    'common.check': 'Check',
    'common.checking': 'Checking…',
    'common.checkAll': 'Check all',
    'common.remove': 'Remove',
    'common.optional': 'optional',
    'common.noDataYet': 'No data yet',
    'common.noErrors': 'No errors',
    'common.on': 'On',

    // Models / Fallback page
    'models.title': 'Models',
    'models.description': 'Pick a routing strategy. In Manual mode you drag to set the order; the other strategies route by live score across reliability, speed and intelligence.',
    'models.routingStrategy': 'Routing strategy',
    'models.manualMode': 'Manual mode: requests follow the order below, top-to-bottom. Drag to reorder.',
    'models.autoMode': 'Scores update from live traffic. The order below is how requests are routed right now.',
    'models.monthlyTokenBudget': 'Monthly token budget',
    'models.remaining': 'remaining',
    'models.noModelsAvailable': 'No models available. Add API keys on the <a href="/keys" class="underline text-foreground">Keys page</a> first.',
    'models.hiddenNoKeys': 'Hidden (no keys)',
    'models.showAll': 'Show all',
    'models.models': 'models',
    'models.showLess': 'Show less',
    'models.unsavedChanges': 'Unsaved changes',
    'models.saveChanges': 'Save changes',

    // Strategy labels
    'strategy.manual': 'Manual',
    'strategy.manualBlurb': 'Route in the exact order you set below. Drag the handles to reorder. No scoring; the chain is followed top-to-bottom.',
    'strategy.balanced': 'Balanced',
    'strategy.balancedBlurb': 'Reliability leads (50%), with speed and intelligence weighted equally (25% each). A sensible all-round default.',
    'strategy.smartest': 'Smartest',
    'strategy.smartestBlurb': 'Prefer the most capable model that still works. Intelligence 55%, reliability 35%, speed 10%.',
    'strategy.fastest': 'Fastest',
    'strategy.fastestBlurb': 'Prefer the fastest model that still works. Speed 55%, reliability 35%, intelligence 10%.',
    'strategy.mostReliable': 'Most reliable',
    'strategy.mostReliableBlurb': 'Maximize success rate above all. Reliability 70%, speed and intelligence 15% each.',
    'strategy.custom': 'Custom',
    'strategy.customBlurb': 'Set your own balance of reliability, speed and intelligence with sliders. Same engine as the presets, just your weights.',

    // Table headers
    'table.model': 'Model',
    'table.reliability': 'Reliability',
    'table.speed': 'Speed',
    'table.intelligence': 'Intelligence',
    'table.guardrails': 'Guardrails',
    'table.guardrailsTip': 'Always-on guardrails: free-quota headroom × live rate-limit penalty. Below 1.0 means the model is being held back.',
    'table.score': 'Score',
    'table.scoreTip': 'Final routing score = weighted average of the three axes, multiplied by the guardrails. Higher routes first.',
    'table.vision': 'Vision',
    'table.visionTip': 'Accepts image input',
    'table.tools': 'Tools',
    'table.toolsTip': 'Emits structured tool calls, so it is eligible for tool-bearing requests',
    'table.penalty': 'penalty',
    'table.observations': 'obs',

    // Custom weights
    'weights.title': 'Custom weights',
    'weights.description': 'Sliders are independent; shares auto-balance to 100%.',
    'weights.reliability': 'Reliability',
    'weights.speed': 'Speed',
    'weights.intelligence': 'Intelligence',
    'weights.minWeightWarning': 'At least one weight must be above zero.',

    // Playground page
    'playground.title': 'Playground',
    'playground.description': 'Send a chat completion through the router and see which provider serves it.',
    'playground.autoModel': 'Auto (fallback chain)',
    'playground.sendMessage': 'Send a message to get started.',
    'playground.usingModel': 'Using',
    'playground.switchModels': 'Switch models in the selector above.',
    'playground.placeholder': 'Type a message… (⏎ to send, ⇧⏎ for newline)',
    'playground.send': 'Send',
    'playground.sending': 'Sending…',
    'playground.clear': 'Clear',

    // Keys page
    'keys.title': 'Keys',
    'keys.description': 'Provider credentials and the unified API key your apps connect with.',
    'keys.unifiedApiKey': 'Your unified API key',
    'keys.unifiedKeyDescription': 'Use this as your OpenAI <code class="font-mono">api_key</code>; it authenticates requests to this proxy.',
    'keys.regenerate': 'Regenerate',
    'keys.show': 'Show',
    'keys.hide': 'Hide',
    'keys.copy': 'Copy',
    'keys.copied': 'Copied',
    'keys.baseUrl': 'Base URL',
    'keys.chat': 'Chat',
    'keys.responses': 'Responses',
    'keys.embeddings': 'Embeddings',
    'keys.addProviderKey': 'Add a provider key',
    'keys.platform': 'Platform',
    'keys.selectProvider': 'Select provider',
    'keys.accountId': 'Account ID',
    'keys.apiToken': 'API token',
    'keys.apiKey': 'API key',
    'keys.label': 'Label',
    'keys.addKey': 'Add key',
    'keys.adding': 'Adding…',
    'keys.enable': 'Enable',
    'keys.addModel': 'Add model',
    'keys.noKeyNeeded': 'No API key needed: this provider\'s free tier is anonymous (rate-limited per IP).',
    'keys.noProviderKeys': 'No provider keys yet. Add one above to start routing.',
    'keys.configuredProviders': 'Configured providers',
    'keys.proxy': 'proxy',
    'keys.keys': 'keys',
    'keys.key': 'key',
    'keys.cantReachServer': "Can't reach the server on <code class=\"font-mono\">{base}</code>. Make sure the backend is running. <code class=\"font-mono\">npm run dev</code> starts both, and the server logs print under the <code class=\"font-mono\">server</code> prefix.",
    'keys.couldNotLoadProxySettings': 'Could not load proxy settings.',
    'keys.apiKeyPlaceholder': 'paste key here',
    'keys.bearerTokenPlaceholder': 'Bearer token',
    'keys.getApiKey': 'Get API key',

    // Key status labels
    'status.healthy': 'healthy',
    'status.rateLimited': 'rate-limited',
    'status.invalid': 'invalid',
    'status.error': 'error',
    'status.unknown': 'unchecked',

    // Custom provider
    'custom.title': 'Add a custom OpenAI-compatible model',
    'custom.description': 'Point at any OpenAI-compatible endpoint: llama.cpp, LM Studio, vLLM, a local Ollama, or a remote gateway. Add each model you want routed; they all share the one endpoint. The API key is optional (most local servers don\'t need one).',
    'custom.baseUrl': 'Base URL',
    'custom.model': 'Model',
    'custom.displayName': 'Display name',

    // Proxy settings
    'proxy.title': 'Outbound proxy',
    'proxy.description': 'Route outbound LLM requests through a proxy. Supports SOCKS5, HTTP, and HTTPS.',
    'proxy.active': 'Active',
    'proxy.proxyUrl': 'Proxy URL',
    'proxy.urlConfigTip': 'Also configurable via the <code class="font-mono">PROXY_URL</code> environment variable (takes precedence). Leave blank to disable.',

    // Analytics page
    'analytics.title': 'Analytics',
    'analytics.description': 'Request volume, latency, token usage, and failures.',
    'analytics.requests': 'Requests',
    'analytics.successRate': 'Success rate',
    'analytics.inputTokens': 'Input tokens',
    'analytics.outputTokens': 'Output tokens',
    'analytics.avgLatency': 'Avg latency',
    'analytics.estSavings': 'Est. savings',
    'analytics.requestsByProvider': 'Requests by provider',
    'analytics.avgLatencyByProvider': 'Avg latency by provider',
    'analytics.requestsOverTime': 'Requests over time',
    'analytics.perModelBreakdown': 'Per-model breakdown',
    'analytics.errorsByProvider': 'Errors by provider',
    'analytics.recentErrors': 'Recent errors',
    'analytics.success': 'Success',
    'analytics.failures': 'Failures',
    'analytics.latencyMs': 'Latency (ms)',
    'analytics.provider': 'Provider',
    'analytics.message': 'Message',
    'analytics.time': 'Time',
    'analytics.pinned': 'Pinned',
    'analytics.inTokens': 'In tokens',
    'analytics.outTokens': 'Out tokens',
    'analytics.saved': 'Saved',
	    'analytics.latency': 'Latency',
    'analytics.range24h': '24 hours',
	    'analytics.range7d': '7 days',
	    'analytics.range30d': '30 days',
	    'analytics.hours': '{n} hours',
	    'analytics.days': '{n} days',
	    'analytics.savingsHint': 'You actually saved ${actualSavings} over the last {rangeLabel}. That is what the same tokens would have cost on paid APIs, priced per model.',
	    'analytics.savingsHintExtrapolated': 'The number shown projects your pace from the last {spanLabel} of data to a full 30 days.',
	    'analytics.savingsHintReal': 'The number shown is your real 30-day total.',
	    'analytics.requestsHintPinned': '{pinned} of these requests pinned a specific model by name. {pinHonored} were served by the pinned model; {failover} failed over to a different one. The rest were auto-routed.',
	    'analytics.requestsHintAuto': 'All requests in this period were auto-routed; no client pinned a specific model by name.',

	    // Embeddings page
    'embeddings.description': 'Embeddings fail over within a family only: the same model served by another provider. Vectors from different models are incompatible, so the router never swaps models on you.',
    'embeddings.defaultAuto': 'Default · auto',
    'embeddings.makeDefault': 'Make default',
    'embeddings.noKey': 'no key',
    'embeddings.reqToday': 'req today',
    'embeddings.tokThisMonth': 'tok this month',

    // Premium page
    'premium.title': 'Premium',
    'premium.description': 'The live model catalog, on every device.',
    'premium.catalogFeed': 'Catalog feed',
    'premium.liveFeed': 'Live feed',
    'premium.lastChecked': 'Last checked',
    'premium.catalogDescription': 'New free models, quota changes, and quirk fixes land here within hours of being shipped. The app checks automatically twice a day; nothing to do.',
    'premium.license': 'License',
    'premium.licenseActive': 'License key is active. The catalog is always served as the live tier.',
    'premium.removeKey': 'Remove key from this device',
    'premium.removeKeyDescription': 'Removing the key only deactivates this device; your purchase is untouched.',
    'premium.enterLicenseKey': 'Enter your license key to activate. The catalog is always served as the live tier.',
    'premium.licenseKeyPlaceholder': 'fla_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    'premium.activate': 'Activate',
    'premium.activating': 'Activating…',
    'premium.checkForUpdates': 'Check for updates',
    'premium.syncing': 'Syncing…',
    'premium.syncProblem': 'Last sync problem',
    'premium.bundled': 'bundled',

    // Auth gate
    'auth.createAccount': 'Create your account',
    'auth.createAccountDesc': 'Set the email and password that will protect this dashboard.',
    'auth.signIn': 'Sign in',
    'auth.signInDesc': 'Sign in to manage your keys, routing, and analytics.',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.passwordPlaceholderSetup': 'at least 8 characters',
    'auth.passwordPlaceholderLogin': 'your password',
    'auth.creating': 'Creating…',
    'auth.signingIn': 'Signing in…',
    'auth.createAccountBtn': 'Create account',
    'auth.signInBtn': 'Sign in',
    'auth.cantReachServer': "Can't reach the server. Make sure the backend is running (<code class=\"font-mono\">npm run dev</code>).",

    // Models tabs
    'models.chatModels': 'Chat models',
    'models.embeddings': 'Embeddings',

    // Embeddings page
    'embeddings.title': 'Models',
    'embeddings.modelAutoDescription': '<code class=\"rounded-md bg-muted px-1.5 py-0.5 font-mono\">model: "auto"</code> on <code class=\"rounded-md bg-muted px-1.5 py-0.5 font-mono\">POST /v1/embeddings</code> routes to the default family. Naming a family (or a provider model id) pins that family; providers inside it are tried in order.',
    'embeddings.tokMax': 'tok max',
    'embeddings.dimensions': 'd',
  },
  zh: {
    // Navigation
    'nav.models': '模型',
    'nav.playground': '调试台',
    'nav.keys': '密钥',
    'nav.analytics': '统计分析',
    'nav.premium': '高级版',
    'nav.signOut': '退出登录',
    'nav.theme': '主题',

    // Common
    'common.loading': '加载中…',
    'common.save': '保存',
    'common.discard': '丢弃',
    'common.unsavedChanges': '未保存的更改',
    'common.saveChanges': '保存更改',
    'common.saving': '保存中…',
    'common.apply': '应用',
    'common.applying': '应用中…',
    'common.applied': '已应用',
    'common.check': '检查',
    'common.checking': '检查中…',
    'common.checkAll': '全部检查',
    'common.remove': '删除',
    'common.optional': '可选',
    'common.noDataYet': '暂无数据',
    'common.noErrors': '无错误',
    'common.on': '启用',

    // Models / Fallback page
    'models.title': '模型',
    'models.description': '选择路由策略。手动模式下拖拽设置顺序；其他策略根据可靠性、速度和智能的实时评分进行路由。',
    'models.routingStrategy': '路由策略',
    'models.manualMode': '手动模式：请求按照下方从上到下的顺序执行。拖拽可重新排序。',
    'models.autoMode': '评分根据实时流量更新。下方的顺序即为当前请求的路由顺序。',
    'models.monthlyTokenBudget': '月度 Token 预算',
    'models.remaining': '剩余',
    'models.noModelsAvailable': '暂无可用模型。请先在<a href="/keys" class="underline text-foreground">密钥页面</a>添加 API 密钥。',
    'models.hiddenNoKeys': '隐藏（无密钥）',
    'models.showAll': '显示全部',
    'models.models': '个模型',
    'models.showLess': '收起',
    'models.unsavedChanges': '未保存的更改',
    'models.saveChanges': '保存更改',

    // Strategy labels
    'strategy.manual': '手动',
    'strategy.manualBlurb': '按照您设置的精确顺序进行路由。拖拽手柄可重新排序。无评分机制；链式从上到下依次执行。',
    'strategy.balanced': '均衡',
    'strategy.balancedBlurb': '可靠性优先（50%），速度和智能各占 25%。适合大多数场景的默认选择。',
    'strategy.smartest': '最智能',
    'strategy.smartestBlurb': '优先选择能力最强且可用的模型。智能 55%，可靠性 35%，速度 10%。',
    'strategy.fastest': '最快',
    'strategy.fastestBlurb': '优先选择最快且可用的模型。速度 55%，可靠性 35%，智能 10%。',
    'strategy.mostReliable': '最可靠',
    'strategy.mostReliableBlurb': '最大化成功率。可靠性 70%，速度和智能各 15%。',
    'strategy.custom': '自定义',
    'strategy.customBlurb': '使用滑块自定义可靠性、速度和智能的权重平衡。引擎与预设相同，只是使用您自己的权重。',

    // Table headers
    'table.model': '模型',
    'table.reliability': '可靠性',
    'table.speed': '速度',
    'table.intelligence': '智能',
    'table.guardrails': '护栏',
    'table.guardrailsTip': '始终启用的护栏：免费配额余量 × 实时限流惩罚。低于 1.0 表示该模型受到限制。',
    'table.score': '评分',
    'table.scoreTip': '最终路由评分 = 三个维度的加权平均值 × 护栏。评分越高越优先路由。',
    'table.vision': '视觉',
    'table.visionTip': '支持图片输入',
    'table.tools': '工具',
    'table.toolsTip': '支持结构化工具调用，可用于工具类请求',
    'table.penalty': '惩罚',
    'table.observations': '次',

    // Custom weights
    'weights.title': '自定义权重',
    'weights.description': '滑块相互独立；占比自动平衡到 100%。',
    'weights.reliability': '可靠性',
    'weights.speed': '速度',
    'weights.intelligence': '智能',
    'weights.minWeightWarning': '至少需要一个权重大于零。',

    // Playground page
    'playground.title': '调试台',
    'playground.description': '通过路由器发送聊天补全请求，查看由哪个提供商服务。',
    'playground.autoModel': '自动（回退链）',
    'playground.sendMessage': '发送消息开始对话。',
    'playground.usingModel': '当前使用',
    'playground.switchModels': '在上方选择器中切换模型。',
    'playground.placeholder': '输入消息…（⏎ 发送，⇧⏎ 换行）',
    'playground.send': '发送',
    'playground.sending': '发送中…',
    'playground.clear': '清空',

    // Keys page
    'keys.title': '密钥',
    'keys.description': '提供商凭证和应用连接使用的统一 API 密钥。',
    'keys.unifiedApiKey': '您的统一 API 密钥',
    'keys.unifiedKeyDescription': '将此密钥用作您的 OpenAI <code class="font-mono">api_key</code>；它用于验证对本代理的请求。',
    'keys.regenerate': '重新生成',
    'keys.show': '显示',
    'keys.hide': '隐藏',
    'keys.copy': '复制',
    'keys.copied': '已复制',
    'keys.baseUrl': '基础 URL',
    'keys.chat': '聊天',
    'keys.responses': '响应',
    'keys.embeddings': '嵌入',
    'keys.addProviderKey': '添加提供商密钥',
    'keys.platform': '平台',
    'keys.selectProvider': '选择提供商',
    'keys.accountId': '账户 ID',
    'keys.apiToken': 'API Token',
    'keys.apiKey': 'API 密钥',
    'keys.label': '标签',
    'keys.addKey': '添加密钥',
    'keys.adding': '添加中…',
    'keys.enable': '启用',
    'keys.addModel': '添加模型',
    'keys.noKeyNeeded': '无需 API 密钥：此提供商的免费层级是匿名的（按 IP 限流）。',
    'keys.noProviderKeys': '暂无提供商密钥。请在上方添加以开始路由。',
    'keys.configuredProviders': '已配置的提供商',
    'keys.proxy': '代理',
    'keys.keys': '个密钥',
    'keys.key': '个密钥',
    'keys.cantReachServer': '无法连接到服务器 <code class="font-mono">{base}</code>。请确保后端正在运行。<code class="font-mono">npm run dev</code> 会同时启动前后端，服务器日志显示在 <code class="font-mono">server</code> 前缀下。',
    'keys.couldNotLoadProxySettings': '无法加载代理设置。',
    'keys.apiKeyPlaceholder': '粘贴密钥',
    'keys.bearerTokenPlaceholder': 'Bearer Token',
    'keys.getApiKey': '获取 API Key',

    // Key status labels
    'status.healthy': '正常',
    'status.rateLimited': '被限流',
    'status.invalid': '无效',
    'status.error': '错误',
    'status.unknown': '未检查',

    // Custom provider
    'custom.title': '添加自定义 OpenAI 兼容模型',
    'custom.description': '指向任何 OpenAI 兼容的端点：llama.cpp、LM Studio、vLLM、本地 Ollama 或远程网关。添加您需要路由的每个模型；它们共享同一端点。API 密钥是可选的（大多数本地服务器不需要）。',
    'custom.baseUrl': '基础 URL',
    'custom.model': '模型',
    'custom.displayName': '显示名称',

    // Proxy settings
    'proxy.title': '出站代理',
    'proxy.description': '通过代理路由出站 LLM 请求。支持 SOCKS5、HTTP 和 HTTPS。',
    'proxy.active': '已激活',
    'proxy.proxyUrl': '代理 URL',
    'proxy.urlConfigTip': '也可以通过 <code class="font-mono">PROXY_URL</code> 环境变量配置（优先级更高）。留空以禁用。',

    // Analytics page
    'analytics.title': '统计分析',
    'analytics.description': '请求量、延迟、Token 用量和失败情况。',
    'analytics.requests': '请求数',
    'analytics.successRate': '成功率',
    'analytics.inputTokens': '输入 Token',
    'analytics.outputTokens': '输出 Token',
    'analytics.avgLatency': '平均延迟',
    'analytics.estSavings': '预估节省',
    'analytics.requestsByProvider': '各提供商请求量',
    'analytics.avgLatencyByProvider': '各提供商平均延迟',
    'analytics.requestsOverTime': '请求趋势',
    'analytics.perModelBreakdown': '各模型明细',
    'analytics.errorsByProvider': '各提供商错误',
    'analytics.recentErrors': '最近错误',
    'analytics.success': '成功',
    'analytics.failures': '失败',
    'analytics.latencyMs': '延迟（毫秒）',
    'analytics.provider': '提供商',
    'analytics.message': '消息',
    'analytics.time': '时间',
    'analytics.pinned': '固定',
    'analytics.inTokens': '输入 Token',
    'analytics.outTokens': '输出 Token',
    'analytics.saved': '节省',
	    'analytics.latency': '延迟',
    'analytics.range24h': '24 小时',
	    'analytics.range7d': '7 天',
	    'analytics.range30d': '30 天',
	    'analytics.hours': '{n} 小时',
	    'analytics.days': '{n} 天',
	    'analytics.savingsHint': '在过去 {rangeLabel} 实际为您节省了 ${actualSavings}。这是相同 Token 量按各模型付费 API 定价计算的费用。',
	    'analytics.savingsHintExtrapolated': '显示的数字是根据最近 {spanLabel} 数据推算的完整 30 天预估。',
	    'analytics.savingsHintReal': '显示的数字是您真实的 30 天总计。',
	    'analytics.requestsHintPinned': '其中 {pinned} 个请求指定了具体模型名称。{pinHonored} 个由固定模型服务；{failover} 个回退到其他模型。其余为自动路由。',
	    'analytics.requestsHintAuto': '此时间段内所有请求均为自动路由；没有客户端指定具体模型名称。',

	    // Embeddings page
    'embeddings.description': '嵌入仅在同一系列内回退：同一模型由其他提供商服务。不同模型的向量不兼容，因此路由器不会更换模型。',
    'embeddings.defaultAuto': '默认 · 自动',
    'embeddings.makeDefault': '设为默认',
    'embeddings.noKey': '无密钥',
    'embeddings.reqToday': '今日请求',
    'embeddings.tokThisMonth': '本月 Token',

    // Premium page
    'premium.title': '高级版',
    'premium.description': '实时模型目录，覆盖所有设备。',
    'premium.catalogFeed': '目录更新源',
    'premium.liveFeed': '实时更新',
    'premium.lastChecked': '上次检查',
    'premium.catalogDescription': '新免费模型、配额变更和修复会在上线后数小时内更新。应用每天自动检查两次，无需操作。',
    'premium.license': '许可证',
    'premium.licenseActive': '许可证密钥已激活。目录始终提供实时版本。',
    'premium.removeKey': '从此设备移除密钥',
    'premium.removeKeyDescription': '移除密钥仅会停用此设备；您的购买不受影响。',
    'premium.enterLicenseKey': '输入您的许可证密钥以激活。目录始终提供实时版本。',
    'premium.licenseKeyPlaceholder': 'fla_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    'premium.activate': '激活',
    'premium.activating': '激活中…',
    'premium.checkForUpdates': '检查更新',
    'premium.syncing': '同步中…',
    'premium.syncProblem': '上次同步问题',
    'premium.bundled': '内置',

    // Auth gate
    'auth.createAccount': '创建账户',
    'auth.createAccountDesc': '设置用于保护此仪表板的邮箱和密码。',
    'auth.signIn': '登录',
    'auth.signInDesc': '登录以管理您的密钥、路由和分析数据。',
    'auth.email': '邮箱',
    'auth.password': '密码',
    'auth.passwordPlaceholderSetup': '至少 8 个字符',
    'auth.passwordPlaceholderLogin': '您的密码',
    'auth.creating': '创建中…',
    'auth.signingIn': '登录中…',
    'auth.createAccountBtn': '创建账户',
    'auth.signInBtn': '登录',
    'auth.cantReachServer': '无法连接到服务器。请确保后端正在运行（<code class="font-mono">npm run dev</code>）。',

    // Models tabs
    'models.chatModels': '聊天模型',
    'models.embeddings': '嵌入模型',

    // Embeddings page
    'embeddings.title': '模型',
    'embeddings.modelAutoDescription': '在 <code class="rounded-md bg-muted px-1.5 py-0.5 font-mono">POST /v1/embeddings</code> 中使用 <code class="rounded-md bg-muted px-1.5 py-0.5 font-mono">model: "auto"</code> 将路由到默认系列。指定系列（或提供商模型 ID）将固定该系列；其中的提供商按顺序尝试。',
    'embeddings.tokMax': '最大 Token',
    'embeddings.dimensions': '维',
  },
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, replacements?: Record<string, string>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const LOCALE_KEY = 'freellmapi_locale'

function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'zh'
  const stored = localStorage.getItem(LOCALE_KEY)
  if (stored === 'en' || stored === 'zh') return stored
  // Default to Chinese for zh-CN users
  const browserLang = navigator.language || navigator.languages?.[0] || ''
  return browserLang.startsWith('zh') ? 'zh' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale)

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
    localStorage.setItem(LOCALE_KEY, newLocale)
  }, [])

  const t = useCallback((key: string, replacements?: Record<string, string>): string => {
    let text = translations[locale][key] ?? key
    if (replacements) {
      for (const [k, v] of Object.entries(replacements)) {
        text = text.replaceAll(`{${k}}`, v)
      }
    }
    return text
  }, [locale])

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
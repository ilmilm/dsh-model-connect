/**
 * Host half of the Model Connect bundle.
 *
 * The browser half cannot reach `llm`, `settings` or `credentials` (the Client
 * Remote assembly does not mount the LLM namespace), so every privileged
 * operation lives here and is reached over one loopback-fenced route family:
 *
 *   GET  /model-connect/api/state   current routes, their models and key state
 *   POST /model-connect/api/probe   interrogate a draft endpoint for its models
 *   POST /model-connect/api/save    upsert one provider route (+ its API key)
 *   POST /model-connect/api/remove  drop one provider route (+ its API key)
 *
 * Writes go through the settings seam on the `llm-pi-ai` profile entry, which
 * is exactly what the shipped Models settings page does: `providers` is a
 * volatile field, the key itself never enters `cordis.patch.yml`, and the
 * profile records only the credential reference (`<ROUTE>_API_KEY`).
 */

/** Services this plugin needs before it can serve anything. */
export const inject = ['webServer']

/** Route family prefix. */
const BASE = '/model-connect/api'

/** Accepted pi-ai protocols. */
const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']

/** Reasoning levels the pi-ai model schema accepts, ascending. */
const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Input modalities a model entry may declare. */
const MODALITIES = ['text', 'image']

/** Route-level capability defaults written into every saved model. */
const DEFAULT_CONTEXT_WINDOW = '1M'
const DEFAULT_MAX_TOKENS = '128K'
const DEFAULT_INPUT = ['text', 'image']
const DEFAULT_REASONING_LEVEL = 'high'

/** Fallback settings namespace when the provider directory is empty. */
const FALLBACK_NS = 'llm-pi-ai'

/** Provider id accepted by the settings key grammar. */
const ROUTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * Whether a request comes from this machine over a loopback authority with
 * browser same-origin markers (the shared fence used by the other host route
 * families; X-Forwarded-For is never trusted).
 * @param request - the incoming request.
 * @returns true when the request is trusted.
 */
function isLoopbackRequest(request) {
  const address = request.socket && request.socket.remoteAddress
  if (typeof address !== 'string') return false
  const normalized = address.toLowerCase()
  const v4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized
  const loopback = v4 === '::1' || (() => {
    const parts = v4.split('.')
    return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  })()
  if (!loopback) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (!(hostUrl.hostname === 'localhost' || hostUrl.hostname === '[::1]' || /^127\./.test(hostUrl.hostname))) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * Read one bounded JSON body.
 * @param request - the incoming request.
 * @param maxBytes - body cap.
 * @returns the parsed value, or null when the body is absent or not JSON.
 */
async function readJsonBody(request, maxBytes = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      request.destroy()
      return null
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Write one JSON response.
 * @param response - the server response.
 * @param status - HTTP status.
 * @param body - JSON payload.
 */
function writeJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

/**
 * Derive the credential reference a free-standing provider route uses.
 * @param route - provider id.
 * @returns the `<ROUTE>_API_KEY` reference name.
 */
function credentialRefOf(route) {
  return route.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY'
}

/**
 * Resolve the settings namespace that owns pi-ai provider profiles.
 *
 * The provider directory alone is not enough: it also lists routes owned by
 * other adapters (the DeepSeek account/API-key entries declare their own
 * namespaces), so the `providers` object in the namespace schema is the fact
 * that identifies pi-ai. Directory entries and stored provider maps are the
 * fallbacks for a composition whose schemas are not projected.
 * @param llm - the LLM service (optional).
 * @param settings - the settings service (optional).
 * @returns the namespace key.
 */
function resolveNamespace(llm, settings) {
  let descriptors = []
  try {
    descriptors = typeof settings?.describe === 'function' ? settings.describe() ?? [] : []
  } catch {
    descriptors = []
  }
  for (const descriptor of descriptors) {
    const properties = descriptor?.schema && typeof descriptor.schema === 'object' ? descriptor.schema.properties : undefined
    if (properties && typeof properties === 'object' && Object.prototype.hasOwnProperty.call(properties, 'providers')) {
      return descriptor.ns
    }
  }
  for (const descriptor of descriptors) {
    try {
      if (JSON.stringify(descriptor?.schema ?? {}).includes('"providers"')) return descriptor.ns
    } catch { /* one unreadable schema must not hide the rest */ }
  }
  let directory = []
  try {
    directory = typeof llm?.listConfigurableProviders === 'function' ? llm.listConfigurableProviders() ?? [] : []
  } catch {
    directory = []
  }
  for (const entry of directory) {
    if (entry && typeof entry.settingsNs === 'string' && entry.settingsNs !== '') {
      const { providers } = readSection(settings, entry.settingsNs)
      if (Object.keys(providers).length > 0) return entry.settingsNs
    }
  }
  for (const entry of directory) {
    if (entry && typeof entry.settingsNs === 'string' && entry.settingsNs !== '') return entry.settingsNs
  }
  return FALLBACK_NS
}

/**
 * Read the redaction-free provider section of one namespace.
 * @param settings - the settings service.
 * @param ns - namespace key.
 * @returns the descriptor (or undefined) and its `providers` map.
 */
function readSection(settings, ns) {
  try {
    const descriptors = settings.describe() ?? []
    const descriptor = descriptors.find(item => item && item.ns === ns)
    const value = descriptor && typeof descriptor.value === 'object' && descriptor.value !== null ? descriptor.value : {}
    const providers = value.providers && typeof value.providers === 'object' && !Array.isArray(value.providers) ? value.providers : {}
    return { descriptor, providers }
  } catch {
    return { descriptor: undefined, providers: {} }
  }
}

/**
 * Build the state payload the panel renders.
 * @param llm - the LLM service.
 * @param settings - the settings service.
 * @param credentials - the credential service.
 * @returns the JSON state.
 */
async function buildState(llm, settings, credentials) {
  const ns = resolveNamespace(llm, settings)
  const { providers } = readSection(settings, ns)
  const registered = new Set()
  try {
    for (const info of llm?.listProviders?.() ?? []) {
      if (info && typeof info.id === 'string') registered.add(info.id)
    }
  } catch { /* registry unavailable: every route reads as unregistered */ }

  const rows = []
  for (const [route, profile] of Object.entries(providers)) {
    const raw = profile && typeof profile === 'object' ? profile : {}
    const ref = typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv !== '' ? raw.apiKeyEnv : credentialRefOf(route)
    let keyConfigured = false
    try {
      if (typeof credentials?.describe === 'function') {
        const info = await credentials.describe(ref)
        keyConfigured = info?.configured === true
      }
    } catch { /* unreadable credential: report unknown as false */ }
    const models = Array.isArray(raw.models) ? raw.models : []
    rows.push({
      route,
      displayName: typeof raw.displayName === 'string' && raw.displayName !== '' ? raw.displayName : route,
      baseURL: typeof raw.baseURL === 'string' ? raw.baseURL : '',
      api: typeof raw.api === 'string' ? raw.api : 'openai-completions',
      apiKeyEnv: ref,
      keyConfigured,
      registered: registered.has(route),
      models: models
        .filter(model => model && typeof model.id === 'string' && model.id !== '')
        .map(model => ({
          id: model.id,
          name: typeof model.name === 'string' ? model.name : model.id,
          contextWindow: Number.isSafeInteger(model.contextWindow) ? model.contextWindow : undefined,
          maxTokens: Number.isSafeInteger(model.maxTokens) ? model.maxTokens : undefined,
          input: Array.isArray(model.input) ? model.input.filter(item => MODALITIES.includes(item)) : undefined,
          reasoningLevels: model.reasoningEfforts && typeof model.reasoningEfforts === 'object'
            ? Object.keys(model.reasoningEfforts)
            : undefined,
        })),
    })
  }
  rows.sort((a, b) => a.route.localeCompare(b.route))
  let namespaces = []
  try {
    namespaces = (settings.describe() ?? []).map(descriptor => String(descriptor.ns))
  } catch { /* diagnostic only */ }
  return { ns, namespaces, protocols: PROTOCOLS, providers: rows }
}

/**
 * Parse one capacity value (`1M`, `128K`, `200000`, or a plain number).
 *
 * `K` and `M` are decimal on purpose: that is what the shipped Models page
 * means by them, so a value typed here and a value typed there agree.
 * @param value - candidate capacity.
 * @returns the token count, or undefined when the value is unusable.
 */
function toCapacity(value) {
  const text = typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim().toUpperCase().replace(/[\s_]/g, '')
      : ''
  if (text === '') return undefined
  const match = /^([0-9]+(?:\.[0-9]+)?)([KM])?$/.exec(text)
  if (match === null) return undefined
  const factor = match[2] === 'K' ? 1000 : match[2] === 'M' ? 1000000 : 1
  const total = Math.round(Number(match[1]) * factor)
  return Number.isSafeInteger(total) && total > 0 && total <= 10000000 ? total : undefined
}

/**
 * Validate and normalize one save request.
 * @param body - the request body.
 * @returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
function normalizeSave(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: '请求体不是 JSON 对象' }
  const route = typeof body.route === 'string' ? body.route.trim() : ''
  if (!ROUTE_RE.test(route)) return { ok: false, error: '提供方 ID 只能包含字母、数字、点、下划线和连字符，且以字母或数字开头' }
  const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim() : ''
  let parsed
  try {
    parsed = new URL(baseURL)
  } catch {
    return { ok: false, error: '接口地址不是合法的 URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: '接口地址必须是 http(s)' }
  const api = typeof body.api === 'string' && PROTOCOLS.includes(body.api) ? body.api : PROTOCOLS[0]
  const displayName = typeof body.displayName === 'string' && body.displayName.trim() !== '' ? body.displayName.trim() : route
  const models = Array.isArray(body.models)
    ? [...new Set(body.models.filter(id => typeof id === 'string' && id.trim() !== '').map(id => id.trim()))]
    : []
  if (models.length === 0) return { ok: false, error: '至少需要一个模型 ID' }
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (apiKey !== '' && !/^[\x21-\x7E]+$/.test(apiKey)) return { ok: false, error: 'API Key 只能包含可见 ASCII 字符' }
  const contextWindow = toCapacity(body.contextWindow === undefined || body.contextWindow === '' ? DEFAULT_CONTEXT_WINDOW : body.contextWindow)
  if (contextWindow === undefined) return { ok: false, error: '上下文窗口需形如 1M / 256K / 200000（上限 10M）' }
  const maxTokens = toCapacity(body.maxTokens === undefined || body.maxTokens === '' ? DEFAULT_MAX_TOKENS : body.maxTokens)
  if (maxTokens === undefined) return { ok: false, error: '最大输出需形如 128K / 32000（上限 10M）' }
  const requested = Array.isArray(body.input) ? body.input.filter(item => MODALITIES.includes(item)) : DEFAULT_INPUT
  const input = [...new Set(requested)]
  if (input.length === 0) return { ok: false, error: '至少保留一种输入模态（text / image）' }
  const reasoningLevel = typeof body.reasoningLevel === 'string' ? body.reasoningLevel : DEFAULT_REASONING_LEVEL
  if (reasoningLevel !== 'off' && !REASONING_LEVELS.includes(reasoningLevel)) {
    return { ok: false, error: `推理强度只能是 ${REASONING_LEVELS.join(' / ')}` }
  }
  return {
    ok: true,
    value: { route, baseURL, api, displayName, models, apiKey, contextWindow, maxTokens, input, reasoningLevel },
  }
}

/**
 * Register the route family.
 * @param ctx - the host plugin context.
 */
export function apply(ctx) {
  const llmOf = () => ctx.get('llm')
  const settingsOf = () => ctx.get('settings')
  const credentialsOf = () => ctx.get('credentials')

  /**
   * Wrap one handler with the loopback fence and uniform error reporting.
   * @param method - required HTTP method.
   * @param handler - handler receiving `(url, body)`.
   * @returns a web route handler.
   */
  const guarded = (method, handler) => async (request, response) => {
    if (!isLoopbackRequest(request)) {
      writeJson(response, 403, { error: 'forbidden: loopback-only' })
      return
    }
    if ((request.method ?? 'GET') !== method) {
      writeJson(response, 405, { error: `method not allowed: ${request.method}` })
      return
    }
    let body = null
    if (method !== 'GET') {
      body = await readJsonBody(request)
      if (body === null) {
        writeJson(response, 400, { error: '请求体缺失或不是合法 JSON' })
        return
      }
    }
    try {
      const result = await handler(new URL(request.url ?? '/', 'http://localhost'), body)
      writeJson(response, result.status ?? 200, result.body)
    } catch (error) {
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const routes = [
    {
      kind: 'exact',
      path: `${BASE}/state`,
      handler: guarded('GET', async () => {
        const settings = settingsOf()
        if (settings === undefined) throw new Error('settings 服务不可用')
        return { body: await buildState(llmOf(), settings, credentialsOf()) }
      }),
    },
    {
      kind: 'exact',
      path: `${BASE}/probe`,
      handler: guarded('POST', async (_url, body) => {
        const llm = llmOf()
        if (llm === undefined) throw new Error('llm 服务不可用')
        const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim() : ''
        const api = typeof body.api === 'string' && PROTOCOLS.includes(body.api) ? body.api : PROTOCOLS[0]
        const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey.trim() : undefined
        const provider = typeof body.provider === 'string' && ROUTE_RE.test(body.provider.trim()) ? body.provider.trim() : ''
        if (baseURL === '' && provider === '') return { status: 400, body: { error: '请先填写接口地址' } }
        const settings = settingsOf()
        const ns = resolveNamespace(llm, settings)
        if (provider !== '' && apiKey === undefined) {
          // A blank key on an existing route means reuse the saved one: the
          // adapter resolves that route's credential reference itself once it
          // is told which route the draft edits, so only a route with no
          // stored secret fails — and it fails before any network call.
          const { providers } = readSection(settings, ns)
          const stored = providers[provider] && typeof providers[provider] === 'object' ? providers[provider] : {}
          const ref = typeof stored.apiKeyEnv === 'string' && stored.apiKeyEnv !== '' ? stored.apiKeyEnv : credentialRefOf(provider)
          let configured = false
          try {
            const credentials = credentialsOf()
            if (typeof credentials?.describe === 'function') configured = (await credentials.describe(ref))?.configured === true
          } catch { /* unreadable credential: report it as missing */ }
          if (!configured) {
            return { status: 400, body: { error: '路由「' + provider + '」没有已保存的 Key（' + ref + '），请填写 API Key 后重试' } }
          }
        }
        const request = {
          api,
          ...(baseURL === '' ? {} : { baseURL }),
          ...(provider === '' ? {} : { provider }),
          ...(apiKey === undefined ? {} : { apiKey }),
        }
        const models = await llm.discoverModels(ns, request, AbortSignal.timeout(30000))
        return {
          body: {
            models: (models ?? []).map(model => ({
              id: model.id,
              name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
            })),
          },
        }
      }),
    },
    {
      kind: 'exact',
      path: `${BASE}/save`,
      handler: guarded('POST', async (_url, body) => {
        const settings = settingsOf()
        if (settings === undefined) throw new Error('settings 服务不可用')
        const check = normalizeSave(body)
        if (!check.ok) return { status: 400, body: { error: check.error } }
        const { route, baseURL, api, displayName, models, apiKey, contextWindow, maxTokens, input, reasoningLevel } = check.value
        const ns = resolveNamespace(llmOf(), settings)
        const { providers } = readSection(settings, ns)
        const previous = providers[route] && typeof providers[route] === 'object' ? providers[route] : {}
        const previousModels = Array.isArray(previous.models) ? previous.models : []
        const mergedModels = models.map(id => {
          const kept = previousModels.find(model => model && model.id === id)
          const base = kept && typeof kept === 'object' ? { ...kept } : {}
          const entry = {
            ...base,
            id,
            name: typeof base.name === 'string' && base.name !== '' ? base.name : id,
            contextWindow,
            maxTokens,
            input: [...input],
          }
          if (reasoningLevel === 'off') delete entry.reasoningEfforts
          else entry.reasoningEfforts = { [reasoningLevel]: reasoningLevel }
          return entry
        })
        const ref = typeof previous.apiKeyEnv === 'string' && previous.apiKeyEnv !== '' ? previous.apiKeyEnv : credentialRefOf(route)
        const next = {
          ...previous,
          displayName,
          baseURL,
          api,
          apiKeyEnv: ref,
          models: mergedModels,
        }
        await settings.mutate(ns, [{ op: 'set', path: ['providers', route], value: next }])
        if (apiKey !== '') {
          const credentials = credentialsOf()
          if (credentials === undefined) throw new Error('凭据已写入配置，但 credentials 服务不可用，API Key 未能保存')
          await credentials.set(ref, apiKey)
        }
        return { body: { ok: true, route, ns, apiKeyEnv: ref, ...(await buildState(llmOf(), settings, credentialsOf())) } }
      }),
    },
    {
      kind: 'exact',
      path: `${BASE}/remove`,
      handler: guarded('POST', async (_url, body) => {
        const settings = settingsOf()
        if (settings === undefined) throw new Error('settings 服务不可用')
        const route = typeof body.route === 'string' ? body.route.trim() : ''
        if (!ROUTE_RE.test(route)) return { status: 400, body: { error: '提供方 ID 非法' } }
        const ns = resolveNamespace(llmOf(), settings)
        const { providers } = readSection(settings, ns)
        const previous = providers[route]
        const ref = previous && typeof previous.apiKeyEnv === 'string' && previous.apiKeyEnv !== ''
          ? previous.apiKeyEnv
          : credentialRefOf(route)
        await settings.mutate(ns, [{ op: 'unset', path: ['providers', route] }])
        if (body.removeKey === true) {
          try {
            await credentialsOf()?.unset?.(ref)
          } catch { /* removing an absent reference is a no-op; report the route removal */ }
        }
        return { body: { ok: true, route, ...(await buildState(llmOf(), settings, credentialsOf())) } }
      }),
    },
  ]

  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch { /* already released */ }
      }
    }
  }, 'model-connect: routes')
}

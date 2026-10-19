/**
 * Browser half of the Model Connect bundle.
 *
 * One sidebar row (`sidebar.panellist`, id `model-connect`) plus its page in
 * the layout's keyed `main` slot — the same shell-owned pattern the shipped
 * Plugins / Schedule / SSH rows use. The page talks to this package's own host
 * routes (see `index.js`); it never touches the Client Remote assembly, which
 * does not mount the LLM namespace.
 *
 * Plain JavaScript on purpose: no JSX, no build step. React comes from the
 * browser module table.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-model-connect',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    /** Shared panel id: the sidebar row id and the main-slot key. */
    const PANEL_ID = 'model-connect'
    /** Host route family prefix (relative, so a proxy prefix survives). */
    const API_BASE = 'model-connect/api'

    /** Protocols the pi-ai adapter accepts, with the endpoint shape each implies. */
    const PROTOCOLS = [
      { value: 'openai-completions', label: 'OpenAI Chat Completions · /chat/completions' },
      { value: 'openai-responses', label: 'OpenAI Responses · /responses' },
      { value: 'anthropic-messages', label: 'Anthropic Messages · /v1/messages' },
    ]

    const COLOR = {
      bg: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    /** Client locale face, resolved lazily (absent in some Client assemblies). */
    let localeFace
    let subscribed = false
    const listeners = new Set()

    /**
     * Read the active language from the Client locale service.
     * @returns true for a Chinese locale.
     */
    function isZh() {
      try {
        const snapshot = localeFace?.getLocale?.() ?? localeFace?.getSnapshot?.()
        const id = snapshot?.id ?? snapshot?.locale
        if (typeof id === 'string' && id !== '') return id.toLowerCase().startsWith('zh')
      } catch { /* fall through */ }
      try {
        const lang = document.documentElement.getAttribute('lang')
        if (typeof lang === 'string' && lang !== '') return lang.toLowerCase().startsWith('zh')
      } catch { /* fall through */ }
      return true
    }

    /**
     * Pick one of two strings by the active language.
     * @param zhText - Chinese copy.
     * @param enText - English copy.
     * @returns the active copy.
     */
    function t(zhText, enText) {
      return isZh() ? zhText : enText
    }

    /**
     * Resolve a host route against the page's own base, keeping any
     * reverse-proxy directory prefix (and the desktop shell's custom scheme).
     * @param path - relative route (`model-connect/api/state`).
     * @returns an absolute URL string.
     */
    function apiUrl(path) {
      const base = (typeof document !== 'undefined' && document.baseURI) || ''
      let url
      try {
        url = new URL(base !== '' ? base : 'http://127.0.0.1/')
      } catch {
        url = new URL('http://127.0.0.1/')
      }
      url.search = ''
      url.hash = ''
      if (!url.pathname.endsWith('/')) url.pathname += '/'
      return new URL(path.replace(/^\/+/, ''), url.href).href
    }

    /**
     * Call one host route and unwrap its JSON payload.
     * @param method - HTTP method.
     * @param action - route leaf (`state`, `probe`, `save`, `remove`).
     * @param payload - JSON body for POST routes.
     * @returns the parsed payload.
     */
    async function call(method, action, payload) {
      const init = { method, credentials: 'same-origin', headers: { accept: 'application/json' } }
      if (payload !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(payload)
      }
      let response
      try {
        response = await fetch(apiUrl(API_BASE + '/' + action), init)
      } catch (error) {
        throw new Error(t('无法连接本地服务：', 'cannot reach the host route: ') + (error instanceof Error ? error.message : String(error)))
      }
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        const message = data && typeof data.error === 'string' && data.error !== '' ? data.error : 'HTTP ' + response.status
        throw new Error(message)
      }
      return data ?? {}
    }

    /**
     * Subscribe a component to locale changes.
     * @returns true while a Chinese locale is active.
     */
    function useZh() {
      const [zh, setZh] = useState(isZh)
      useEffect(() => {
        if (!subscribed) {
          subscribed = true
          try {
            localeFace?.subscribe?.(() => {
              const next = isZh()
              for (const listener of listeners) listener(next)
            })
          } catch { /* no locale service: language stays fixed */ }
        }
        listeners.add(setZh)
        setZh(isZh())
        return () => { listeners.delete(setZh) }
      }, [])
      return zh
    }

    /** Shared control styles. */
    const S = {
      page: {
        height: '100%',
        overflowY: 'auto',
        background: COLOR.bg,
        color: COLOR.text,
        padding: '28px 32px 64px',
        boxSizing: 'border-box',
        font: '13px/1.55 var(--dsw-font-family-sans, system-ui, sans-serif)',
      },
      column: { maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 },
      title: { margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '0.2px' },
      sub: { margin: '6px 0 0', color: COLOR.dim, fontSize: 12.5 },
      card: {
        border: '1px solid ' + COLOR.border,
        borderRadius: 12,
        background: COLOR.layer1,
        overflow: 'hidden',
      },
      cardHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid ' + COLOR.border,
      },
      cardTitle: { fontSize: 13, fontWeight: 600 },
      cardBody: { padding: 16, display: 'flex', flexDirection: 'column', gap: 14 },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 16px',
        borderTop: '1px solid ' + COLOR.border,
      },
      grow: { flex: 1, minWidth: 0 },
      name: { fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      meta: { color: COLOR.dim, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 7px',
        borderRadius: 6,
        background: COLOR.layer2,
        border: '1px solid ' + COLOR.border,
        fontSize: 11,
        color: COLOR.dim,
        whiteSpace: 'nowrap',
      },
      label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: COLOR.dim },
      fieldLabel: { color: COLOR.text, fontSize: 12.5, fontWeight: 500 },
      input: {
        width: '100%',
        height: 34,
        padding: '0 10px',
        boxSizing: 'border-box',
        borderRadius: 8,
        border: '1px solid ' + COLOR.border,
        background: COLOR.bg,
        color: COLOR.text,
        fontSize: 12.5,
        outline: 'none',
        fontFamily: 'inherit',
      },
      textarea: {
        width: '100%',
        minHeight: 104,
        padding: '8px 10px',
        boxSizing: 'border-box',
        borderRadius: 8,
        border: '1px solid ' + COLOR.border,
        background: COLOR.bg,
        color: COLOR.text,
        fontSize: 12.5,
        outline: 'none',
        resize: 'vertical',
        fontFamily: 'var(--dsw-font-family-code, ui-monospace, monospace)',
        lineHeight: 1.6,
      },
      grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
      primary: {
        height: 32,
        padding: '0 14px',
        borderRadius: 8,
        border: '1px solid transparent',
        background: COLOR.brand,
        color: '#fff',
        fontSize: 12.5,
        fontWeight: 600,
        cursor: 'pointer',
      },
      secondary: {
        height: 30,
        padding: '0 12px',
        borderRadius: 8,
        border: '1px solid ' + COLOR.border,
        background: COLOR.layer2,
        color: COLOR.text,
        fontSize: 12,
        cursor: 'pointer',
      },
      ghost: {
        height: 28,
        padding: '0 9px',
        borderRadius: 7,
        border: '1px solid ' + COLOR.border,
        background: 'transparent',
        color: COLOR.dim,
        fontSize: 11.5,
        cursor: 'pointer',
      },
      dot: (color) => ({ width: 7, height: 7, borderRadius: 4, background: color, display: 'inline-block' }),
      notice: (kind) => ({
        padding: '9px 12px',
        borderRadius: 8,
        fontSize: 12,
        border: '1px solid ' + (kind === 'ok' ? COLOR.ok : kind === 'warn' ? COLOR.warn : COLOR.error),
        color: kind === 'ok' ? COLOR.ok : kind === 'warn' ? COLOR.warn : COLOR.error,
        background: COLOR.layer1,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }),
      hint: { color: COLOR.dim, fontSize: 11.5, margin: 0 },
    }

    /**
     * The sidebar glyph. The shell owns the row box, label and highlight; this
     * component draws only the 16px icon at the size the shell asks for.
     * @param props - shell-owned size and selection state.
     * @returns the plug glyph.
     */
    function Icon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          'data-dsh-panel-entry': PANEL_ID,
        },
        h('path', { d: 'M5.5 1.8v3.1M10.5 1.8v3.1' }),
        h('rect', { x: 3.2, y: 4.9, width: 9.6, height: 5.6, rx: 2.1 }),
        h('path', { d: 'M8 10.5v3.7' }),
      )
    }

    /** One labelled control. */
    function Field(props) {
      return h(
        'label',
        { style: S.label },
        h('span', { style: S.fieldLabel }, props.title),
        props.control,
        props.hint ? h('span', { style: S.hint }, props.hint) : null,
      )
    }

    /** Empty editor draft. */
    function emptyDraft() {
      return { route: '', displayName: '', baseURL: '', api: PROTOCOLS[0].value, apiKey: '', models: '', editing: false }
    }

    /**
     * The Models-connect page.
     * @returns the panel body.
     */
    function Panel() {
      const zh = useZh()
      const [state, setState] = useState({ phase: 'loading', data: null, error: '' })
      const [draft, setDraft] = useState(emptyDraft)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState(null)
      const [probed, setProbed] = useState([])

      const load = useCallback(async () => {
        try {
          const data = await call('GET', 'state')
          setState({ phase: 'ready', data, error: '' })
        } catch (error) {
          setState({ phase: 'error', data: null, error: error instanceof Error ? error.message : String(error) })
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const patch = useCallback((next) => { setDraft(previous => ({ ...previous, ...next })) }, [])

      const onEdit = useCallback((row) => {
        setNotice(null)
        setProbed([])
        setDraft({
          route: row.route,
          displayName: row.displayName,
          baseURL: row.baseURL,
          api: row.api,
          apiKey: '',
          models: row.models.map(model => model.id).join('\n'),
          editing: true,
        })
      }, [])

      const onReset = useCallback(() => {
        setDraft(emptyDraft())
        setProbed([])
        setNotice(null)
      }, [])

      const onProbe = useCallback(async () => {
        if (busy !== '') return
        setBusy('probe')
        setNotice(null)
        try {
          const result = await call('POST', 'probe', { baseURL: draft.baseURL, api: draft.api, apiKey: draft.apiKey })
          const models = Array.isArray(result.models) ? result.models : []
          setProbed(models)
          if (models.length > 0) patch({ models: models.map(model => model.id).join('\n') })
          setNotice({
            kind: models.length > 0 ? 'ok' : 'warn',
            text: models.length > 0
              ? (zh ? `连通正常，端点返回 ${models.length} 个模型，已填入模型列表。` : `Endpoint reachable, ${models.length} model(s) returned and filled in.`)
              : (zh ? '端点可访问但没有返回模型，请手动填写模型 ID。' : 'Endpoint reachable but returned no models; enter model ids manually.'),
          })
        } catch (error) {
          setNotice({
            kind: 'err',
            text: (zh ? '拉取模型失败：' : 'model probe failed: ') + (error instanceof Error ? error.message : String(error)),
          })
        } finally {
          setBusy('')
        }
      }, [busy, draft.baseURL, draft.api, draft.apiKey, patch, zh])

      const onSave = useCallback(async () => {
        if (busy !== '') return
        setBusy('save')
        setNotice(null)
        try {
          const models = draft.models.split(/[\n,]+/).map(id => id.trim()).filter(id => id !== '')
          const result = await call('POST', 'save', {
            route: draft.route,
            displayName: draft.displayName,
            baseURL: draft.baseURL,
            api: draft.api,
            apiKey: draft.apiKey,
            models,
          })
          if (result && Array.isArray(result.providers)) setState({ phase: 'ready', data: result, error: '' })
          setDraft(previous => ({ ...previous, apiKey: '', editing: true }))
          setProbed([])
          setNotice({
            kind: 'ok',
            text: zh
              ? `已保存：${result.route ?? draft.route}（${models.length} 个模型，凭据引用 ${result.apiKeyEnv ?? '—'}）。模型会出现在输入框的模型选择器里。`
              : `Saved ${result.route ?? draft.route} (${models.length} model(s), credential ${result.apiKeyEnv ?? '—'}). The models now appear in the composer model picker.`,
          })
        } catch (error) {
          setNotice({
            kind: 'err',
            text: (zh ? '保存失败：' : 'save failed: ') + (error instanceof Error ? error.message : String(error)),
          })
        } finally {
          setBusy('')
        }
      }, [busy, draft, zh])

      const onRemove = useCallback(async (row) => {
        if (busy !== '') return
        const question = zh
          ? `删除提供方「${row.displayName}」及其 Key（${row.apiKeyEnv}）？`
          : `Remove provider "${row.displayName}" and its key (${row.apiKeyEnv})?`
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(question)) return
        setBusy('remove')
        setNotice(null)
        try {
          const result = await call('POST', 'remove', { route: row.route, removeKey: true })
          if (result && Array.isArray(result.providers)) setState({ phase: 'ready', data: result, error: '' })
          setNotice({ kind: 'ok', text: zh ? `已删除 ${row.route}。` : `Removed ${row.route}.` })
        } catch (error) {
          setNotice({ kind: 'err', text: (zh ? '删除失败：' : 'remove failed: ') + (error instanceof Error ? error.message : String(error)) })
        } finally {
          setBusy('')
        }
      }, [busy, zh])

      const rows = state.data && Array.isArray(state.data.providers) ? state.data.providers : []
      const ns = state.data && typeof state.data.ns === 'string' ? state.data.ns : ''

      const header = h(
        'div',
        null,
        h('h1', { style: S.title }, t('模型接入', 'Model Connect')),
        h('p', { style: S.sub },
          t('填写第三方 OpenAI / Anthropic 兼容端点，测试连通后保存。Key 只写进本地凭据库，不会出现在配置文件里。',
            'Add a third-party OpenAI/Anthropic compatible endpoint and save it. The key is stored in the local credential store, never in config files.')),
      )

      const stateCard = h(
        'div',
        { style: S.card },
        h('div', { style: S.cardHead },
          h('span', { style: S.cardTitle }, t('已接入的提供方', 'Configured providers')),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            ns !== '' ? h('span', { style: S.badge }, 'settings: ' + ns) : null,
            h('button', {
              type: 'button',
              style: S.ghost,
              disabled: busy !== '',
              onClick: () => { void load() },
            }, t('刷新', 'Refresh')))),
        state.phase === 'loading'
          ? h('div', { style: { ...S.row, color: COLOR.dim } }, t('正在读取…', 'Loading…'))
          : state.phase === 'error'
            ? h('div', { style: { ...S.row, color: COLOR.error } }, state.error)
            : rows.length === 0
              ? h('div', { style: { ...S.row, color: COLOR.dim } }, t('还没有配置任何提供方，用下面的表单添加第一个。', 'No provider yet — add the first one below.'))
              : rows.map(row => h(
                'div',
                { key: row.route, style: S.row },
                h('span', { style: S.dot(row.keyConfigured ? COLOR.ok : COLOR.warn), title: row.keyConfigured ? t('Key 已配置', 'API key configured') : t('未检测到 Key', 'No API key detected') }),
                h('div', { style: S.grow },
                  h('div', { style: S.name }, row.displayName + ' · ' + row.route),
                  h('div', { style: S.meta }, (row.models.length > 0 ? row.models.map(model => model.id).join(' · ') : t('未声明模型', 'no models')) + (row.registered ? '' : t('（未注册到运行时）', ' (route not mounted)')).slice(0, 400)),
                  h('div', { style: S.meta }, row.baseURL + '  ·  ' + row.api)),
                h('button', { type: 'button', style: S.secondary, onClick: () => onEdit(row) }, t('编辑', 'Edit')),
                h('button', { type: 'button', style: S.ghost, onClick: () => { void onRemove(row) } }, t('删除', 'Remove'))))
      )

      const protocolOptions = PROTOCOLS.map(option => h('option', { key: option.value, value: option.value }, option.label))

      const editor = h(
        'div',
        { style: S.card },
        h('div', { style: S.cardHead },
          h('span', { style: S.cardTitle }, draft.editing ? t('编辑提供方', 'Edit provider') : t('新增提供方', 'Add provider')),
          h('button', { type: 'button', style: S.ghost, onClick: onReset }, t('清空', 'Clear'))),
        h('div', { style: S.cardBody },
          h('div', { style: S.grid2 },
            h(Field, {
              title: t('提供方 ID', 'Provider ID'),
              control: h('input', {
                style: S.input,
                value: draft.route,
                placeholder: 'my-relay',
                spellCheck: false,
                autoComplete: 'off',
                onChange: event => patch({ route: event.target.value }),
              }),
              hint: t('模型选择器里显示的路由名，保存后不建议再改。', 'Route name used by the model picker; avoid renaming afterwards.'),
            }),
            h(Field, {
              title: t('显示名称', 'Display name'),
              control: h('input', {
                style: S.input,
                value: draft.displayName,
                placeholder: t('我的中转站', 'My relay'),
                spellCheck: false,
                autoComplete: 'off',
                onChange: event => patch({ displayName: event.target.value }),
              }),
            })),
          h(Field, {
            title: t('接口地址（Base URL）', 'Base URL'),
            control: h('input', {
              style: S.input,
              value: draft.baseURL,
              placeholder: 'https://gateway.example/v1',
              spellCheck: false,
              autoComplete: 'off',
              onChange: event => patch({ baseURL: event.target.value }),
            }),
            hint: t('OpenAI 兼容填到 /v1 为止；Anthropic 填站点根地址（SDK 自己接 /v1/messages）。',
              'For OpenAI-compatible endpoints stop at /v1; for Anthropic use the site root (the SDK appends /v1/messages).'),
          }),
          h('div', { style: S.grid2 },
            h(Field, {
              title: t('协议', 'Protocol'),
              control: h('select', {
                style: { ...S.input, paddingTop: 0, paddingBottom: 0 },
                value: draft.api,
                onChange: event => patch({ api: event.target.value }),
              }, protocolOptions),
            }),
            h(Field, {
              title: t('API Key', 'API Key'),
              control: h('input', {
                style: S.input,
                type: 'password',
                value: draft.apiKey,
                placeholder: draft.editing ? t('留空表示沿用已保存的 Key', 'Leave blank to keep the saved key') : 'sk-...',
                autoComplete: 'new-password',
                spellCheck: false,
                onChange: event => patch({ apiKey: event.target.value }),
              }),
              hint: t('只写入本地凭据库，配置文件里只留引用名。', 'Written to the local credential store only; config keeps the reference name.'),
            })),
          h(Field, {
            title: t('模型列表（每行一个）', 'Models (one per line)'),
            control: h('textarea', {
              style: S.textarea,
              value: draft.models,
              placeholder: 'deepseek-v4.1-flash\nglm-5.3',
              spellCheck: false,
              onChange: event => patch({ models: event.target.value }),
            }),
            hint: t('可以先点「测试连接」自动拉取，再手工增删。', 'Use "Test connection" to pull the catalog, then edit by hand.'),
          }),
          probed.length > 0
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              probed.slice(0, 40).map(model => h('span', { key: model.id, style: S.badge }, model.id)))
            : null,
          notice !== null ? h('div', { style: S.notice(notice.kind) }, notice.text) : null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('button', {
              type: 'button',
              style: { ...S.secondary, height: 32, opacity: busy === '' ? 1 : 0.55 },
              disabled: busy !== '',
              onClick: () => { void onProbe() },
            }, busy === 'probe' ? t('正在连接…', 'Probing…') : t('测试连接 / 拉取模型', 'Test connection / pull models')),
            h('button', {
              type: 'button',
              style: { ...S.primary, opacity: busy === '' ? 1 : 0.55 },
              disabled: busy !== '',
              onClick: () => { void onSave() },
            }, busy === 'save' ? t('保存中…', 'Saving…') : t('保存并启用', 'Save & enable'))))
      )

      return h('div', { style: S.page, 'data-dsh-model-connect': '' },
        h('div', { style: S.column }, header, stateCard, editor,
          h('p', { style: S.hint },
            t('保存后新模型会进入输入框的模型选择器；若没有立即出现，刷新一次页面即可。',
              'New models show up in the composer model picker; refresh the page once if they do not appear immediately.'))))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          localeFace = ctx.get('locale')
        } catch {
          localeFace = undefined
        }
        const slots = ctx.slots
        try {
          slots.inject('sidebar.panellist', () => slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 45,
            label: () => t('模型接入', 'Model Connect'),
          }, Icon))
        } catch (error) {
          console.warn('[model-connect] sidebar row registration failed:', error)
        }
        try {
          slots.inject('main', () => slots.register({
            name: 'main',
            key: PANEL_ID,
          }, Panel))
        } catch (error) {
          console.warn('[model-connect] main panel registration failed:', error)
        }
      },
    }
  },
})

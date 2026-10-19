# dsh-model-connect · 模型接入

**中文** | [English](#english)

给 [DeepSeek Harness](https://github.com/deepseek-ai)（下称 DSH）Web 界面左侧边栏加一个「模型接入」面板：
在图形界面里填写第三方 **OpenAI / Anthropic 兼容** 端点与 API Key，探测该端点提供的模型列表，
保存成 `dsh-llm-pi-ai` 的 provider 路由，随后就能在模型选择器里直接使用。

A sidebar panel for the DeepSeek Harness Web UI: fill in a third-party
**OpenAI / Anthropic compatible** endpoint and its API key, probe the endpoint's
model catalog, and save it as a `dsh-llm-pi-ai` provider route — no YAML editing,
no `cordis.yml` surgery, no restart.

---

## 中文

不需要改 `cordis.yml`、不需要手写 `providers` YAML、不需要重启 DSH。

### 功能

- **侧边栏入口**：左侧 `model-connect` 图标 → 主区域整页面板（与内置 Plugins / Schedule / SSH 行同一套 shell 插槽）。
- **协议支持**：`openai-completions`（`/chat/completions`）、`openai-responses`（`/responses`）、`anthropic-messages`（`/v1/messages`）。
- **模型探测**：填好 Base URL 与 Key，点「探测模型」即调用 LLM 服务的 `discoverModels` 拿回模型清单，自动回填模型 ID。
- **路由保存**：写入 `llm-pi-ai` 命名空间的 `providers.<route>`，规则与官方 Models 设置页完全一致（`providers` 是易变字段）。
- **Key 安全**：API Key 只写进 `credentials` 服务，引用名形如 `<ROUTE>_API_KEY`，**不会**落进 `cordis.patch.yml`。
- **编辑 / 删除**：已有路由可原地改写 Base URL、协议、模型集合；删除时可选择是否连带清除凭据。
- **原生观感**：全部使用 `--dsw-alias-*` 设计令牌，跟随主题与深浅色；中英文按当前 locale 自动切换。

### 目录结构

```
model-connect/
├── index.js            # Host 半：loopback 路由（state / probe / save / remove）+ settings/credentials 写入
├── client.js           # 浏览器半：侧边栏行 + 主区域页面（纯 JS，无构建步骤，React 由模块表提供）
├── cordis.patch.yml    # bundle 补丁：把自己 insert 进 Loader 组合
├── package.json        # 清单：exports / files / dsh.bundle / dsh.client.inject
├── locale/
│   ├── zh.json         # 面板元信息（中文）
│   └── en.json         # 面板元信息（英文）
├── icon.svg            # 侧边栏图标
└── tools/push-api.ps1  # 无 git 二进制时的 REST 发布脚本
```

### 安装

**方式一：本地链接（开发 / 自用）**

```powershell
git clone https://github.com/ilmilm/dsh-model-connect.git C:\path\to\model-connect
dsh plugin --profile desktop add C:\path\to\model-connect
```

然后在 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 数组里追加一项：

```json
"@local/dsh-model-connect"
```

重启 DSH（或重新加载 profile）后，左侧边栏出现「模型接入」。

**方式二：手动登记**

1. 把仓库放到任意目录；
2. 编辑 `~/.dsh/profiles/<profile>/package.json`：

```json
{
  "dependencies": {
    "@local/dsh-model-connect": "link:C:/path/to/model-connect"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "@local/dsh-model-connect"]
    }
  }
}
```

3. 在 profile 目录执行 `pnpm install`，重启 DSH。

> 包名保持 `@local/dsh-model-connect`（不是发布到 npm 的包），`@local/` 作用域配合 `link:` 依赖即可解析。

### 使用

1. 左侧点「模型接入」；
2. 填 **提供方 ID**（如 `myrelay`，只能字母数字点下划线连字符）、**显示名**、**Base URL**（如 `https://api.example.com/v1`）、**协议**；
3. 填 **API Key**，点「探测模型」；
4. 勾选要启用的模型 → 保存；
5. 保存后该路由在原 Models 设置页与模型选择器里立即可见。

### Host HTTP 路由

所有特权操作都在 Host 半，浏览器半通过下面四条同源路由访问（仅回环地址可调）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/model-connect/api/state` | 当前路由、模型清单、Key 配置状态、命名空间诊断 |
| `POST` | `/model-connect/api/probe` | 用草稿端点 + Key 探测模型列表 |
| `POST` | `/model-connect/api/save` | 新增 / 更新一条 provider 路由（并写 Key） |
| `POST` | `/model-connect/api/remove` | 删除一条路由（可选连带删除 Key） |

### 安全边界

- **仅回环**：`socket.remoteAddress` 必须是 `127.0.0.0/8` 或 `::1`，`Host`/`Origin` 必须同源，`Sec-Fetch-Site: cross-site` 直接 403；不信任 `X-Forwarded-For`。
- **请求体上限** 256 KiB，非 JSON 直接 400。
- **Key 不落配置**：`cordis.patch.yml` 只出现 `<ROUTE>_API_KEY` 引用名；值存在 `credentials` 服务里。
- **参数校验**：route ID 走 `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`；Base URL 必须是 `http(s)`；Key 只允许可见 ASCII。

### 兼容性

- DSH `0.2.x`（开发验证于 `0.2.1-rc.2`）。
- 依赖 Host 服务：`webServer`、`settings`、`credentials`、`llm`；对应插件需在组合中启用。
- 浏览器半无构建步骤（无 JSX / 无 bundler），React 从浏览器模块表读取。

---

## English

A sidebar entry plus a full-page panel inside the DeepSeek Harness (DSH) Web UI
that registers third-party **OpenAI / Anthropic compatible** model endpoints as
first-class `dsh-llm-pi-ai` providers. Everything the official Models settings
page does, but reachable from the left rail and with a live model probe.

### Features

- **Sidebar entry** — a `model-connect` row on the left rail opens a page in the layout's keyed `main` slot, using the same shell-owned pattern as the built-in Plugins / Schedule / SSH rows.
- **Three protocols** — `openai-completions` (`/chat/completions`), `openai-responses` (`/responses`), `anthropic-messages` (`/v1/messages`).
- **Live model probe** — enter a base URL and key, hit *Probe*, and the panel calls the LLM service's `discoverModels` to populate the model list.
- **Route persistence** — writes `providers.<route>` in the `llm-pi-ai` settings namespace, following the exact rules of the shipped Models page (`providers` is a volatile field).
- **Key handling** — the API key is written to the `credentials` service only, under a `<ROUTE>_API_KEY` reference; it never lands in `cordis.patch.yml`.
- **Edit / remove** — existing routes can be updated in place (base URL, protocol, model set); removal can optionally delete the stored credential.
- **Native look** — every colour comes from `--dsw-alias-*` design tokens, so it follows the active theme; copy switches between Chinese and English by locale.

### Layout

```
model-connect/
├── index.js            # host half: loopback routes (state/probe/save/remove) + settings & credentials writes
├── client.js           # browser half: sidebar row + main-slot page (plain JS, no build step, React from the module table)
├── cordis.patch.yml    # bundle patch: inserts itself into the Loader composition
├── package.json        # manifest: exports / files / dsh.bundle / dsh.client.inject
├── locale/
│   ├── zh.json         # panel metadata (Chinese)
│   └── en.json         # panel metadata (English)
├── icon.svg            # sidebar icon
└── tools/push-api.ps1  # REST publishing helper for machines without a git binary
```

### Install

**Option 1 — local link (development / personal use)**

```powershell
git clone https://github.com/ilmilm/dsh-model-connect.git C:\path\to\model-connect
dsh plugin --profile desktop add C:\path\to\model-connect
```

Then append the package to the `dsh.profile.bundles` array in
`~/.dsh/profiles/desktop/package.json`:

```json
"@local/dsh-model-connect"
```

Restart DSH (or reload the profile); the *Model Connect* row appears on the left rail.

**Option 2 — manual registration**

1. Put the repository anywhere on disk.
2. Edit `~/.dsh/profiles/<profile>/package.json`:

```json
{
  "dependencies": {
    "@local/dsh-model-connect": "link:C:/path/to/model-connect"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "@local/dsh-model-connect"]
    }
  }
}
```

3. Run `pnpm install` inside the profile directory and restart DSH.

> The package keeps the name `@local/dsh-model-connect` (it is not published to npm);
> the `@local/` scope resolves through the `link:` dependency.

### Usage

1. Click *Model Connect* on the left rail.
2. Fill in **provider ID** (e.g. `myrelay` — letters, digits, dot, underscore, hyphen), **display name**, **base URL** (e.g. `https://api.example.com/v1`) and **protocol**.
3. Enter the **API key** and click *Probe models*.
4. Tick the models to enable, then save.
5. The route shows up immediately in the shipped Models page and the model picker.

### Host routes

Every privileged operation lives in the host half. The browser half reaches it
through four same-origin routes (loopback only):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/model-connect/api/state` | Current routes, model lists, key state, namespace diagnostics |
| `POST` | `/model-connect/api/probe` | Probe a draft endpoint + key for its model catalog |
| `POST` | `/model-connect/api/save` | Upsert one provider route (and its key) |
| `POST` | `/model-connect/api/remove` | Remove one route (optionally its credential) |

### Security boundaries

- **Loopback only** — `socket.remoteAddress` must be `127.0.0.0/8` or `::1`; `Host` and `Origin` must be same-origin; `Sec-Fetch-Site: cross-site` is rejected with 403. `X-Forwarded-For` is never trusted.
- **Body cap** — 256 KiB, non-JSON bodies are rejected with 400.
- **Keys never enter config** — `cordis.patch.yml` only ever holds a `<ROUTE>_API_KEY` reference; the value lives in the `credentials` service.
- **Validation** — route ID must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; base URL must be `http(s)`; keys are limited to visible ASCII.

### Compatibility

- DSH `0.2.x` (developed and verified against `0.2.1-rc.2`).
- Requires the host services `webServer`, `settings`, `credentials`, `llm` to be enabled in the composition.
- The browser half needs no build step (no JSX, no bundler); React is read from the browser module table.

---

## License

MIT — see [LICENSE](LICENSE).

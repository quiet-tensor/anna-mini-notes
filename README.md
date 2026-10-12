# Mini Notes with LLM Summary — Anna App

一个本地运行的 Anna App：创建 / 查看 / 删除短笔记，笔记**只**通过 Anna storage Host API（`anna.storage.get` / `anna.storage.set`）持久化；点击 **Summarize** 后，前端通过 `anna.tools.invoke` 调用随 App 打包的本地 Executa Tool，Tool 再通过反向 JSON-RPC `sampling/createMessage` 向 host LLM 请求总结，结果回到 UI 展示。

```text
Anna App iframe (bundle/index.html, Vite + TypeScript)
  -> AnnaAppRuntime.connect()                       src/anna/runtime.ts
  -> anna.storage.get / anna.storage.set            src/notes/repository.ts
  -> anna.tools.invoke({tool_id, method, args})     src/summary/summarizer.ts
  -> Executa invoke (JSON-RPC 2.0 over stdio)       executas/notes-summarizer/src/server.js
  -> reverse JSON-RPC sampling/createMessage        executas/notes-summarizer/src/sampling.js
  -> host LLM 或 mock sampling fixture              executas/notes-summarizer/fixtures/sampling.jsonl
  -> summary 返回 UI
```

| 身份 | 值 |
|---|---|
| Executa `tool_id`（= describe `name`） | `tool-mini-notes-summarizer` |
| Tool 方法名 | `summarize_notes` |
| storage key | `mini-notes:v1:notes` |

`manifest.json`（`required_executas`、`ui.host_api.tools`）、`executa.json`、`src/config.ts`、Executa `describe` 返回值中的身份由 `npm run check:identity` 自动比对，不一致则失败。

---

## 1. 项目结构

```text
.
├── manifest.json                  # Anna App manifest (schema 2)
├── app.json                       # 商店元数据 (slug / name / version)
├── index.html                     # Vite 入口（源码），构建产物在 bundle/
├── src/                           # 工程化前端（TypeScript）
│   ├── main.ts                    #   组装：连接 runtime → 仓库 → 视图
│   ├── config.ts                  #   TOOL_ID / SUMMARIZE_METHOD / storage key 常量
│   ├── anna/runtime.ts            #   AnnaAppRuntime.connect() + 错误格式化
│   ├── anna/types.ts              #   用到的 Host API 类型
│   ├── anna/anna-sdk.d.ts         #   host 提供的 SDK 模块类型（不打包）
│   ├── notes/model.ts             #   笔记数据结构与纯函数（添加顺序 seq）
│   ├── notes/repository.ts        #   storage 访问：只用 anna.storage.get / set
│   ├── summary/summarizer.ts      #   anna.tools.invoke 调用 Executa
│   ├── ui/view.ts, dom.ts         #   DOM 渲染
│   ├── ui/activity-log.ts         #   Host API 调用记录面板（证据）
│   └── styles.css
├── bundle/                        # `npm run build` 生成（gitignored），ui.bundle.entry = index.html
├── executas/notes-summarizer/     # 本地 Executa Tool（Node.js，零运行时依赖）
│   ├── executa.json               #   tool_id + type=node（anna-app dev / executa dev 读取）
│   ├── package.json               #   bin[tool_id] -> src/index.js
│   ├── src/index.js               #   入口：stdin 读到 EOF 才退出
│   ├── src/server.js              #   initialize / describe / invoke / health / shutdown
│   ├── src/transport.js           #   行分隔 JSON-RPC，区分请求与反向 RPC 响应，写后 flush
│   ├── src/sampling.js            #   sampling/createMessage 客户端
│   ├── src/summarize.js           #   prompt 构造；summary 只取自 sampling 返回
│   ├── src/manifest.js            #   describe 返回的裸 manifest
│   ├── src/identity.js            #   TOOL_ID / 工具名 / 版本
│   ├── fixtures/sampling.jsonl    #   --mock-sampling 使用的 fixture
│   ├── test/protocol.test.mjs     #   手动协议测试脚本（伪 host，记录 transcript）
│   └── scripts/build-binary.mjs   #   本机二进制打包（Node SEA）+ archive.mjs
├── scripts/
│   ├── check-identity.mjs         # 身份一致性检查
│   └── executa-mock.mjs           # 封装 anna-app executa dev --mock-sampling
└── .github/workflows/
    ├── release.yml                # 三平台构建 + 上传 GitHub Release assets
    └── ci.yml                     # push / PR 检查
```

## 2. 安装依赖

前置：**Node.js ≥ 22**（推荐 24）、[`uv`](https://docs.astral.sh/uv/)（`anna-app dev` 通过 `uvx` 拉取本地 runtime）。不需要 Anna 账号、`anna-app login` 或 LLM API key。

```bash
npm install
```

`anna-app` CLI（`@anna-ai/cli`）作为 devDependency 安装，以下命令都用 `npx anna-app …` 或 npm scripts 调用。

> 首次 `anna-app dev` 时 `uvx` 需要下载 `anna-app-runtime-local`，若 8 秒内未就绪会报 `bridge did not signal ready`，再运行一次即可（或先执行 `uvx --from anna-app-runtime-local==0.2.0a28 python -c "import anna_app_runtime_local"` 预热缓存）。

## 3. 构建前端 bundle

```bash
npm run build        # tsc 类型检查 + vite build → bundle/index.html + bundle/assets/*
```

- `manifest.json` 的 `ui.bundle.entry` = `index.html`，即 `bundle/index.html`（`anna-app dev` / `validate` 默认读取 `./bundle`）。
- Anna Runtime SDK `/static/anna-apps/_sdk/latest/index.js` 由 host 提供，在 `vite.config.ts` 中标记为 external，不会被打包。
- bundle 故意不压缩：`anna-app validate --strict` 会在构建产物里 grep `anna.<ns>.<method>(` 调用并与 `ui.host_api` 比对，压缩后变量名被改写会让这项检查失效。

## 4. `anna-app validate --strict`

```bash
npm run build
npx anna-app validate --strict      # 或 npm run validate
# ✓ validate passed
```

`--strict` 会扫描 bundle 中的 Host API 调用。若把 `ui.host_api.storage` 改成 `["get"]`，会得到：
`✗ host-api: …/bundle/assets/index-*.js:165 calls anna.storage.set but manifest.ui.host_api.storage does not grant it`。

## 5. 用 `anna-app dev --no-llm` 测试 UI harness

```bash
npm run build
npm run dev          # = anna-app dev --no-llm
```

打开终端里打印的 dashboard（默认 <http://localhost:5180/>），bundle 在 harness iframe 中运行：

1. 输入笔记点击 **Save**（或 Ctrl/⌘+Enter）。空白输入时按钮禁用，代码也会拒绝；保存后输入框清空。
2. 列表显示内容、添加顺序 `#seq`（删除后不复用）和时间戳；无笔记时显示空状态，失败时显示错误状态。
3. 点击 **Delete** 删除一条，列表立即按 storage 返回的新文档刷新。
4. 点击 **Summarize**：前端先 `anna.storage.get` 读取当前 notes，再 `anna.tools.invoke` 调用 Executa。

### 为什么 `--no-llm` 下 Summarize 预期报错 `[-32603] harness started with --no-llm`

这是 App 调试路径的**预期结果**，不代表后端 Tool 的 sampling 失败。实际发生的是：

1. iframe 调 `anna.tools.invoke` → harness 拉起 `executas/notes-summarizer`（stdio）并转发 `invoke`，带上 host 生成的 `context.invoke_id`；
2. Tool 发出反向 `sampling/createMessage`；
3. harness 被 `--no-llm` 启动，LLM bridge 关闭，于是用 `-32603 harness started with --no-llm` 回复这次 sampling；
4. Tool 把 host 的错误码原样作为 JSON-RPC error 返回，UI 显示 `[tool_failed] [-32603] harness started with --no-llm`。

能看到这个错误，恰好证明 UI → `tools.invoke` → Executa → `sampling/createMessage` 整条链路是通的。终端里能看到 Tool 的 stderr（harness 加了 `[bridge] [executa:…]` 前缀）：

```text
[rpc] invoke {"tool":"summarize_notes","invoke_id":"33f74335…","invoke_id_source":"host"}
[sampling] -> sampling/createMessage {"invoke_id":"33f74335…","messages":1,"maxTokens":400}
[sampling] <- sampling/createMessage error {"invoke_id":"33f74335…","code":-32603,"message":"harness started with --no-llm"}
```

UI harness 里**没有**用 mock fixture 伪造 summary；sampling 的 mock 只在下一节的后端测试中使用。

### 为什么 manifest 声明了 `ui.host_api.llm: ["complete"]`

这一项是让 `--no-llm` 下得到题目要求的 `[-32603] harness started with --no-llm` 的**必要条件**，与“前端不得直接调用 `anna.llm.complete`”不冲突：

- 本地 harness（`anna-app-runtime-local`）收到 Executa 的反向 `sampling/createMessage` 后，按 `session.py` 中的 `_REVERSE_RPC_ROUTE` 把它映射为 `("llm", "complete")`，经 `anna_app_core/dispatcher.py::dispatch` 执行；`dispatch` 先用 `host_api_allows(manifest, "llm", "complete")` 检查 App 的 `ui.host_api.llm`，通过后才进入 LLM bridge，此时 `--no-llm` 返回 `harness started with --no-llm`。
- 不声明时，sampling 会在 ACL 这一步被提前拒绝，UI 得到的是 `[-32603] manifest does not grant 'llm.complete'`，与题目要求不一致（已实测两种情况）。
- 这个声明只是让 **Executa 的 sampling** 能通过 harness 的检查；iframe 自身从不使用它。`npm run check:frontend` 会扫描 `src/` 与构建后的 `bundle/`：出现任何 `anna.llm.*`、`fetch`、`XMLHttpRequest`、`localStorage` / `indexedDB`，或除 `anna.storage.get/set`、`anna.tools.invoke`、`anna.window.set_title` 之外的 Host API 调用即失败（已纳入 `npm test` 和 CI）。harness RPC LOG 中也只会出现 `storage.*`、`tools.invoke`、`window.*`，不会有 iframe 发起的 `llm.complete`。

## 6. 用 `anna-app executa dev --mock-sampling` 单独测试后端 sampling

```bash
npm run executa:mock
# 等价于（JSON 参数用脚本传递，避免不同 shell 的引号差异）：
# anna-app executa dev --dir executas/notes-summarizer \
#   --mock-sampling executas/notes-summarizer/fixtures/sampling.jsonl \
#   --invoke summarize_notes --args '{"notes":[{"seq":1,"content":"明天跟客户 follow up"}, …]}'
```

交互式 REPL：`npm run executa:repl`，然后输入 `describe` / `health` / `invoke summarize_notes {"notes":["修复登录 bug"]}`。

fixture `executas/notes-summarizer/fixtures/sampling.jsonl` 每行一个 mock 回复：

```json
{"ns":"sampling","method":"createMessage","match":{"contentIncludes":"Summarize these notes."},"result":{"role":"assistant","content":{"type":"text","text":"(mock sampling) …"},"model":"mock-sampling-fixture", …}}
```

### 如何确认 Tool 发起过 `sampling/createMessage`

- **stderr 日志**（`executa dev` 加 `[executa]` 前缀）：先 `-> sampling/createMessage`（带 `invoke_id`），再 `<- sampling/createMessage result`（带反向请求 `id` 和 `model`）。
- **返回值**：`data.summary` 与 fixture 文本逐字一致（带 `(mock sampling)` 标记），`data.source = "sampling/createMessage"`，`data.sampling.model = "mock-sampling-fixture"`，`data.sampling.request_id` 为反向请求 id。Tool 自身没有任何拼接 summary 的代码（见 `src/summarize.js`），sampling 无文本时直接报错。
- 若去掉 `--mock-sampling`（且没有登录），CLI 关闭 sampling，Tool 会返回 host 的 `-32008` 错误而不是 summary——说明 summary 不可能来自 Tool 本地。

## 7. 手动测试 Executa JSON-RPC（initialize / describe / invoke）

### 7.1 自动化协议脚本（推荐）

```bash
npm run test:protocol
```

`test/protocol.test.mjs` 扮演 host：通过 stdin/stdout 依次发送 `initialize`（v2）→ `describe` → `invoke`，用 fixture 回复 Tool 发来的反向 `sampling/createMessage`，并校验：v2 协商与 `client_capabilities.sampling = {}`；describe 裸 manifest 的必需字段、`host_capabilities: ["llm.sample"]`、`parameters[]` 形态；sampling 请求里包含全部笔记、`metadata.executa_invoke_id`、`includeContext: "none"`；summary 与 sampling 返回逐字一致；host 错误码透传；`-32602 / -32601 / -32700` 错误路径；stdout 只有 JSON-RPC 帧；stdin EOF 后以 0 退出。

**证据**：所有双向帧写入 `recordings/protocol-transcript.jsonl`，每行 `{"t","dir","frame"}`，`dir` 为 `host->plugin` 或 `plugin->host`。查看反向 sampling：

```bash
grep '"method":"sampling/createMessage"' recordings/protocol-transcript.jsonl
```

可以看到 `plugin->host` 的请求（含 prompt、`metadata.executa_invoke_id: "test-invoke-0001"`）以及紧随其后同 id 的 `host->plugin` 响应。`SHOW_STDERR=1 npm run test:protocol` 会额外打印 Tool 的 stderr。

### 7.2 纯手工

```bash
cd executas/notes-summarizer
printf '%s\n' \
  '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2.0","capabilities":{"sampling":{}}}}' \
  '{"jsonrpc":"2.0","id":1,"method":"describe"}' \
  '{"jsonrpc":"2.0","id":2,"method":"invoke","params":{"tool":"summarize_notes","arguments":{"notes":["修复登录 bug"]},"context":{"invoke_id":"manual-1"}}}' \
  | node src/index.js 2>/dev/null
```

stdout 依次输出：`initialize` 结果（`protocolVersion: "2.0"`、`client_capabilities.sampling`）、`describe` 裸 manifest、一条 Tool 发出的 **`"method":"sampling/createMessage"` 反向请求**（`metadata.executa_invoke_id: "manual-1"`）。由于 printf 随后关闭了 stdin、没人回复 sampling，最后 `invoke` 以 `-32603 stdin closed while waiting for sampling/createMessage` 结束。想手工完成一次 sampling，可直接运行 `node src/index.js`，粘贴上面三行，再粘贴一行同 id 的响应：

```json
{"jsonrpc":"2.0","id":"<复制反向请求的 id>","result":{"role":"assistant","content":{"type":"text","text":"手工 summary"},"model":"manual"}}
```

`health` / `shutdown` 也已实现：`{"jsonrpc":"2.0","id":3,"method":"health"}`、`{"jsonrpc":"2.0","id":4,"method":"shutdown"}`。

## 8. 如何确认 notes 存储走的是 `anna.storage.*`

- **代码**：`src/notes/repository.ts` 是唯一的持久化层，读只有 `anna.storage.get`，写只有 `anna.storage.set`；整份 notes 文档存在一个 key 下（原子 get/set，带 `if_match` 乐观并发重试）。项目中没有 `localStorage` / IndexedDB / 文件系统调用（`grep -rn "localStorage\|indexedDB" src` 为空），UI 每次都渲染 storage 返回的文档，而不是自己维护的 state。
- **harness RPC LOG**（dashboard 右侧面板）：每次保存/删除都是 `→ req storage.get {"key":"mini-notes:v1:notes"}` → `→ req storage.set {"key":"mini-notes:v1:notes","value":{…}}` → `← res ok storage.set {"ok":true}`，随后 host 推送 `runtime_state_synced`，说明写进了 legacy in-memory `runtime_state`。
- **App 内 “Host API activity” 面板**：列出本窗口发出的每次 `anna.storage.get` / `anna.storage.set` / `anna.tools.invoke`、参数摘要、耗时与成败。
- `npx anna-app validate --strict`：确认 bundle 里的 `anna.storage.set(` 等调用均被 `ui.host_api` 授权。

本地 legacy runtime_state 只存在于本次 `anna-app dev` 进程内，重启 dev 后清空，这是预期行为。

## 9. 如何确认 summary 走的是 `anna.tools.invoke -> Executa -> sampling/createMessage`

1. UI 侧：activity 面板 / harness RPC LOG 中出现 `anna.tools.invoke tool-mini-notes-summarizer · summarize_notes`；前端没有任何生成 summary 的代码（`src/summary/summarizer.ts` 只解包 Tool 返回的 `data.summary`），也不调用 `anna.llm.*` 或 `fetch`——`npm run check:frontend` 对源码和 bundle 自动验证这一点。
2. Executa 侧：harness 终端中的 `[sampling] -> sampling/createMessage {"invoke_id":"<host invoke_id>"}`，`invoke_id_source: "host"` 表明关联 id 来自 harness 注入的 `context.invoke_id`。
3. Sampling 侧：`--no-llm` 下 host 对 sampling 的拒绝原样回到 UI（第 5 节）；`npm run executa:mock` / `npm run test:protocol` 中 summary 与 sampling 回复逐字一致（第 6、7 节）。

## 10. 本机二进制打包

```bash
npm run package:binary
```

`executas/notes-summarizer/scripts/build-binary.mjs`：

1. 识别本机平台 key（`darwin-arm64` / `darwin-x86_64` / `windows-x86_64` / `linux-x86_64` / `linux-aarch64`，`x64` 统一为 `x86_64`）；
2. esbuild 把 `src/` 打成单个 CJS 文件 → Node **SEA**（Single Executable Application）blob → postject 注入当前 `node` 可执行文件的副本（macOS 先去签名、注入后 ad-hoc 重签）。产物是原生可执行文件，不依赖已安装的 Node，不是“源码 + 解释器”；
3. 写 archive 根目录 `manifest.json`；
4. 对**构建出的二进制**跑完整协议测试（`--no-test` 可跳过）；
5. 打包到 `executas/notes-summarizer/dist/`：

```text
tool-mini-notes-summarizer-0.1.0-<platform>.tar.gz   # macOS / Linux
tool-mini-notes-summarizer-0.1.0-<platform>.zip      # Windows
tool-mini-notes-summarizer-0.1.0-<platform>.<ext>.sha256
```

archive 结构（按 [Executa binary distribution](https://staging.anna.partners/developers/tools/executa-binary) 文档）：

```text
manifest.json                              # 0644
bin/tool-mini-notes-summarizer[.exe]       # 0755，entrypoint
```

```json
{
  "name": "tool-mini-notes-summarizer",
  "version": "0.1.0",
  "executable_name": "tool-mini-notes-summarizer",
  "runtime": {
    "binary": {
      "entrypoint": {
        "default": "bin/tool-mini-notes-summarizer",
        "windows-x86_64": "bin/tool-mini-notes-summarizer.exe",
        "windows-arm64": "bin/tool-mini-notes-summarizer.exe"
      },
      "permissions": { "bin/tool-mini-notes-summarizer": "0o755" }
    }
  }
}
```

tar.gz / zip 由 `scripts/archive.mjs` 用 Node 内置 zlib 直接写出，显式设置 Unix 权限位（zip 的 external attributes 同样带 0755），因此在任何构建机上权限都一致。检查：

```bash
tar -tzvf executas/notes-summarizer/dist/*.tar.gz       # macOS / Linux
unzip -Z executas/notes-summarizer/dist/*.zip           # Windows 产物
```

`executa.json` 的 `distribution.profiles.binary.binary_artifacts` 指向这些 archive（`anna-app executa upload-binaries` 的直传路径）。Windows 上 postject 会提示 `The signature seems corrupted!`：注入会使 node.exe 原有 Authenticode 签名失效，本题不要求代码签名，可忽略。

## 11. GitHub Actions 发布

`.github/workflows/release.yml`

- 触发：推送 tag `v*`（`git tag v0.1.0 && git push origin v0.1.0`），或在 Actions 页面手动运行 **Release**（`workflow_dispatch`，填写 tag，如 `v0.1.0`）。
- `verify`：`npm ci` → `npm run build` → `anna-app validate --strict` → `npm test`。
- `build`（矩阵，各平台原生 runner；SEA 只能为构建它的 node 所在平台出包）：

  | platform key | runner | 产物 |
  |---|---|---|
  | `darwin-arm64` | `macos-14` | `tool-mini-notes-summarizer-<ver>-darwin-arm64.tar.gz` |
  | `darwin-x86_64` | `macos-15-intel` | `tool-mini-notes-summarizer-<ver>-darwin-x86_64.tar.gz` |
  | `windows-x86_64` | `windows-latest` | `tool-mini-notes-summarizer-<ver>-windows-x86_64.zip` |

  每个平台：打包（含对二进制的完整协议测试）→ 校验平台 key → **smoke test**：解压 archive，检查根目录 `manifest.json` 与 entrypoint 可执行位，向二进制发送 `describe` JSON-RPC 并校验 `name`、`llm.sample`、`summarize_notes`、`runtime.type = "binary"` → 上传 workflow artifact（辅助）。
- `release`：汇总三个平台产物，确认三种 asset 都在，用 `softprops/action-gh-release` 上传到 **GitHub Release assets**（附 `.sha256`）。

`.github/workflows/ci.yml` 在 push / PR 上运行 build、validate、测试、`executa:mock` 和 linux-x86_64 打包。

## 12. 概念关系

- **manifest**（`manifest.json`）：App 的契约。声明依赖的 Executa（`required_executas`）、iframe 可调用的 Host API（`ui.host_api` 是唯一的运行时 ACL：`storage: get/set`、`tools: required:<tool_id>`，以及供本地 harness 放行 Executa sampling 的 `llm: complete`，见第 5 节）、UI bundle 入口与 views，以及只给本地 harness 用的 `dev` 配置。`permissions` 在 schema 2 中仅作展示。
- **bundle**（`bundle/`）：`npm run build` 生成的静态 SPA，被 host 装进 iframe；通过 host 提供的 `AnnaAppRuntime.connect()` 握手，之后所有能力都经 postMessage RPC 调 Host API，不直连任何后端。
- **executas**（`executas/notes-summarizer/`）：Agent（本地为 harness）以子进程方式启动的工具，JSON-RPC 2.0 over stdio。App 只能用 `anna.tools.invoke` 调用 manifest 里声明的 Executa。
- **Anna storage / APS KV**：`anna.storage.*` 是 App 的 KV。本地 `anna-app dev` 默认 legacy 模式，存在窗口的 in-memory `runtime_state`（≤256 KB，dev 重启即清空）；生产环境同一组方法由 APS（`scope=app`）承接，代码无需改动。manifest 中的 `aps.kv` 声明了这一 KV 面。
- **sampling**：Executa 不持有 API key，而是在处理 `invoke` 时向 host 发反向 `sampling/createMessage`，由 host 选模型、计费并返回结果。前提：`initialize` 协商 v2 并声明 `sampling`，`describe` 声明 `host_capabilities: ["llm.sample"]`，请求携带 `invoke_id` 以便关联与限额。
- **binary archive**：Executa 的发布形态。每个平台一个 archive，根目录 `manifest.json` 指定 entrypoint 与权限，Agent 按平台 key 选择对应 asset 安装，最终用户无需安装 Node。

## 常用命令速查

```bash
npm install
npm run build                 # 前端 bundle
npx anna-app validate --strict
npm run dev                   # anna-app dev --no-llm（UI harness）
npm run executa:mock          # anna-app executa dev --mock-sampling（后端 sampling）
npm run test:protocol         # 手动协议测试（伪 host + transcript）
npm test                      # 身份一致性 + 前端边界检查 + 协议测试
npm run package:binary        # 本机二进制 archive
```

# dsh-mock-interview

DeepSeek Harness 插件：**模拟技术面试官**。把简历和目标岗位喂进去，它会按真实面试的节奏连问你——八股、简历项目深挖、手撕代码、行为面——支持文字和语音作答，每题给分并指出「哪句答错、缺什么、怎么补」，最后导出一份可复盘的 Markdown 报告。

> 当前状态：**G1 工程骨架**。已具备：侧边栏入口 + 独立面试页 + host/client 双半 + RPC 契约 + `ping` 连通性自检。面试流程按 `docs/test-plan.md` 逐用例实现。

## 为什么要有它

背题库练不出临场反应。真实面试的难点是：追问到你答不上来、项目细节被戳穿、白板上写不出边界条件。这个插件就专门做这件事——它有自己的上下文，不占用、也不污染你日常和主 agent 的对话。

## 安装（本地开发版）

插件以 `link:` 方式挂进 profile，和 `dsh-collections` 同样的装法：

```bash
# 1. 链接到 profile 的依赖里
#    ~/.dsh/profiles/<profile>/package.json
#    "dependencies": { "dsh-mock-interview": "link:D:/project/02-plugins/dsh-mock-interview" }
#    "dsh": { "profile": { "bundles": [ ..., "dsh-mock-interview" ] } }

# 2. 安装并重启 DSH Web 端
```

装好后侧边栏出现「模拟面试」图标，点开即是面试页；页面上的**连通性自检**能一键确认 host 半是否在线。

## 命令

| 命令 | 作用 |
|---|---|
| `npm install --no-audit --no-fund` | 安装（零运行时依赖、零 devDependencies） |
| `npm run build` | `node --check`：源码即产物，无打包步骤 |
| `npm run lint` | 语法 + 契约一致性门禁（`scripts/contract-lint.mjs`） |
| `npm test` | 单元 + 集成测试（`node --test`） |
| `npm run e2e` | 打包契约 e2e |
| `npm run coverage` | 覆盖率，核心 `lib/**` ≥ 85% 否则失败 |

## 结构

```
index.js              host 半：RPC 端点、调度、错误信封
client.js             Web 半：侧边栏图标 + main 页面
lib/contracts.js      action 表 / 错误码表 / schema 版本（三方消费，禁止漂移）
scripts/contract-lint.mjs   lint：语法 + 契约 + 双半接线
tests/{unit,integration,e2e}
docs/                 需求卡、ADR、用例表、验收清单、交付报告
```

## 能力边界（诚实版）

- **手撕代码不做真实执行**：用 LLM 静态评审 + 边界用例推演，报告会强制标注「未真实执行」。理由与后续计划见 `docs/adr/0004`。
- **语音可能降级**：TTS 走浏览器内置 `speechSynthesis`；语音转写需要你自备 OpenAI 兼容 ASR 端点，没配就只用文字作答，界面会说明原因，不会假装能听。
- **评分不是考试分数**：它给的是「哪里答得薄、下一步练什么」，同一答案重复评分会有小幅波动，波动过大时报告会标注。

## 隐私

简历与报告只存在本机 `$DSH_HOME/storages/dsh-mock-interview/`；录音不落盘（内存中转，转写完成即丢）。使用时简历内容会发给你自己配置的 LLM provider——插件首次使用会提示这一点。

## 协议

本项目按 `D:\project\04-docs\ai-coding-protocol.md` 的 L3 流程推进，章程见 `D:\project\04-docs\mock-interview-charter.md`。

## License

MIT
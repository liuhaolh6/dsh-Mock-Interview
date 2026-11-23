# dsh-mock-interview

DeepSeek Harness 插件：**模拟技术面试官**。把简历和目标岗位喂进去，它会按真实面试的节奏连问你——八股、简历项目深挖、手撕代码、行为面——支持文字和语音作答，每题给分并指出「哪句答错、缺什么、怎么补」，最后导出一份可复盘的 Markdown 报告。

> 当前状态：**v0.2 B3 — 题库外置与出题质量**（B1 记录 CRUD、B2 存储迁移已完成）（v0.1.0 已交付并打点，见 [docs/delivery-report.md](docs/delivery-report.md)；人工验收见 [docs/acceptance.md](docs/acceptance.md)）。v0.2 排期见 [mock-interview-roadmap-v0.2.md](../../04-docs/mock-interview-roadmap-v0.2.md)。
> 已实现：`lib/profile.mjs`（简历+JD → 画像）、`lib/session.mjs`（按时长定额、按本人技能/项目定靶）、
> `lib/director.mjs`（按难度定措辞、结论式回答追问一次）、`lib/scorer.mjs`（六维评分 + 适用维度平均 + 越界钳制 + 无证据重试 + 空答 0 分）、
> `lib/code-review.mjs`（手撕静态评审 + 5 条边界推演，恒 `executed:false`）、`lib/store.mjs`（原子写、2 MB 写前拦截、批量删除）、
> `lib/history.mjs`（记录改名/标签/备注、搜索筛选、排序分页）、`lib/migrate.mjs` 与 `lib/index-cache.mjs`（v1→v2 视图迁移、写前一次性备份、列表索引缓存）、`lib/bank.mjs`（外置题库按岗位关键词排序）、`lib/report.mjs`（六维雷达 + Top3 短板 + Markdown 导出）。
> 共 **151 条测试全绿**，用例与覆盖矩阵见 [`docs/test-plan.md`](docs/test-plan.md)。题库数据在 [`data/bank.json`](data/bank.json)（改题目不用改代码）。已暴露的 RPC 动作 **11 个**（`ping`、`profile/extract`、`session/create|get|list|update|delete|finish`、`turn/answer`、`code/review`、`report/export`），
> 契约 lint 强制 `ACTIONS` 与 dispatch 双向一致。

## 为什么要有它

背题库练不出临场反应。真实面试的难点是：追问到你答不上来、项目细节被戳穿、白板上写不出边界条件。这个插件就专门做这件事——它有自己的上下文，不占用、也不污染你日常和主 agent 的对话。

## 安装（本地开发版）

插件以 `link:` 方式挂进 profile，和 `dsh-collections` 同样的装法：

1. 编辑 `C:\Users\<你>\.dsh\profiles\<profile>\package.json`：

```jsonc
"dependencies": {
  "dsh-mock-interview": "link:D:/project/02-plugins/dsh-mock-interview"
},
"dsh": { "profile": { "bundles": [ /* ... */, "dsh-mock-interview" ] } }
```

2. 用 DSH 自带的 pnpm 装一次（PATH 上没有 pnpm 时）：

```bash
cd "C:/Users/<你>/.dsh/profiles/<profile>"
node "D:/agent/DeepseekHarness/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs" install --prefer-offline
# → + dsh-mock-interview 0.1.0 <- D:\project\02-plugins\dsh-mock-interview
```

3. **重启 DSH Web 端**（bundle 只在启动时装配）。装好后侧边栏出现「模拟面试」图标，点开即是面试页；页面上的**连通性自检**能一键确认 host 半是否在线。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run build` | `node --check` 三个入口文件（`index.js` / `client.js` / `lib/contracts.js`） |
| `npm run lint` | 契约 lint：语法、`ACTIONS` ↔ dispatch switch 双向比对、错误码表、两条半边的 RPC 常量一致 |
| `npm test` | 单元 + 集成测试（`node --test`） |
| `npm run e2e` | 打包契约 e2e |
| `npm run coverage` | 覆盖率，核心 `lib/**` ≥ 85% 否则失败 |

S5 报告导出：`session/finish` 幂等、`report/export` 只写工作目录内、撞名加后缀（上限 99），未考察维度不拉低总分。

## 验证状态（2026-11-23，v0.2 B1 收口）

Node `v24.20.0` / npm `11.19.0` 下实跑（每列都是当轮实测输出，不是推算）：

| 命令 | G4 S6b 返修 | G5 交付（v0.1.0） | **v0.2 B1（当前）** |
|---|---|---|---|
| `npm run build` | 通过 | 通过 | 通过 |
| `npm run lint` | 0 error / 0 warning，31 文件 | 0 error / 0 warning，33 文件 | `0 error(s), 0 warning(s), 36 file(s) scanned` |
| `npm test` | 114 passed | 119 passed | **132 passed / 0 failed / 0 skipped** |
| `npm run e2e` | 6 passed | 6 passed | **6 passed** |
| `npm run coverage` | 行 98.78% / 分支 85.85% | 行 98.80% / 分支 86.25% | **行 98.82% / 分支 87.22% / 函数 96.32%** |

活体（真机 Web 端 RPC）：十项动作在 v0.1.0 收口时逐条通过（`turn/answer` 5 173–7 713 ms 真模型出分）。
v0.2 新增的 `session/update` 与批量删除、筛选列表**尚未在真机上点验**——本批只跑过单元/集成测试，
按纪律记为「未验证」，等你重启 Web 端后我再补这一栏。

**未验证**：v0.2 B1 的记录页 UI 没有真人完整点过（改名/标签/批量删除的交互）；`report/export` 只在本机 Windows 路径验证过。

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

仓库：<https://github.com/liuhaolh6/dsh-Mock-Interview>　需要 Node `^22.19.0 || >=24.0.0`。

## License

MIT
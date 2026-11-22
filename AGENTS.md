# AGENTS.md — dsh-mock-interview

本仓库是 DSH 插件工程。与 `D:\project\AGENTS.md`、`~/.dsh/AGENTS.md` 叠加生效，冲突时以本文件为准。

## 一句话

**先契约、后测试、再实现。一条用例一轮，绿灯才提交。**

## 命令（唯一判断「跑通」的依据）

```bash
npm install --no-audit --no-fund   # 零依赖，秒装
npm run build                      # node --check，源码即产物
npm run lint                       # 语法 + 契约 + 双半接线，必须 0 error
npm test                           # 单元 + 集成
npm run e2e                        # 打包契约
npm run coverage                   # 核心 lib/** ≥ 85%
```

- 包管理器固定 **npm**，不要引入 pnpm / yarn / 任何第三方运行时依赖。
- `client.js` 的 React 由宿主 `require('react')` 提供，**不要**打包或自带。

## 目录约定

- 可单测的纯逻辑放 `lib/*.mjs`；`index.js` 只做接线与调度；`client.js` 只做 UI，不放业务规则。
- 文件名 **kebab-case**；测试 `tests/<layer>/<module>.test.mjs`，用例 ID 前缀 `TC-<域>-<号>`。
- 文档进 `docs/`：`requirements/` `adr/` `test-plan.md` `acceptance.md` `delivery-report.md`。

## 契约纪律

- action 表与错误码只认 `lib/contracts.js`：新增 action = 先加表 + 加用例 + 加 `case`，`npm run lint` 会把三方不一致直接判红。
- 错误码格式 `E_XXX`，一律走 `{ ok: false, error: { code, message } }` 信封，HTTP 恒 200。
- 禁止在契约里留 TBD。

## 禁止

- 禁止执行用户提交的代码（无沙箱），手撕题只做静态评审并在结果里标注「未真实执行」。
- 禁止把密钥、简历内容、音频写进日志或报告。
- 禁止改动宿主 checkout（`D:\agent\DeepseekHarness\...`）与其它插件目录。
- 禁止为了让测试变绿而修改测试。

## 提交

Conventional Commits + 用例 ID：`feat(director): 按难度曲线选题 (TC-DIR-003)`。单轮 diff ≤ 200 行、只推进一条用例。
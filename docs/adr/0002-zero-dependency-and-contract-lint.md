# ADR-0002 零运行时依赖，用契约 lint 替代 typecheck

- 状态：已接受（2026-11-23）
- 影响：工具链、CI 命令、代码组织

## 背景

插件在宿主进程内运行，宿主已提供 React、Cordis、模型与存储服务。协议要求每轮贴出 install / build / lint / test 的真实输出，并要求「lint 0 error」与覆盖率门槛。

## 决策

1. 运行时与 devDependencies **都为 0**：测试用内置 `node:test`，覆盖率用 `--experimental-test-coverage`，HTTP 用全局 `fetch`/`Request`/`Response`。
2. 不引入 TypeScript：没有编译器就没有 typecheck 步骤，换成 `scripts/contract-lint.mjs` 的三条机械检查——全部源文件 `node --check`、`lib/contracts.js` 的 ACTIONS 与 `index.js` 的 dispatch switch 双向一致、错误码与 RPC 路径在 host/client 两侧一致。
3. `build` 只是语法门禁：源码即产物，宿主直接加载。

## 后果

- 好：`npm install` 秒级、无供应链面、CI 成本近零；契约漂移在提交前就被拦下（这是本项目最可能犯的错）。
- 代价：没有类型系统，字段误用靠测试与 review；lint 只覆盖「已知会错的三类」，不是通用静态分析。
- 触发复审的条件：`lib/` 出现 >8 个模块或数据结构变更频繁时，重新评估是否引入 JSDoc + `tsc --checkJs`。
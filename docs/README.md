# 文档索引

| 文件 | 内容 | 阶段 |
|---|---|---|
| `requirements/RC-001-mock-interview.md` | 需求卡：8 条 GWT 验收标准、非目标、假设与影响面 | G0 |
| `adr/0001-standalone-panel-over-main-conversation.md` | 为什么面试页独立于主会话 | G1 |
| `adr/0002-zero-dependency-and-contract-lint.md` | 零依赖，用契约 lint 替代 typecheck | G1 |
| `adr/0003-file-storage-not-storagedomain.md` | 会话持久化选文件而非 storageDomain | G1 |
| `adr/0004-no-code-execution-in-v1.md` | 手撕代码只做静态评审 | G1 |
| `adr/0005-voice-tts-browser-asr-external.md` | 语音：浏览器 TTS + 自备 ASR，未配置则降级文字 | G4 |
| `contracts.md` | RPC 契约 v1：传输、数据结构、10 个动作、13 个错误码、八问核对 | G2 |
| `test-plan.md` | 用例表与覆盖矩阵（正常 / 边界 / 异常） | G3 |
| `acceptance.md` | 人工验收 10 步（含语音降级、断线续考） | G3 |
| `delivery-report.md` | 交付报告（协议附录 A.7） | G5 |

上游文档（不在本仓库）：

- 章程：`D:\project\04-docs\mock-interview-charter.md`
- 开发协议：`D:\project\04-docs\ai-coding-protocol.md`
# 人工验收清单

> 来源：`D:\project\04-docs\mock-interview-charter.md` §9「验收与发布」。
> 判定：每条都要有**可复现的观察**，不写「应该没问题」。
> 最近一次执行：2026-11-23（G5）。

## 前置

```bash
# 1) 宿主侧挂载（只需一次）
#    C:\Users\刘浩\.dsh\profiles\desktop\package.json 中：
#    dependencies["dsh-mock-interview"] = "link:D:/project/02-plugins/dsh-mock-interview"
#    dsh.profile.bundles 末尾追加 "dsh-mock-interview"
node "D:/agent/DeepseekHarness/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs" install --prefer-offline
# 2) 重启 Web 端；3) 浏览器开 GUI
```

## 十条

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 1 | 左侧栏出现「模拟面试」图标，点开 | 打开独立整页，标题「模拟面试」，不抢主会话面板 | ✅ 2026-11-23 |
| 2 | 页面右下角/顶部连通性按钮 | `ping` 返回 `version 0.1.0`、`schemaVersion 1` | ✅ 2026-11-23（活体 curl 同证） |
| 3 | 粘贴简历 + JD，点「解析简历与岗位」 | 数秒内出现可编辑画像（技能、年限、项目、岗位级别） | ✅ 2026-11-23（RPC 活体 1.8 s） |
| 4 | 时长 / 面试类型 / 难度三组选择 | 文字与底色对比清晰，选中态一眼可辨 | ✅ 2026-11-23（曾被报「白底白字」，已修） |
| 5 | 确认画像 → 开始面试 | 进第一题，显示「第 1 / N 题」与题型徽标 | ✅ 2026-11-23（RPC 层 5 题计划） |
| 6 | 用文字答一题并提交 | 出六维评分卡、总分、verdict；不足时给追问 | ✅ 2026-11-23（真模型 5.3–7.7 s） |
| 7 | 手撕题：选择题语言，贴代码提交 | 明确标注「未真实执行」，给 5 条边界用例推演 | ✅ 2026-11-23（`executed:false`、`cases:5`） |
| 8 | 点「语音作答」 | 不假装录音，直接说明未配置 ASR 并引导改用文字 | ✅ 2026-11-23（TC-VOI-002 客户端） |
| 9 | 最后一题结束 → 报告 | 摘要 + 六维雷达 + Top3 短板与改进建议，未考察维度显示为「未考察」而非 0 分 | ✅ 2026-11-23 |
| 10 | 报告页填导出目录 → 导出 | 生成 Markdown，落在指定目录；重复导出不覆盖 | ✅ 2026-11-23（回退到 `D:/project/04-docs/interview-reports`） |

## v0.2 新增功能的验收（2026-11-23）

对应排期四批，逐条给出「怎么验」与「现在验到哪一步」。

| 项 | 手工验收路径 | 自动化证据 | 状态 |
|---|---|---|---|
| 记录列表 | 侧栏打开插件 → 「我的记录」→ 看到历次面试，含标题、模式、难度、题数、分数 | TC-HIS-100..105 | ✅ 自动化；UI 待人工复点 |
| 改名/标签/备注 | 某行「改名」→ 改标题与标签 → 保存 → 刷新仍在 | TC-HIS-101 | ✅ 自动化；UI 待人工复点 |
| 搜索与筛选 | 搜索框输入关键词；状态胶囊切「未完成」 | TC-HIS-104 | ✅ 自动化 |
| 批量删除 | 勾选两条 → 「删除所选」→ 确认 → 列表少两条 | TC-HIS-105 | ✅ 自动化；二次确认由 UI 负责 |
| 从历史续考 | 未完成记录点「继续」→ 回到当前题，已答的题不重复计分 | TC-HIS-104（幻影 turn 检测） | ✅ 自动化；UI 待人工复点 |
| 旧数据可读 | 放一份 v1 会话 JSON 进目录 → 列表正常、详情正常 | TC-MIG-001..005 | ✅ 自动化 |
| 题库可改 | 改 data/bank.json 加一题 → 重启宿主 → 新题进入计划 | TC-BNK-003、TC-BNK-006 | ✅ 自动化（自定义路径） |
| 连答两次空白 | 连续两次空提交 → 自动进入下一题，不卡在同一题 | TC-BNK-101、TC-DIR-006 | ✅ 自动化 |
| JSON 导出 | 报告页选 JSON → 导出 → 文件是 .json 且能被编辑器解析 | TC-REP-007 | ✅ 自动化；UI 待人工复点 |
| 报告可复盘 | 打开导出的 Markdown → 每题有你的回答、扣分依据、参考解 | TC-REP-010 | ✅ 自动化 |
| 列表导出不污染 | 在列表里导出旧记录 → 该记录仍在「未完成」状态 | TC-REP-011 | ✅ 自动化 |

**仍未人工验证**：以上 UI 路径没有一次「真人连续点击」的完整复核（宿主每次改代码都要重启 Web 端，端口会变）。这一条如实留在「未覆盖」里，不因自动化通过而勾销。

## v0.3 体验打磨验收（2026-11-23）

| # | 验收项 | 证据 | 判定 |
| --- | --- | --- | --- |
| C1-1 | 任一失败操作显示人话标题与下一步，不再只有错误码 | `lib/messages.mjs` 14 码表；`ping` 之外的失败信封含 `hint`（TC-MSG-010..013） | ✅ |
| C2-1 | 答题页显示第 n / total 题与已答数 | `progressOf`（TC-INS-001..004）+ `session/get` 带 `progress`（TC-INS-010） | ✅ |
| C2-2 | 用时每秒走字、平均分随作答更新 | 面板 `setTick` 计时；分数字段来自 `progress.avgScore` | ✅（源码级） |
| C3-1 | 空记录页给出「先面一场」的单一动作 | `emptyReason: 'none'` + CTA 按钮（TC-ONB-010） | ✅ |
| C3-2 | 筛选无结果时提示「清空筛选」而不是「还没有记录」 | `emptyReason: 'filtered'`（TC-ONB-010） | ✅ |
| C3-3 | 画像不完整时开始按钮禁用并说明原因 | `readiness`（TC-ONB-011）+ 面板 `canStart` 取自输入框 | ✅（源码级） |
| C4-1 | Ctrl/⌘+Enter 提交，输入法组合期不误发 | TC-UX-001/002 | ✅（源码级） |
| C4-2 | Tab 可到每个按钮，焦点有可见环 | TC-UX-003/004 | ✅（源码级） |
| C5-1 | 记录页显示场次 / 已完成 / 进行中 / 平均分 | `statsOf`（TC-INS-005）+ `session/list`（TC-INS-011） | ✅ |
| C5-2 | 最近 10 场分数趋势可见 | `trendOf`（TC-INS-006/007） | ✅ |
| C6-1 | 深色 / 浅色下文字均达 4.5:1 | TC-THM-001..003（算术断言） | ✅ |
| C6-2 | 面板不再写死语义色 | `--mi-*` + lint 禁止旧值回流 | ✅ |
| C7-1 | 长报告可逐题折叠 | TC-UX-006 | ✅（源码级） |
| C7-2 | 一键复制与导出同源的 Markdown | `report/preview`（TC-REP-012）+ TC-UX-007 | ✅ |

## v0.4 D1 语音作答验收（2026-11-23）

| # | 验收项 | 证据 | 结论 |
| --- | --- | --- | --- |
| D1-1 | 未配端点时录音按钮给出「还没有配置语音转写端点」并指到设置，不报堆栈 | `asr/transcribe` → `E_ASR_NOT_CONFIGURED`（TC-ASR-010，`fetch` 零调用） | ✅ |
| D1-2 | 配好端点后说一段中文能拿回转写文字 | 转发层 TC-ASR-001/002/011（注入 fetch，参数与字节原样） | ✅（源码级；**未在真机收音**） |
| D1-3 | 密钥不在面板回显 | `publicAsrConfig` + `maskKey`（TC-ASR-006/014） | ✅ |
| D1-4 | 音频不落盘、不进会话文件 | TC-ASR-013 目录只剩 `asr.json`；`voice.test.mjs` 正则守会话里无 `audio|base64|blob` | ✅ |
| D1-5 | 超过 8 MB 或 120 s 在本地就拒绝，不消耗端点配额 | TC-ASR-005/013（发送前抛 `E_BAD_REQUEST`） | ✅ |
| D1-6 | 端点挂了能重试，文案是人话 | TC-ASR-012（`E_ASR_FAILED` + `hint.retryable`） | ✅ |

**仍未人工验证**：真的对着麦克风说一段、看转写文字落进作答框——需要重启 Web 端并在面板里配一个真实端点。

## v0.4 D2 记录复用与归档验收（2026-11-23）

| # | 验收项 | 证据 | 结论 |
| --- | --- | --- | --- |
| D2-1 | 记录行「再面一次」沿用同一画像与设置、从零开始 | TC-HIS-210（新 id、`turns` 清空、`tags` 清空） | ✅ |
| D2-2 | 再面一次的题单至少换掉一半，不是背上一场 | TC-HIS-211（重复 ≤ ⌊n/2⌋，最后一题仍手撕） | ✅ |
| D2-3 | 显式时长/难度优先于继承值；未知来源给 `E_SESSION_NOT_FOUND` | TC-HIS-212 | ✅ |
| D2-4 | 归档后默认列表与统计都不再算它 | TC-HIS-222、TC-HIS-202 | ✅（源码级） |
| D2-5 | 勾「只看归档」能找回归档的场次 | TC-HIS-222（`archived:'only'`） | ✅（源码级） |
| D2-6 | 归档只是标签，`schemaVersion` 仍是 2、旧文件不用迁移 | TC-HIS-201、`docs/contracts.md` §3.11 | ✅ |
| D2-7 | 「导出全部历史」得到可解析、可再导入的 JSON 包 | TC-HIS-220/221（含 `plan.items`） | ✅ |

**仍未人工验证**：在真机记录页把「再面一次 / 归档 / 导出全部历史」各点一遍。

## v0.4 D3 手撕语言化评审验收（2026-11-23）

| # | 验收项 | 证据 | 结论 |
| --- | --- | --- | --- |
| D3-1 | 六种语言各有自己的检查点，不是同一套泛泛而谈 | TC-COD-201（`LANGUAGES` 六项、每项 ≥3 条、两两集合不同） | ✅ |
| D3-2 | 检查点真的进了 system prompt（Java 空引用/溢出、Go nil/defer、SQL NULL/索引/事务） | TC-COD-202 | ✅ |
| D3-3 | 边界用例按该语言习惯构造（python 用 `None`、`c++` 指向越界与内存） | TC-COD-203 | ✅ |
| D3-4 | 别名归一（`js`/`py`/`golang`/`cpp`/`C++11`/`mysql`…）与大小写无关 | TC-COD-204 | ✅ |
| D3-5 | 未知语言不报错：回退通用检查点、`language==='generic'`、`warnings` 点名原语言 | TC-COD-204、TC-COD-206 | ✅ |
| D3-6 | 语言进了评分证据首行，报告脱离会话也知道按什么标准评的 | TC-COD-205 | ✅ |
| D3-7 | 面板语言胶囊的取值与宿主 `LANGUAGES` 逐项相等（标签显示 `Java`/`C++` 等，值仍是 canonical 串） | `scripts/contract-lint.mjs` 输出 `contract: 6 language(s) match between panel and reviewer` | ✅ |
| D3-8 | 缺省语言（旧客户端不传 `language`）仍能评审 | TC-EDG-018（契约变更后断言 `language==='generic'`） | ✅ |

**仍未人工验证**：在真机用 Java 与 Go 各提交一段代码，肉眼确认两次的边界用例列不是同一套。

## v0.4 D4 自定义题库验收（2026-11-23）

| 编号 | 验收动作 | 判定标准 | 结果 |
| --- | --- | --- | --- |
| D4-1 | `bank/validate` 提交一份 3 条题库 | 返回 `count: 3` 与四项 `kinds` 计数，`warnings` 为空 | ✅ 源码级 + 单测 TC-BNK-201 |
| D4-2 | 提交 `kind: 'essay'` 的条目 | `E_BAD_REQUEST`，文案含「第 1 条」与四个合法值 | ✅ 单测 TC-BNK-203 |
| D4-3 | 提交 200 条题库 | `E_BAD_REQUEST`，文案含上限 120，不被静默截断 | ✅ 单测 TC-BNK-204 |
| D4-4 | `bank/save` 后看磁盘 | 文件落在 `$DSH_HOME/storages/dsh-mock-interview/bank.json`，无 `.tmp-*` 残留 | ✅ 集成 TC-BNK-210 |
| D4-5 | 保存后新建面试 | `plan.bankSource === 'custom'`，题单含自定义题目，最后一题仍是手撕 | ✅ 集成 TC-BNK-210 |
| D4-6 | 手工改坏自定义题库再新建面试 | 回退内置题库且 `bankWarning` 说明；面试正常开始 | ✅ 集成 TC-BNK-212 |
| D4-7 | `bank/reset` 两次 | 第一次 `removed: true`，第二次 `false`（幂等） | ✅ 集成 TC-BNK-210 |
| D4-8 | 面板折叠区三个按钮 | setup 首屏可渲染 `bank.title/hint/check/save/reset` | ✅ e2e TC-UX-013 |

仍未人工验证：在真机面板里粘贴一份题库、点「校验」「保存并启用」，再新建一场面试确认题目来自自定义题库。

## 真机验证：语音 / 题库 / 出题（2026-11-24，宿主 v0.4.0，端口 49165）

由 agent 用 RPC 逐条跑通（等价于面板点击的宿主侧），结果与偏差：

| 编号 | 动作 | 结果 |
| --- | --- | --- |
| V-1 | 未配端点时转写 | `E_ASR_NOT_CONFIGURED`，`hint.retryable:false`，文案指向「配端点或改用文字」 ✅ |
| V-2 | 写端点配置 | 返回 `hasKey:true` + `keyMask:"sk-m…7890"`，**不回传明文 Key**；落盘 `$DSH_HOME/storages/dsh-mock-interview/asr.json` ✅ |
| V-3 | 部分更新（只换 model） | Key 保留、掩码不变 ✅ |
| V-4 | 真实转写（起了一个本地 mock 端点） | `{text:"这是我从语音转写出来的一句话"}`，首尾空白被折叠；mock 收到 `/v1/audio/transcriptions`、`multipart/form-data`、`model` 段、`file` 段 `audio/webm`、音频字节原样 ✅ |
| V-5 | 端点返回空文本 | `E_ASR_FAILED`「语音转写返回了空文本」，可重试 ✅ |
| V-6 | 端点不可达 | `E_ASR_FAILED`「转写端点调用失败：fetch failed」，`retryable:true` ✅ |
| V-7 | 非法容器 / 超 120 秒 | 均 `E_BAD_REQUEST`，文案点名可选容器与 120 秒上限 ✅ |
| V-8 | 清空配置 | `hasKey:false`，`asr.json` 已删除（目录只剩 `sessions/`） ✅ |
| V-9 | 校验并保存 3 题题库 | 校验 `count:3`、`kinds {skill:1,project:1,behavior:0,code:1}`；保存后 `bank/get` 显示 `active.source:"custom"` ✅ |
| V-10 | 保存后的返回摘要 | ❌ 偏差：`kinds` 全是 0（已修，TC-BNK-213） |
| V-11 | 新建面试取题 | `plan.bankSource:"custom"`，题面出现「自定：Redis 大 Key 怎么拆」「自定：订单中心幂等设计复盘」✅ |
| V-12 | 最后一题的类型 | ❌ 偏差：最后一条靶子是 `skill:MySQL` 却标成 `kind:"code"`，且与倒数第二位重复（已修，TC-SES-008/009/010） |
| V-13 | 手撕题评审（`code/review`） | ❌ 偏差：真机 20 778 ms 后 `E_LLM_UNAVAILABLE`「模型输出被截断（max-tokens）」——评审 JSON 撑破了 4096 token（已修：评审专用 6144 + 提示词压篇幅，TC-COD-207） |

仍未验证（需要人）：浏览器 `MediaRecorder` 真录音（麦克风权限、webm 头）、滚轮手感、以及修复后在真机上重看 `kinds` 与最后一题。

## 返修：面板滚轮（2026-11-24）

| 编号 | 验收动作 | 判定标准 | 结果 |
| --- | --- | --- | --- |
| F-1 | 在模拟面试页面用滚轮上下滚 | 内容随滚轮移动，页面底部（含折叠区）能看到 | ⬜ 待真机复验 |
| F-2 | 记录页、答题页、报告页同样滚动 | 三个阶段都能滚到底 | ⬜ 待真机复验 |

源码级证据：TC-UX-014（根节点 `height:100%` + `minHeight:0` + `overflowY:auto` + `border-box`），且在修复前版本上实测为红。

## 未覆盖（诚实记录）

- **完整 UI 全流程一次跑通**：第 6–10 步的 RPC 语义已用活体探针逐条验证，页面交互由用户点验到「选项可读 + 页面打开」；从录入到导出的连续点击尚未由人完整走完一轮。
- **多显示器 / 缩放**：未测。
- **非 Java 手撕**：语言选择已加，但只用 Java 做过真机评审。

## 回滚

- 去掉 profile 里 `dsh-mock-interview` 的依赖与 bundle 条目，`pnpm install` 后重启即可回到「未安装」。
- 数据在 `$DSH_HOME/storages/dsh-mock-interview/sessions/*.json`，插件卸载不会自动删；不需要时手动删目录。
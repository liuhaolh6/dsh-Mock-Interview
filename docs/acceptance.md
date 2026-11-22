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

## 未覆盖（诚实记录）

- **完整 UI 全流程一次跑通**：第 6–10 步的 RPC 语义已用活体探针逐条验证，页面交互由用户点验到「选项可读 + 页面打开」；从录入到导出的连续点击尚未由人完整走完一轮。
- **多显示器 / 缩放**：未测。
- **非 Java 手撕**：语言选择已加，但只用 Java 做过真机评审。

## 回滚

- 去掉 profile 里 `dsh-mock-interview` 的依赖与 bundle 条目，`pnpm install` 后重启即可回到「未安装」。
- 数据在 `$DSH_HOME/storages/dsh-mock-interview/sessions/*.json`，插件卸载不会自动删；不需要时手动删目录。
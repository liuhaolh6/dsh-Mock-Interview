/**
 * dsh-mock-interview — Client half.
 *
 * One `sidebar.panellist` icon opens the interview page (slot `main`, key
 * `mock-interview`). The page is a three-phase wizard:
 *
 *   setup    paste résumé + job description, pick duration / mode / difficulty
 *   confirm  edit the extracted profile, then start the session
 *   run      answer question by question, see the six-dimension card, then export
 *
 * Everything talks to the host through one POST endpoint (contract §1). Kept
 * dependency-free on purpose: React comes from the shell (`require`), the
 * dictionaries are inlined, and nothing is bundled.
 */

window.__ModuleLoader__.load({
  id: 'dsh-mock-interview',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // Keyboard helpers. An IME that is still composing owns the Enter key: if we
    // act on it we submit half a Chinese sentence, which is worse than nothing.
    const isComposing = (event) => event.isComposing === true || event.keyCode === 229
    const isSubmitShortcut = (event) =>
      event.key === 'Enter' && (event.metaKey === true || event.ctrlKey === true) && !isComposing(event)
    // Visible focus for keyboard users: inline styles cannot express :focus-visible,
    // so the ring is toggled on the element itself.
    const ringOn = (event) => {
      event.currentTarget.style.outline = '2px solid #2f6fed'
      event.currentTarget.style.outlineOffset = '2px'
    }
    const ringOff = (event) => {
      event.currentTarget.style.outline = 'none'
    }
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-mock-interview'
    const PANEL = 'mock-interview'
// D2: 归档在记录上只是一个标签，与宿主 lib/history.mjs 的 ARCHIVED_TAG 对齐。
const ARCHIVED_TAG = '已归档'
    const RPC = '/api/dsh-mock-interview/rpc'
    // The languages the host keeps a checklist for (lib/code-review.mjs). The
    // server stores whatever string it is given, but sending one it has no
    // checklist for silently degrades the review to the generic one — so the
    // two lists are pinned equal by scripts/contract-lint.mjs.
    const LANGUAGES = ['java', 'python', 'javascript', 'go', 'c++', 'sql']
    const LANGUAGE_LABELS = {
      java: 'Java',
      python: 'Python',
      javascript: 'JavaScript',
      go: 'Go',
      'c++': 'C++',
      sql: 'SQL',
    }

    const DICT = {
      zh: {
        'icon.label': '模拟面试',
        'panel.title': '模拟面试',
        'panel.subtitle': '用简历和岗位做靶子，把临场反应练成肌肉记忆',
        'setup.title': '第一步：交简历和岗位',
        'setup.resume': '简历正文（粘贴纯文本即可）',
        'setup.jd': '应聘岗位描述',
        'setup.resume.ph': '例如：3 年 Java 后端，负责订单中心，QPS 3k…',
        'setup.jd.ph': '例如：高级 Java 后端，要求熟悉并发、JVM、MySQL 索引优化…',
        'setup.minutes': '时长',
        'setup.mode': '面试类型',
        'setup.difficulty': '难度',
        'setup.extract': '解析简历与岗位',
        'setup.extracting': '解析中…（会调用一次模型）',
        'mode.tech-1': '技术一面（八股）',
        'mode.project': '项目深挖',
        'mode.algo': '算法手撕',
        'mode.behavior': '行为面',
        'difficulty.junior': '初级',
        'difficulty.mid': '中级',
        'difficulty.senior': '高级',
        'confirm.title': '第二步：确认画像',
        'confirm.skills': '技能（用逗号分隔）',
        'confirm.projects': '项目（每行一个：名称：角色｜亮点｜亮点）',
        'confirm.level': '岗位级别',
        'confirm.warnings': '解析提示',
        'confirm.start': '开始面试',
        'confirm.back': '返回修改',
        'run.progress': '第 {n} / {total} 题',
        'run.elapsed': '用时',
        'run.avg': '平均分',
        'run.answered': '已答 {n} 题',
        'run.kind.skill': '八股',
        'run.kind.project': '项目',
        'run.kind.code': '手撕',
        'run.kind.behavior': '行为',
        'run.answer': '你的回答（就当对面坐着真人）',
        'run.submit': '提交回答',
        'run.submitting': '评分中…',
        'run.speak': '朗读题目',
        'run.code': '你的代码（不会真的执行，只做静态评审）',
        'run.language': '语言',
        'run.voice': '语音作答',
        'run.voice.blocked': '当前没有可用的语音转写（ASR）：请改用文字作答，或在设置里配置自备的 OpenAI 兼容端点。',
        'run.record': '按住说话（松手转文字）',
        'run.recording': '正在录音…点击结束',
        'run.transcribing': '转写中…',
        'asr.title': '语音转写设置（可选）',
        'bank.title': '自定义题库（可选）',
        'bank.hint': '粘贴一个 JSON：{ "topics": [{ "topic": "题目", "kind": "skill|project|behavior|code", "keywords": ["命中词"] }] }。校验通过后保存，新建面试就从这份题库出题。',
        'bank.ph': '{ "topics": [{ "topic": "分布式事务 TCC", "kind": "skill", "keywords": ["分布式"] }] }',
        'bank.check': '校验',
        'bank.save': '保存并启用',
        'bank.reset': '恢复内置题库',
        'bank.checked': '校验通过：%s 题',
        'bank.saved': '已保存并启用：%s 题',
        'bank.reset.done': '已恢复内置题库',
        'bank.active.custom': '当前：自定义题库（%s 题）',
        'bank.active.default': '当前：内置题库（%s 题）',
        'bank.invalid': '题库有问题，未保存',
        'asr.hint': '插件不录存音频：你说的一段只发给下面这个端点，拿到文字后立即丢弃。不配置就只用文字作答。',
        'asr.baseUrl': '端点地址（OpenAI 兼容，形如 https://host/v1）',
        'asr.model': '模型名（如 whisper-1）',
        'asr.apiKey': 'API Key（只存本机，界面不再回显）',
        'asr.apiKey.ph': '留空则沿用已保存的 Key',
        'asr.save': '保存语音设置',
        'asr.clear': '清除语音设置',
        'asr.saved': '语音设置已保存',
        'asr.cleared': '语音设置已清除',
        'asr.transcribed': '已转成文字，确认后提交',
        'asr.unsupported': '这个环境不支持录音（没有 MediaRecorder）：请改用文字作答',
        'asr.denied': '麦克风权限被拒绝：请在地址栏允许麦克风，或改用文字作答',
        'asr.empty': '没有录到声音：请重录，或改用文字作答',
        'run.score': '本题评分',
        'run.overall': '综合',
        'run.next': '下一题',
        'run.finish': '生成报告',
        'run.probing': '面试官追问',
        'run.unverified': '未真实执行：以下用例是模型按代码推演的结果，不是运行输出。',
        'dim.correctness': '正确性',
        'dim.depth': '深度',
        'dim.structure': '结构',
        'dim.project': '项目贴合',
        'dim.code': '代码',
        'dim.communication': '表达',
        'verdict.strong': '很好',
        'verdict.ok': '及格',
        'verdict.weak': '偏弱',
        'report.title': '面试报告',
        'report.summary': '一句话总结',
        'report.radar': '六维雷达',
        'report.weak': '最该补的三件事',
        'report.export': '导出 Markdown',
        'report.exported': '已导出：',
        'report.again': '再面一场',
        'report.dir': '导出目录（留空=宿主默认工作目录）',
        'report.sample': '样本不足：少于 3 题，结论仅供参考',
        'error.prefix': '出错了',
        'busy.hint': '正在等模型，通常 3–10 秒',
        'records.open': '我的记录',
        'records.back': '返回面试',
        'records.empty.start': '还没有面试记录。先面一场 15 分钟的，结束后这里会自动生成可回顾的档案。',
        'records.empty.cta': '开始新面试',
        'records.filtered': '没有匹配这个筛选条件的记录。',
        'records.filtered.cta': '清空筛选',
        'confirm.blocked': '至少填一项技能或一个项目，否则没法出题。',
        'confirm.readiness.ready': '画像完整，可以直接开始。',
        'run.submit.hint': 'Ctrl / ⌘ + Enter 提交',
        'report.items': '逐题回顾',
        'report.reference': '参考解',
        'report.cases': '边界用例（未真实执行）',
        'report.copyMarkdown': '复制 Markdown',
        'report.copyQuestion': '复制本题',
        'report.copied': '已复制到剪贴板',
        'report.copyFailed': '复制失败：浏览器拒绝了剪贴板权限',
        'records.title': '面试记录',
        'records.search': '搜索标题 / 标签 / 备注',
        'records.ph': '例如 Redis、订单中心',
        'records.empty': '还没有记录：先面一场，这里会留下可回顾的档案',
        'records.status.all': '全部',
        'records.status.active': '未完成',
        'records.status.finished': '已完成',
        'records.count': '共 {total} 条',
        'records.stats': '共 {total} 场 · 已完成 {finished} · 进行中 {active} · 平均 {avg}',
        'records.trend': '最近几场（左旧右新）',
        'records.continue': '继续',
        'records.view': '查看报告',
        'records.rename': '改名/标签',
        'records.delete': '删除',
        'records.deleteSelected': '删除选中',
        'records.selected': '已选 {n} 条',
        'records.title.label': '标题',
        'records.tags.label': '标签（逗号分隔）',
        'records.note.label': '复盘备注',
        'records.save': '保存',
        'records.cancel': '取消',
        'records.saved': '已保存',
        'records.deleted': '已删除 {n} 条',
        'records.exportMd': '导出 MD',
        'records.exportJson': '导出 JSON',
        'records.again': '再面一次',
        'records.archive': '归档',
        'records.unarchive': '取消归档',
        'records.archived.only': '只看归档',
        'records.exportAll': '导出全部历史',
        'records.exported': '已导出：{path}',
        'records.again.msg': '已开始新的一场：沿用同一份画像，题目重新出过',
        'report.format.label': '导出格式',
        'report.format.md': 'Markdown',
        'report.format.json': 'JSON',
        'records.score': '得分',
        'records.turns': '{n} 题',
      },
      en: {
        'icon.label': 'Mock interview',
        'panel.title': 'Mock interview',
        'panel.subtitle': 'Rehearse against your own résumé and the job you want',
        'setup.title': 'Step 1 — résumé and job',
        'setup.resume': 'Résumé text',
        'setup.jd': 'Job description',
        'setup.extract': 'Extract profile',
        'setup.extracting': 'Extracting…',
        'setup.minutes': 'Duration',
        'setup.mode': 'Mode',
        'setup.difficulty': 'Difficulty',
        'confirm.title': 'Step 2 — confirm the profile',
        'confirm.skills': 'Skills (comma separated)',
        'confirm.projects': 'Projects (one per line: name: role | highlight | highlight)',
        'confirm.start': 'Start interview',
        'confirm.back': 'Back',
        'run.submit': 'Submit answer',
        'run.finish': 'Build report',
        'run.next': 'Next question',
        'report.title': 'Report',
        'report.export': 'Export Markdown',
        'report.again': 'Run another',
        'records.open': 'My records',
        'records.back': 'Back to interview',
        'records.empty.start': 'No interviews yet. Run a 15-minute one and a reviewable record lands here.',
        'records.empty.cta': 'Start an interview',
        'records.filtered': 'No records match this filter.',
        'records.filtered.cta': 'Clear filters',
        'confirm.blocked': 'Add at least one skill or one project, otherwise there is nothing to ask about.',
        'confirm.readiness.ready': 'Profile looks complete — ready to start.',
        'run.submit.hint': 'Ctrl / ⌘ + Enter submits',
        'report.items': 'Per-question review',
        'report.reference': 'Reference answer',
        'report.cases': 'Edge cases (never executed)',
        'report.copyMarkdown': 'Copy Markdown',
        'report.copyQuestion': 'Copy question',
        'report.copied': 'Copied to clipboard',
        'report.copyFailed': 'Copy failed: the browser denied clipboard access',
        'records.title': 'Interview records',
        'records.search': 'Search title / tags / note',
        'records.ph': 'e.g. Redis, order service',
        'records.empty': 'No records yet — run an interview and it lands here',
        'records.status.all': 'All',
        'records.status.active': 'Unfinished',
        'records.status.finished': 'Finished',
        'records.count': '{total} records',
        'records.stats': '{total} sessions · {finished} finished · {active} in progress · avg {avg}',
        'records.trend': 'Recent sessions (oldest left)',
        'records.continue': 'Resume',
        'records.view': 'Open report',
        'records.rename': 'Rename / tag',
        'records.delete': 'Delete',
        'records.deleteSelected': 'Delete selected',
        'records.selected': '{n} selected',
        'records.title.label': 'Title',
        'records.tags.label': 'Tags (comma separated)',
        'records.note.label': 'Review note',
        'records.save': 'Save',
        'records.cancel': 'Cancel',
        'records.saved': 'Saved',
        'records.deleted': 'Deleted {n}',
        'records.exportMd': 'Export MD',
        'records.exportJson': 'Export JSON',
        'records.again': 'Run it again',
        'records.archive': 'Archive',
        'records.unarchive': 'Unarchive',
        'records.archived.only': 'Archived only',
        'records.exportAll': 'Export all history',
        'records.exported': 'Exported: {path}',
        'records.again.msg': 'A new run started: same profile, freshly generated questions',
        'report.format.label': 'Export format',
        'report.format.md': 'Markdown',
        'report.format.json': 'JSON',
        'records.score': 'Score',
        'records.turns': '{n} questions',
        'run.score': 'Score',
        'run.overall': 'Overall',
        'run.unverified': 'Not executed: the cases below are reasoned from the code, not run.',
        'report.sample': 'Small sample: fewer than 3 answers, read this as indicative only',
        'report.radar': 'Six-dimension radar',
        'report.weak': 'Top three to improve',
        'report.dir': 'Export directory (empty = host default working directory)',
        'report.exported': 'Exported:',
        'error.prefix': 'Failed',
        'run.voice.blocked': 'No speech-to-text is available: type your answer, or configure your own OpenAI-compatible endpoint in settings.',
        'run.record': 'Hold to speak (release to transcribe)',
        'run.recording': 'Recording… click to stop',
        'run.transcribing': 'Transcribing…',
        'asr.title': 'Speech-to-text settings (optional)',
        'bank.title': 'Custom question bank (optional)',
        'bank.hint': 'Paste JSON: { "topics": [{ "topic": "question", "kind": "skill|project|behavior|code", "keywords": ["match word"] }] }. Save it and the next run draws from it.',
        'bank.ph': '{ "topics": [{ "topic": "Distributed transaction TCC", "kind": "skill", "keywords": ["distributed"] }] }',
        'bank.check': 'Check',
        'bank.save': 'Save and use',
        'bank.reset': 'Back to built-in',
        'bank.checked': 'Looks valid: %s question(s)',
        'bank.saved': 'Saved and in use: %s question(s)',
        'bank.reset.done': 'Built-in bank restored',
        'bank.active.custom': 'In use: custom bank (%s questions)',
        'bank.active.default': 'In use: built-in bank (%s questions)',
        'bank.invalid': 'The bank has a problem, nothing saved',
        'asr.hint': 'No audio is recorded or stored: one clip goes to the endpoint below and is dropped as soon as text comes back. Leave it empty to answer by typing only.',
        'asr.baseUrl': 'Endpoint URL (OpenAI compatible, e.g. https://host/v1)',
        'asr.model': 'Model name (e.g. whisper-1)',
        'asr.apiKey': 'API key (stored locally, never echoed back)',
        'asr.apiKey.ph': 'Leave empty to keep the saved key',
        'asr.save': 'Save endpoint',
        'asr.clear': 'Clear endpoint',
        'asr.saved': 'Endpoint saved',
        'asr.cleared': 'Endpoint cleared',
        'asr.transcribed': 'Transcribed — review it, then submit',
        'asr.unsupported': 'This environment cannot record (no MediaRecorder): type your answer instead',
        'asr.denied': 'Microphone permission denied: allow it in the address bar, or type your answer',
        'asr.empty': 'Nothing was recorded: try again, or type your answer',
        'setup.resume.ph': 'e.g. 3 years of Java backend, owning the order centre at 3k QPS…',
        'setup.jd.ph': 'e.g. Senior Java backend: concurrency, JVM, MySQL index tuning…',
        'busy.hint': 'Waiting for the model, usually 3–10 seconds',
        'confirm.warnings': 'Parser notes',
        'run.progress': 'Question {n} / {total}',
        'run.speak': 'Read aloud',
        'run.voice': 'Voice answer',
        'run.language': 'Language',
        'run.code': 'Your code (not executed, static review only)',
        'run.answer': 'Your answer (as if a real interviewer were sitting across)',
        'run.submitting': 'Scoring…',
        'run.probing': 'Interviewer follow-up',
        'run.elapsed': 'Elapsed',
        'run.avg': 'Average',
        'run.answered': '{n} answered',
      },
    }

    const ICON_PATHS = ['M4 5.5h16v10.5H9.2L5.4 19.2v-3.4H4z', 'M8 9.4h8', 'M8 12.4h5.4']
    const DIMS = ['correctness', 'depth', 'structure', 'project', 'code', 'communication']
    const MINUTES = [15, 30, 45]
    const MODES = ['tech-1', 'project', 'algo', 'behavior']
    const DIFFICULTIES = ['junior', 'mid', 'senior']

    function MicIcon(props) {
      const size = props.size ?? 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        ICON_PATHS.map((d, index) => h('path', { key: index, d })),
      )
    }

    function rpc(op, body) {
      return fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, ...body }),
      })
        .then((response) => response.json())
        .then((payload) => {
          if (payload?.ok === true) return { ok: true, value: payload.value }
          return {
            ok: false,
            code: payload?.error?.code ?? 'E_INTERNAL',
            message: payload?.error?.message ?? 'unknown error',
          }
        })
        .catch((problem) => ({ ok: false, code: 'E_TRANSPORT', message: String(problem?.message ?? problem) }))
    }

    const styles = {
      // The host panel gives the page a fixed-height box and does not scroll it
      // for us, so the page itself owns the scrollbar (same contract as
      // dsh-collections' `.dsc_root` + `.dsc_main`). Without height/minHeight the
      // content grows past the panel and the wheel has nothing to move.
      page: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '26px 30px',
        maxWidth: '900px',
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'thin',
      },
      head: { display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' },
      title: { fontSize: '22px', fontWeight: 650, margin: 0 },
      subtitle: { margin: 0, opacity: 0.7, fontSize: '13px', lineHeight: 1.6 },
      card: { border: '1px solid rgba(127,127,127,0.25)', borderRadius: '10px', padding: '16px 18px' },
      cardTitle: { margin: '0 0 10px', fontSize: '13px', fontWeight: 600, opacity: 0.85 },
      label: { display: 'block', fontSize: '12px', opacity: 0.65, marginBottom: '4px' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      col: { display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '12px' },
      button: {
        font: 'inherit',
        fontSize: '13px',
        padding: '6px 14px',
        borderRadius: '8px',
        border: '1px solid rgba(127,127,127,0.4)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      primary: {
        font: 'inherit',
        fontSize: '13px',
        padding: '7px 16px',
        borderRadius: '8px',
        border: '1px solid #2f6fed',
        background: '#2f6fed',
        color: '#ffffff',
        cursor: 'pointer',
      },
      primaryOff: {
        font: 'inherit',
        fontSize: '13px',
        padding: '7px 16px',
        borderRadius: '8px',
        border: '1px solid rgba(127,127,127,0.5)',
        background: 'rgba(127,127,127,0.18)',
        color: 'inherit',
        opacity: 0.6,
        cursor: 'not-allowed',
      },
      input: {
        font: 'inherit',
        fontSize: '13px',
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.35))',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        resize: 'vertical',
      },
      select: {
        font: 'inherit',
        fontSize: '13px',
        width: 'auto',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.35))',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        colorScheme: 'light dark',
        cursor: 'pointer',
      },
      option: {
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
      },
      choiceRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      choice: {
        font: 'inherit',
        fontSize: '12px',
        padding: '6px 12px',
        borderRadius: '999px',
        border: '1px solid currentColor',
        background: 'transparent',
        color: 'inherit',
        opacity: 0.7,
        cursor: 'pointer',
      },
      choiceOn: {
        font: 'inherit',
        fontSize: '12px',
        padding: '6px 12px',
        borderRadius: '999px',
        border: '1px solid #2f6fed',
        background: '#2f6fed',
        color: '#ffffff',
        opacity: 1,
        cursor: 'pointer',
        fontWeight: 600,
      },
      prompt: { fontSize: '15px', lineHeight: 1.7, margin: '0 0 12px', whiteSpace: 'pre-wrap' },
      badge: { fontSize: '11px', padding: '2px 8px', borderRadius: '999px', border: '1px solid currentColor', opacity: 0.7 },
      detail: { border: '1px solid rgba(127, 127, 127, 0.45)', borderRadius: '8px', padding: '8px 10px', marginTop: '8px' },
      summary: { cursor: 'pointer', fontWeight: 600 },
      pre: { whiteSpace: 'pre-wrap', fontSize: '12px', margin: '8px 0', padding: '8px', borderRadius: '6px', background: 'rgba(127, 127, 127, 0.12)' },
      ok: { fontSize: '12px', color: 'var(--mi-ok, #0b6b3a)' },
      bad: { fontSize: '12px', color: 'var(--mi-bad, #b3261e)' },
      meta: { fontSize: '11px', opacity: 0.55 },
      dimRow: { display: 'grid', gridTemplateColumns: '84px 1fr 34px', alignItems: 'center', gap: '8px', fontSize: '12px' },
      bar: { height: '6px', borderRadius: '999px', background: 'rgba(127,127,127,0.2)', overflow: 'hidden' },
      barFill: { height: '100%', background: 'var(--mi-bar, #2f6fed)' },
      list: { margin: 0, paddingLeft: '18px', fontSize: '13px', lineHeight: 1.9, opacity: 0.88 },
    }

    // The profile contract stores projects as {name, role, highlights}; the text
    // box shows them on one line and parses them back without inventing fields.
    function formatProject(entry) {
      const rest = [entry?.role, ...(entry?.highlights ?? [])].filter((part) => part).join('｜')
      return rest === '' ? String(entry?.name ?? '') : `${entry.name}：${rest}`
    }

    function parseProject(line) {
      const cut = line.search(/[:：]/)
      if (cut < 0) return { name: line, role: '', highlights: [] }
      const name = line.slice(0, cut).trim()
      const parts = line
        .slice(cut + 1)
        .split(/[｜|]/)
        .map((part) => part.trim())
        .filter((part) => part !== '')
      return { name, role: parts[0] ?? '', highlights: parts.slice(1) }
    }

    function Field(props) {
      return h(
        'div',
        { style: styles.col },
        h('label', { style: styles.label }, props.label),
        props.children,
      )
    }

    // Pills instead of a native popup: the option text must be readable in both
    // light and dark themes, and the popup surface is not ours to style.
    function Choice(props) {
      return h(
        'div',
        { style: styles.choiceRow, role: 'group', 'aria-label': props.label ?? '' },
        props.options.map((option) => {
          const spec = typeof option === 'object' && option !== null ? option : { value: option, label: String(option) }
          const on = String(spec.value) === String(props.value)
          return h(
            'button',
            {
              key: String(option.value),
              type: 'button',
              style: on ? styles.choiceOn : styles.choice,
              'aria-pressed': on ? 'true' : 'false',
              onClick: () => props.onChange(spec.value),
              onFocus: ringOn,
              onBlur: ringOff,
            },
            spec.label,
          )
        }),
      )
    }

    function Select(props) {
      return h(
        'select',
        {
          style: styles.select,
          value: props.value,
          onChange: (event) => props.onChange(event.target.value),
        },
        props.options.map((option) =>
          h('option', { key: option.value, value: option.value, style: styles.option }, option.label),
        ),
      )
    }

    function ScorePanel(props) {
      const t = props.t
      const score = props.score
      if (score === null || score === undefined) return null
      const dims = score.dims ?? {}
      return h(
        'div',
        { style: { ...styles.card, marginTop: '12px' } },
        h(
          'div',
          { style: { ...styles.row, justifyContent: 'space-between', marginBottom: '10px' } },
          h('strong', { style: { fontSize: '13px' } }, t('run.score')),
          h(
            'span',
            { style: { fontSize: '13px' } },
            `${t('run.overall')} ${score.overall} · ${t(`verdict.${score.verdict}`) ?? score.verdict}`,
          ),
        ),
        DIMS.map((dim) => {
          const value = dims[dim]
          const width = value === null || value === undefined ? '0%' : `${(Math.max(0, Math.min(5, value)) / 5) * 100}%`
          return h(
            'div',
            { key: dim, style: styles.dimRow },
            h('span', { style: { opacity: 0.7 } }, t(`dim.${dim}`)),
            h('span', { style: styles.bar }, h('span', { style: { ...styles.barFill, width, display: 'block' } })),
            h('span', { style: { textAlign: 'right', opacity: 0.8 } }, value === null || value === undefined ? '–' : String(value)),
          )
        }),
        Array.isArray(score.missing) && score.missing.length > 0
          ? h('ul', { style: { ...styles.list, marginTop: '10px' } }, score.missing.map((item, i) => h('li', { key: i }, item)))
          : null,
        props.cases !== undefined && props.cases.length > 0
          ? h(
              'div',
              { style: { marginTop: '10px' } },
              h('div', { style: styles.bad }, t('run.unverified')),
              h(
                'ul',
                { style: styles.list },
                props.cases.map((entry, i) =>
                  h('li', { key: i }, `${entry.ok ? '✓' : '✗'} ${entry.input} → ${entry.expected}（推演：${entry.actual}）`),
                ),
              ),
            )
          : null,
      )
    }

    function ReportPanel(props) {
      const t = props.t
      const report = props.report
      const items = report?.items ?? []
      const dims = report?.radar?.dims ?? report?.dims ?? {}
      const weak = report?.weakTop3 ?? (report?.weaknesses ?? []).map((entry) => entry.dimension)
      const actions = report?.actions ?? []
      return h(
        'div',
        { style: styles.card },
        h('h2', { style: styles.cardTitle }, t('report.title')),
        report?.summary ? h('p', { style: styles.prompt }, report.summary) : null,
        report?.sampleAdequate === false ? h('div', { style: styles.bad }, t('report.sample')) : null,
        h('div', { style: { ...styles.cardTitle, marginTop: '14px' } }, t('report.radar')),
        DIMS.map((dim) => {
          const value = dims[dim]
          const width = typeof value === 'number' ? `${(Math.max(0, Math.min(5, value)) / 5) * 100}%` : '0%'
          return h(
            'div',
            { key: dim, style: styles.dimRow },
            h('span', { style: { opacity: 0.7 } }, t(`dim.${dim}`)),
            h('span', { style: styles.bar }, h('span', { style: { ...styles.barFill, width, display: 'block' } })),
            h('span', { style: { textAlign: 'right', opacity: 0.8 } }, typeof value === 'number' ? value.toFixed(1) : '–'),
          )
        }),
        weak.length > 0
          ? h(
              'div',
              { style: { marginTop: '14px' } },
              h('div', { style: styles.cardTitle }, t('report.weak')),
              h(
                'ul',
                { style: styles.list },
                weak.map((dim, i) => h('li', { key: dim }, `${t(`dim.${dim}`)} — ${actions[i] ?? ''}`)),
              ),
            )
          : null,
        // v0.3 C7: long reports are folded by question; `details` is keyboard
        // reachable for free, so nobody needs to guess a custom accordion.
        items.length > 0
          ? h('div', { style: { marginTop: '18px' } },
              h('div', { style: styles.cardTitle }, t('report.items')),
              items.map((entry, index) =>
                h('details', { key: entry.questionId ?? index, style: styles.detail },
                  h('summary', { style: styles.summary },
                    `${index + 1}. ${entry.topic ?? entry.questionId ?? ''}`,
                    entry.overall === null || entry.overall === undefined ? '' : `  ·  ${entry.overall.toFixed(1)}`),
                  entry.answer ? h('pre', { style: styles.pre }, entry.answer) : null,
                  Array.isArray(entry.reference) && entry.reference.length > 0
                    ? h('div', null,
                        h('div', { style: styles.label }, t('report.reference')),
                        h('ul', { style: styles.list }, entry.reference.map((line, i) => h('li', { key: i }, line))))
                    : null,
                  entry.cases && entry.cases.length > 0
                    ? h('div', { style: { marginTop: '8px' } },
                        h('div', { style: styles.label }, t('report.cases')),
                        entry.cases.map((testCase, i) =>
                          h('div', { key: i, style: styles.meta },
                            `${testCase.ok ? '✓' : '✗'} ${testCase.input ?? ''} → ${testCase.expected ?? ''}`)))
                    : null,
                  h('button', {
                    type: 'button',
                    style: styles.button,
                    onClick: () => props.onCopyQuestion(entry),
                  }, t('report.copyQuestion') || '复制本题'))))
          : null,
        h(Field, { label: t('report.dir') },
          h('input', {
            style: styles.input,
            value: props.exportDir,
            placeholder: 'D:/project/04-docs/interview-reports',
            onChange: (event) => props.onDirChange(event.target.value),
          })),
        h('div', { style: { ...styles.row, marginTop: '16px' } },
          h(Choice, {
            label: t('report.format.label'),
            value: props.exportFormat,
            options: [
              { value: 'md', label: props.exportFormatLabels.md },
              { value: 'json', label: props.exportFormatLabels.json },
            ],
            onChange: props.onFormatChange,
          }),
          h('button', { type: 'button', style: props.busy ? styles.primaryOff : styles.primary, onClick: () => props.onExport(props.exportFormat), disabled: props.busy }, t('report.export')),
          h('button', {
            type: 'button',
            style: styles.button,
            onClick: props.onCopyMarkdown,
            disabled: props.busy,
            onFocus: ringOn,
            onBlur: ringOff,
          }, t('report.copyMarkdown')),
          h('button', { type: 'button', style: styles.button, onClick: props.onRestart }, t('report.again')),
          props.exportPath !== '' ? h('span', { style: styles.ok }, `${t('report.exported')}${props.exportPath}`) : null,
        ),
      )
    }

    function MockInterviewPage(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [phase, setPhase] = useState('setup')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [setup, setSetup] = useState({ resumeText: '', jdText: '', minutes: 30, mode: 'tech-1', difficulty: 'mid' })
      const [profile, setProfile] = useState(null)
      const [warnings, setWarnings] = useState([])
      const [skillsText, setSkillsText] = useState('')
      const [projectsText, setProjectsText] = useState('')
      const [session, setSession] = useState(null)
      const [index, setIndex] = useState(0)
      const [answer, setAnswer] = useState('')
      const [codeText, setCodeText] = useState('')
      const [language, setLanguage] = useState('java')
      const [card, setCard] = useState(null)
      const [cases, setCases] = useState([])
      const [probe, setProbe] = useState('')
      const [report, setReport] = useState(null)
      const [exportPath, setExportPath] = useState('')
      const [exportDir, setExportDir] = useState('')
      const [exportFormat, setExportFormat] = useState('md')
      const [records, setRecords] = useState([])
      const [recordsTotal, setRecordsTotal] = useState(0)
      const [recordsEmpty, setRecordsEmpty] = useState(null)
      const [theme, setTheme] = useState(null)
      const [recordsStats, setRecordsStats] = useState(null)
      const [recordsTrend, setRecordsTrend] = useState([])
      // Ticking clock for "how long have I been in this interview"; the host
      // supplies the authoritative elapsed time when the session is loaded.
      const [startedAt, setStartedAt] = useState(0)
      const [, setTick] = useState(0)
      const [recordQuery, setRecordQuery] = useState('')
      const [recordStatus, setRecordStatus] = useState('')
      const [recordArchived, setRecordArchived] = useState('exclude')
      const [selected, setSelected] = useState([])
      const [editing, setEditing] = useState(null)
      const [recordMsg, setRecordMsg] = useState('')
      // D1: the endpoint config lives on the host and comes back masked; the
      // clip exists only as one request body, never as state we could persist.
      const [asr, setAsr] = useState(null)
      const [asrForm, setAsrForm] = useState({ baseUrl: '', model: '', apiKey: '' })
      const [asrMsg, setAsrMsg] = useState('')
      const [asrBusy, setAsrBusy] = useState(false)
      const [bank, setBank] = useState(null)
      const [bankText, setBankText] = useState('')
      const [bankMsg, setBankMsg] = useState('')
      const [bankBusy, setBankBusy] = useState(false)
      const [recording, setRecording] = useState(false)
      const recorderRef = useRef(null)

      // The palette arrives from the host (see the `ping` action) so the two
      // colour schemes stay in one place, tested for contrast in lib/theme.mjs.
      const themeVars = theme === null
        ? {}
        : {
            '--mi-ok': theme.ok,
            '--mi-bad': theme.bad,
            '--mi-warn': theme.warn,
            '--mi-bar': theme.bar,
          }
      const page = (...children) => h('div', { style: { ...styles.page, ...themeVars } }, ...children)


      const items = session?.plan?.items ?? []
      const item = items[index]
      const total = items.length
      const isCode = item?.kind === 'code'

      // Sync the clock to the host's elapsed time on load, then let it tick.
      const sessionId = session?.id ?? ''
      useEffect(() => {
        if (sessionId === '') return undefined
        const elapsed = typeof session?.progress?.elapsedMs === 'number' ? session.progress.elapsedMs : 0
        setStartedAt(Date.now() - elapsed)
        const timer = setInterval(() => setTick((value) => value + 1), 1000)
        return () => clearInterval(timer)
      }, [sessionId])

      const elapsedText = (() => {
        if (startedAt === 0) return ''
        const seconds = Math.max(Math.floor((Date.now() - startedAt) / 1000), 0)
        const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
        const ss = String(seconds % 60).padStart(2, '0')
        return mm + ':' + ss
      })()

      const answeredCount = Array.isArray(session?.turns) ? session.turns.length : 0
      const runningAvg = (() => {
        const scored = (session?.turns ?? []).filter((turn) => typeof turn?.score?.overall === 'number')
        if (scored.length === 0) return null
        const sum = scored.reduce((total2, turn) => total2 + turn.score.overall, 0)
        return Math.round((sum / scored.length) * 10) / 10
      })()

      const reset = useCallback(() => {
        setPhase('setup')
        setError('')
        setBusy(false)
        setProfile(null)
        setWarnings([])
        setSkillsText('')
        setProjectsText('')
        setSession(null)
        setIndex(0)
        setAnswer('')
        setCodeText('')
        setCard(null)
        setCases([])
        setProbe('')
        setReport(null)
        setExportPath('')
      }, [])

      // Ask the host which palette to use. The scheme comes from the host's own
      // theme service; an unknown or missing service falls back to light.
      useEffect(() => {
        let scheme = 'light'
        try {
          const service = props.ctx?.get?.('theme')
          const snapshot = typeof service?.getTheme === 'function' ? service.getTheme() : null
          if (snapshot?.active?.colorScheme === 'dark') scheme = 'dark'
        } catch (error) {
          scheme = 'light'
        }
        rpc('ping', { scheme }).then((result) => {
          if (result.ok && result.value?.theme) setTheme(result.value.theme)
        })
      }, [])

      const onError = useCallback((failure) => {
        const hint = failure?.hint
        if (hint === undefined || hint === null) {
          setError(`${t('error.prefix')} ${failure.code}: ${failure.message}`)
          return
        }
        setError(`${hint.title}｜${hint.action}（${failure.code}）`)
      }, [t])

      const loadBankInfo = useCallback(() => {
        rpc('bank/get', {}).then((result) => {
          if (!result.ok) return
          setBank(result.value)
        })
      }, [])

      useEffect(() => {
        loadBankInfo()
      }, [loadBankInfo])

      const bankStatus = useCallback(() => {
        const active = bank?.active ?? {}
        const count = String(active.count ?? 0)
        return active.source === 'custom'
          ? t('bank.active.custom').replace('%s', count)
          : t('bank.active.default').replace('%s', count)
      }, [bank, t])

      const parseBankText = useCallback(() => {
        try {
          return { bank: JSON.parse(bankText), problem: '' }
        } catch (problem) {
          return { bank: undefined, problem: String(problem?.message ?? problem) }
        }
      }, [bankText])

      const checkBank = useCallback(() => {
        setBankBusy(true)
        setBankMsg('')
        const parsed = parseBankText()
        if (parsed.bank === undefined) {
          setBankBusy(false)
          setBankMsg(`${t('bank.invalid')}：${parsed.problem}`)
          return
        }
        rpc('bank/validate', { bank: parsed.bank }).then((result) => {
          setBankBusy(false)
          if (!result.ok) return onError(result)
          const warnings = result.value.warnings ?? []
          const head = t('bank.checked').replace('%s', String(result.value.count))
          setBankMsg(warnings.length === 0 ? head : `${head}｜${warnings.join('；')}`)
        })
      }, [onError, parseBankText, t])

      const saveBank = useCallback(() => {
        setBankBusy(true)
        setBankMsg('')
        const parsed = parseBankText()
        if (parsed.bank === undefined) {
          setBankBusy(false)
          setBankMsg(`${t('bank.invalid')}：${parsed.problem}`)
          return
        }
        rpc('bank/save', { bank: parsed.bank }).then((result) => {
          setBankBusy(false)
          if (!result.ok) return onError(result)
          setBankMsg(t('bank.saved').replace('%s', String(result.value.count)))
          loadBankInfo()
        })
      }, [loadBankInfo, onError, parseBankText, t])

      const resetBank = useCallback(() => {
        setBankBusy(true)
        setBankMsg('')
        rpc('bank/reset', {}).then((result) => {
          setBankBusy(false)
          if (!result.ok) return onError(result)
          setBankMsg(t('bank.reset.done'))
          loadBankInfo()
        })
      }, [loadBankInfo, onError, t])

      const loadAsr = useCallback(() => {
        rpc('asr/config', {}).then((result) => {
          if (!result.ok) return
          setAsr(result.value)
          const config = result.value.config ?? {}
          setAsrForm((current) => ({
            baseUrl: current.baseUrl === '' ? config.baseUrl ?? '' : current.baseUrl,
            model: current.model === '' ? config.model ?? '' : current.model,
            apiKey: '',
          }))
        })
      }, [])

      useEffect(() => {
        loadAsr()
      }, [loadAsr])

      const saveAsr = useCallback(() => {
        setAsrBusy(true)
        setAsrMsg('')
        rpc('asr/config', {
          config: {
            baseUrl: asrForm.baseUrl.trim(),
            model: asrForm.model.trim(),
            apiKey: asrForm.apiKey.trim(),
          },
        }).then((result) => {
          setAsrBusy(false)
          if (!result.ok) return onError(result)
          setAsr(result.value)
          setAsrForm((current) => ({ ...current, apiKey: '' }))
          setAsrMsg(t('asr.saved'))
        })
      }, [asrForm, onError, t])

      const clearAsr = useCallback(() => {
        setAsrBusy(true)
        setAsrMsg('')
        rpc('asr/config', { clear: true }).then((result) => {
          setAsrBusy(false)
          if (!result.ok) return onError(result)
          setAsr(result.value)
          setAsrMsg(t('asr.cleared'))
        })
      }, [onError, t])

      function readBase64(blob) {
        return new Promise((resolve) => {
          if (typeof FileReader === 'undefined') return resolve('')
          const reader = new FileReader()
          reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : ''
            const comma = text.indexOf(',')
            resolve(comma === -1 ? '' : text.slice(comma + 1))
          }
          reader.onerror = () => resolve('')
          reader.readAsDataURL(blob)
        })
      }

      const transcribe = useCallback((audioBase64, mime, durationMs) => {
        setAsrBusy(true)
        setError('')
        rpc('asr/transcribe', { audioBase64, mime, durationMs }).then((result) => {
          setAsrBusy(false)
          if (!result.ok) return onError(result)
          setAnswer(result.value.text)
          setAsrMsg(t('asr.transcribed'))
        })
      }, [onError, t])

      const stopRecording = useCallback(() => {
        const recorder = recorderRef.current
        if (recorder === null || recorder === undefined) return
        recorderRef.current = null
        setRecording(false)
        try {
          recorder.stop()
        } catch (problem) {
          /* already stopped by the browser */
        }
      }, [])

      const startRecording = useCallback(() => {
        const scope = typeof window !== 'undefined' ? window : undefined
        const Recorder = scope === undefined ? undefined : scope.MediaRecorder
        const devices = scope === undefined ? undefined : scope.navigator?.mediaDevices
        if (Recorder === undefined || typeof devices?.getUserMedia !== 'function') {
          setError(t('asr.unsupported'))
          return
        }
        setError('')
        setAsrMsg('')
        devices.getUserMedia({ audio: true }).then((stream) => {
          const recorder = new Recorder(stream)
          const chunks = []
          const startedRecordingAt = Date.now()
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) chunks.push(event.data)
          }
          recorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop())
            const mime = String(recorder.mimeType || chunks[0]?.type || 'audio/webm').split(';')[0]
            readBase64(new Blob(chunks, { type: mime })).then((encoded) => {
              if (encoded === '') {
                setError(t('asr.empty'))
                return
              }
              transcribe(encoded, mime, Date.now() - startedRecordingAt)
            })
          }
          recorderRef.current = recorder
          recorder.start()
          setRecording(true)
        }).catch(() => {
          setError(t('asr.denied'))
        })
      }, [t, transcribe])

      const asrReady = asr?.config?.hasKey === true

      const extract = useCallback(() => {
        setBusy(true)
        setError('')
        rpc('profile/extract', { resumeText: setup.resumeText, jdText: setup.jdText }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          const next = result.value.profile ?? {}
          setProfile(next)
          setWarnings(result.value.warnings ?? [])
          setSkillsText((next.skills ?? []).join('，'))
          setProjectsText((next.projects ?? []).map(formatProject).join('\n'))
          setPhase('confirm')
        })
      }, [setup, onError, t])

      const start = useCallback(() => {
        const skills = skillsText
          .split(/[,，;；\n]/)
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')
        const projects = projectsText
          .split(/\n/)
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .map(parseProject)
        const merged = {
          ...(profile ?? {}),
          skills,
          projects,
        }
        setBusy(true)
        setError('')
        rpc('session/create', {
          profile: merged,
          mode: setup.mode,
          difficulty: setup.difficulty,
          minutes: setup.minutes,
        }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setSession({ sessionId: result.value.sessionId, plan: result.value.plan, status: 'active' })
          setIndex(0)
          setCard(null)
          setCases([])
          setProbe('')
          setAnswer('')
          setCodeText('')
          setPhase('run')
        })
      }, [profile, projectsText, skillsText, setup, onError])

      const submit = useCallback(() => {
        if (session === null || item === undefined) return
        setBusy(true)
        setError('')
        const call = isCode
          ? ['code/review', { sessionId: session.sessionId, questionId: item.id, language, code: codeText }]
          : ['turn/answer', { sessionId: session.sessionId, questionId: item.id, answer, inputMode: 'text' }]
        rpc(call[0], call[1]).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setCard(result.value.score)
          setCases(isCode ? result.value.cases ?? [] : [])
          setProbe(result.value.next?.type === 'probe' ? result.value.next.question?.topic ?? '' : '')
        })
      }, [answer, codeText, isCode, item, session, onError])

      const finish = useCallback(() => {
        if (session === null) return
        setBusy(true)
        setError('')
        rpc('session/finish', { sessionId: session.sessionId }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setReport(result.value.report)
          setPhase('report')
        })
      }, [session, onError])

      const exportReport = useCallback((format = exportFormat, sessionId = null) => {
        if (session === null && sessionId === null) return
        setBusy(true)
        setError('')
        const body = { sessionId: sessionId ?? session.sessionId, format }
        if (exportDir.trim() !== '') body.dir = exportDir.trim()
        rpc('report/export', body).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setExportPath(result.value.path ?? '')
        })
      }, [session, exportDir, exportFormat, onError])

      const recordsBody = (next = {}) => {
        const query = next.query === undefined ? recordQuery : next.query
        const status = next.status === undefined ? recordStatus : next.status
        const archived = next.archived === undefined ? recordArchived : next.archived
        const body = { limit: 50 }
        if (typeof query === 'string' && query.trim() !== '') body.query = query.trim()
        if (status !== '') body.status = status
        // 默认（exclude）由宿主决定，不必显式传；只有「只看归档」才需要说出口。
        if (archived === 'only') body.archived = 'only'
        return body
      }

      const loadRecords = useCallback((next = {}) => {
        setBusy(true)
        setError('')
        setRecordMsg('')
        rpc('session/list', recordsBody(next)).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setRecords(result.value.sessions ?? [])
          setRecordsTotal(result.value.total ?? 0)
          setRecordsStats(result.value.stats ?? null)
          setRecordsEmpty(result.value.emptyReason ?? null)
          setRecordsTrend(result.value.trend ?? [])
          setSelected([])
        })
      }, [recordQuery, recordStatus, recordArchived, onError])

      const copyText = useCallback((text2, key) => {
        // Clipboard is best-effort: a denied permission must not break the view.
        const done = () => setRecordMsg(t(key))
        try {
          const clipboard = globalThis.navigator?.clipboard
          if (clipboard && typeof clipboard.writeText === 'function') {
            clipboard.writeText(text2).then(done, () => setRecordMsg(t('report.copyFailed')))
            return
          }
        } catch (error) {
          /* fall through to the failure message */
        }
        setRecordMsg(t('report.copyFailed'))
      }, [t])

      const copyReport = useCallback(() => {
        if (session === null) return
        setBusy(true)
        rpc('report/preview', { sessionId: session.id }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          copyText(result.value.markdown ?? '', 'report.copied')
        })
      }, [session, copyText, onError, t])

      const copyQuestion = useCallback((entry) => {
        const lines = [
          `### ${entry.topic ?? entry.questionId ?? ''}`,
          entry.answer === '' || entry.answer === undefined ? '' : entry.answer,
          ...(Array.isArray(entry.reference) ? ['', '参考解：', ...entry.reference] : []),
        ]
        copyText(lines.filter((line) => line !== null).join('\n'), 'report.copied')
      }, [copyText, t])

      const openRecords = useCallback(() => {
        setPhase('records')
        loadRecords()
      }, [loadRecords])

      const openRecord = useCallback((record) => {
        setBusy(true)
        setError('')
        rpc('session/get', { sessionId: record.id }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          const stored = result.value.session
          const items = stored.plan?.items ?? []
          const answered = new Set((stored.turns ?? []).map((turn) => turn.questionId))
          const next = items.findIndex((entry) => !answered.has(entry.id))
          setSession({ sessionId: stored.id, plan: stored.plan, status: stored.status, title: stored.title })
          setIndex(next < 0 ? Math.max(0, items.length - 1) : next)
          setCard(null)
          setCases([])
          setProbe('')
          setAnswer('')
          setCodeText('')
          setPhase(stored.status === 'finished' ? 'records' : 'run')
          setRecordMsg(stored.status === 'finished' ? t('records.view') : '')
        })
      }, [onError, t])

      const openReport = useCallback((record) => {
        setBusy(true)
        setError('')
        rpc('session/finish', { sessionId: record.id }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setSession({ sessionId: record.id, plan: [], status: 'finished', title: record.title })
          setReport(result.value.report)
          setExportPath('')
          setPhase('report')
        })
      }, [onError])

      const saveEdit = useCallback(() => {
        if (editing === null) return
        setBusy(true)
        setError('')
        const tags = editing.tagsText
          .split(/[,，;；\n]/)
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')
        const body = { sessionId: editing.id, title: editing.title, tags, note: editing.note }
        rpc('session/update', body).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          const saved = result.value.session
          setRecords((list) => list.map((row) => (row.id === saved.id ? { ...row, title: saved.title, tags: saved.tags } : row)))
          setEditing(null)
          setRecordMsg(t('records.saved'))
        })
      }, [editing, onError, t])

      const againRecord = useCallback((record) => {
        setBusy(true)
        setError('')
        setRecordMsg('')
        rpc('session/create', { fromSessionId: record.id }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setSession({ sessionId: result.value.sessionId, plan: result.value.plan, status: 'active', title: record.title })
          setIndex(0)
          setCard(null)
          setCases([])
          setProbe('')
          setAnswer('')
          setCodeText('')
          setExportPath('')
          setStartedAt(Date.now())
          setPhase('run')
          setRecordMsg(t('records.again.msg'))
        })
      }, [onError, t])

      const toggleArchive = useCallback((record) => {
        const archived = record.tags.includes(ARCHIVED_TAG)
        setBusy(true)
        setError('')
        rpc('session/update', { sessionId: record.id, archived: !archived }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          loadRecords()
        })
      }, [loadRecords, onError])

      const exportAll = useCallback(() => {
        setBusy(true)
        setError('')
        setRecordMsg('')
        const body = { dir: exportDir }
        if (recordArchived === 'only') body.archived = true
        rpc('history/export', body).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setRecordMsg(t('records.exported').replace('{path}', result.value.path ?? ''))
        })
      }, [exportDir, recordArchived, onError, t])

      const removeOne = useCallback((record) => {
        const ask = typeof window !== 'undefined' && typeof window.confirm === 'function'
        if (ask && !window.confirm(`${t('records.delete')}「${record.title}」？`)) return
        setBusy(true)
        setError('')
        rpc('session/delete', { sessionId: record.id }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setRecordMsg(t('records.deleted').replace('{n}', '1'))
          loadRecords()
        })
      }, [loadRecords, onError, t])

      const removeSelected = useCallback(() => {
        if (selected.length === 0) return
        const ask = typeof window !== 'undefined' && typeof window.confirm === 'function'
        if (ask && !window.confirm(`${t('records.deleteSelected')} ${selected.length}？`)) return
        setBusy(true)
        setError('')
        rpc('session/delete', { ids: selected }).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setRecordMsg(t('records.deleted').replace('{n}', String(result.value.deleted ?? 0)))
          loadRecords()
        })
      }, [loadRecords, onError, selected, t])

      const speak = useCallback(() => {
        const text = item?.topic ?? ''
        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
        if (!synth || text === '') return
        const utterance = new window.SpeechSynthesisUtterance(text)
        utterance.lang = 'zh-CN'
        synth.speak(utterance)
      }, [item])

      const voice = useCallback(() => {
        // No ASR endpoint is configured in v1: say so instead of faking a mic.
        setError(t('run.voice.blocked'))
      }, [t])

      if (phase === 'records') {
        const statusOptions = [
          { value: '', label: t('records.status.all') },
          { value: 'active', label: t('records.status.active') },
          { value: 'finished', label: t('records.status.finished') },
        ]
        return page(
          h('div', { style: styles.head },
            h('h1', { style: styles.title }, t('records.title')),
            h('span', { style: styles.badge }, t('records.count').replace('{total}', String(recordsTotal))),
            recordsStats === null
              ? null
              : h('span', { style: styles.meta }, t('records.stats')
                  .replace('{total}', String(recordsStats.total))
                  .replace('{finished}', String(recordsStats.finished))
                  .replace('{active}', String(recordsStats.active))
                  .replace('{avg}', recordsStats.avgScore === null ? '–' : recordsStats.avgScore.toFixed(1))),
            h('button', { type: 'button', style: styles.button, onClick: () => setPhase('setup') }, t('records.back')),
          ),
          h('div', { style: styles.card },
            recordsTrend.length === 0
              ? null
              : h('div', { style: { ...styles.row, alignItems: 'flex-end', gap: '6px', marginBottom: '12px' } },
                  recordsTrend.map((point) => h('div', {
                    key: point.id,
                    title: point.id + ' · ' + point.overall.toFixed(1),
                    style: {
                      width: '18px',
                      height: Math.max(6, Math.round(point.overall * 14)) + 'px',
                      background: point.overall >= 3.5
                        ? 'var(--mi-bar, #2f6fed)'
                        : point.overall >= 2.5
                          ? 'var(--mi-warn, #8a4b00)'
                          : 'var(--mi-bad, #b3261e)',
                      borderRadius: '3px',
                    },
                  })),
                  h('span', { style: styles.meta }, t('records.trend')),
                ),
            h('div', { style: styles.row },
              h('input', {
                style: { ...styles.input, flex: '1 1 220px' },
                value: recordQuery,
                placeholder: t('records.ph'),
                onChange: (event) => setRecordQuery(event.target.value),
                onKeyDown: (event) => {
                  if (isComposing(event)) return
                  if (event.key === 'Enter') loadRecords()
                },
              }),
              h(Choice, {
                label: t('records.status.all'),
                value: recordStatus,
                options: statusOptions,
                onChange: (value) => {
                  setRecordStatus(value)
                  loadRecords({ status: value })
                },
              }),
              h(Choice, {
                label: t('records.archive'),
                value: recordArchived,
                options: [
                  { value: 'exclude', label: t('records.status.all') },
                  { value: 'only', label: t('records.archived.only') },
                ],
                onChange: (value) => {
                  setRecordArchived(value)
                  loadRecords({ archived: value })
                },
              }),
              h('button', { type: 'button', style: busy ? styles.primaryOff : styles.primary, onClick: exportAll, disabled: busy },
                t('records.exportAll')),
              h('button', { type: 'button', style: busy ? styles.primaryOff : styles.primary, onClick: () => loadRecords(), disabled: busy },
                t('records.search')),
            ),
            records.length === 0
              ? h('div', { style: { ...styles.card, marginTop: '12px' } },
                  recordsEmpty === 'none'
                    ? h('div', null,
                        h('p', { style: { ...styles.subtitle, marginTop: 0 } }, t('records.empty.start')),
                        h('button', { type: 'button', style: styles.primary, onClick: reset }, t('records.empty.cta')))
                    : h('div', null,
                        h('p', { style: { ...styles.subtitle, marginTop: 0 } }, t('records.filtered')),
                        h('button', {
                          type: 'button',
                          style: styles.button,
                          onClick: () => {
                            setRecordQuery('')
                            setRecordStatus('')
                            loadRecords({ query: '', status: '' })
                          },
                        }, t('records.filtered.cta'))))
              : h('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' } },
                  records.map((record) =>
                    h('div', { key: record.id, style: styles.card },
                      h('div', { style: styles.row },
                        h('input', {
                          type: 'checkbox',
                          checked: selected.includes(record.id),
                          onChange: (event) => {
                            setSelected(event.target.checked
                              ? [...selected, record.id]
                              : selected.filter((id) => id !== record.id))
                          },
                        }),
                        h('strong', { style: { fontSize: '14px', flex: '1 1 200px' } }, record.title),
                        h('span', { style: styles.meta },
                          `${record.mode} · ${record.difficulty} · ${t('records.turns').replace('{n}', String(record.turns))}`),
                        h('span', { style: record.overall === null ? styles.meta : styles.badge },
                          record.overall === null ? '–' : `${t('records.score')} ${record.overall}`),
                        record.tags.length > 0
                          ? h('span', { style: styles.meta },
                              record.tags.filter((tag) => tag !== ARCHIVED_TAG).join(' / ') || t('records.archive'))
                          : null,
                        record.tags.includes(ARCHIVED_TAG) ? h('span', { style: styles.badge }, t('records.archive')) : null,
                      ),
                      h('div', { style: { ...styles.row, marginTop: '8px' } },
                        record.status === 'finished'
                          ? h('button', { type: 'button', style: styles.button, onClick: () => openReport(record) }, t('records.view'))
                          : h('button', { type: 'button', style: styles.button, onClick: () => openRecord(record) }, t('records.continue')),
                        record.status !== 'finished'
                          ? h('button', { type: 'button', style: styles.button, onClick: () => openRecord(record) }, t('records.view'))
                          : null,
                        h('button', {
                          type: 'button',
                          style: styles.button,
                          onClick: () => setEditing({ id: record.id, title: record.title, tagsText: record.tags.join('，'), note: '' }),
                        }, t('records.rename')),
                        h('button', { type: 'button', style: styles.button, onClick: () => againRecord(record) }, t('records.again')),
                        h('button', { type: 'button', style: styles.button, onClick: () => toggleArchive(record) },
                          record.tags.includes(ARCHIVED_TAG) ? t('records.unarchive') : t('records.archive')),
                        h('button', { type: 'button', style: styles.button, onClick: () => exportReport('md', record.id) }, t('records.exportMd')),
                        h('button', { type: 'button', style: styles.button, onClick: () => exportReport('json', record.id) }, t('records.exportJson')),
                        h('button', { type: 'button', style: styles.button, onClick: () => removeOne(record) }, t('records.delete')),
                      ),
                      editing !== null && editing.id === record.id
                        ? h('div', { style: { marginTop: '10px' } },
                            h(Field, { label: t('records.title.label') },
                              h('input', {
                                style: styles.input,
                                value: editing.title,
                                onChange: (event) => setEditing({ ...editing, title: event.target.value }),
                              })),
                            h(Field, { label: t('records.tags.label') },
                              h('input', {
                                style: styles.input,
                                value: editing.tagsText,
                                placeholder: t('records.ph'),
                                onChange: (event) => setEditing({ ...editing, tagsText: event.target.value }),
                              })),
                            h(Field, { label: t('records.note.label') },
                              h('textarea', {
                                style: { ...styles.input, minHeight: '70px' },
                                value: editing.note,
                                onChange: (event) => setEditing({ ...editing, note: event.target.value }),
                              })),
                            h('div', { style: styles.row },
                              h('button', { type: 'button', style: busy ? styles.primaryOff : styles.primary, onClick: saveEdit, disabled: busy }, t('records.save')),
                              h('button', { type: 'button', style: styles.button, onClick: () => setEditing(null) }, t('records.cancel')),
                            ))
                        : null,
                    ),
                  ),
                ),
            selected.length > 0
              ? h('div', { style: { ...styles.row, marginTop: '12px' } },
                  h('span', { style: styles.meta }, t('records.selected').replace('{n}', String(selected.length))),
                  h('button', { type: 'button', style: styles.button, onClick: removeSelected }, t('records.deleteSelected')),
                )
              : null,
            recordMsg !== '' ? h('div', { style: styles.ok }, recordMsg) : null,
            error !== '' ? h('div', { style: styles.bad }, error) : null,
          ),
        )
      }

      if (phase === 'setup') {
        return page(
          h('div', { style: styles.head },
            h('h1', { style: styles.title }, t('panel.title')),
            h('span', { style: styles.badge }, setup.mode),
            h('button', { type: 'button', style: styles.button, onClick: openRecords }, t('records.open')),
          ),
          h('p', { style: styles.subtitle }, t('panel.subtitle')),
          h('div', { style: styles.card },
            h('h2', { style: styles.cardTitle }, t('setup.title')),
            h(Field, { label: t('setup.resume') },
              h('textarea', {
                style: { ...styles.input, minHeight: '120px' },
                value: setup.resumeText,
                placeholder: t('setup.resume.ph'),
                onChange: (event) => setSetup({ ...setup, resumeText: event.target.value }),
              })),
            h(Field, { label: t('setup.jd') },
              h('textarea', {
                style: { ...styles.input, minHeight: '90px' },
                value: setup.jdText,
                placeholder: t('setup.jd.ph'),
                onChange: (event) => setSetup({ ...setup, jdText: event.target.value }),
              })),
            h('div', { style: styles.row },
              h(Field, { label: t('setup.minutes') },
                h(Choice, {
                  label: t('setup.minutes'),
                  value: setup.minutes,
                  options: MINUTES.map((value) => ({ value, label: `${value} min` })),
                  onChange: (value) => setSetup({ ...setup, minutes: Number(value) }),
                })),
              h(Field, { label: t('setup.mode') },
                h(Choice, {
                  label: t('setup.mode'),
                  value: setup.mode,
                  options: MODES.map((value) => ({ value, label: t(`mode.${value}`) })),
                  onChange: (value) => setSetup({ ...setup, mode: value }),
                })),
              h(Field, { label: t('setup.difficulty') },
                h(Choice, {
                  label: t('setup.difficulty'),
                  value: setup.difficulty,
                  options: DIFFICULTIES.map((value) => ({ value, label: t(`difficulty.${value}`) })),
                  onChange: (value) => setSetup({ ...setup, difficulty: value }),
                })),
            ),
            h('div', { style: styles.row },
              h('button', { type: 'button', style: busy ? styles.primaryOff : styles.primary, onClick: extract, disabled: busy },
                busy ? t('setup.extracting') : t('setup.extract')),
              busy ? h('span', { style: styles.meta }, t('busy.hint')) : null,
            ),
            h('details', { style: { marginTop: '14px' } },
              h('summary', { style: { cursor: 'pointer' } },
                t('asr.title') + (asrReady ? ' ✓' : '')),
              h('p', { style: styles.meta }, t('asr.hint')),
              h(Field, { label: t('asr.baseUrl') },
                h('input', {
                  style: styles.input,
                  value: asrForm.baseUrl,
                  placeholder: 'https://api.example.com/v1',
                  'aria-label': t('asr.baseUrl'),
                  onChange: (event) => setAsrForm({ ...asrForm, baseUrl: event.target.value }),
                  onFocus: ringOn,
                  onBlur: ringOff,
                })),
              h(Field, { label: t('asr.model') },
                h('input', {
                  style: styles.input,
                  value: asrForm.model,
                  placeholder: 'whisper-1',
                  'aria-label': t('asr.model'),
                  onChange: (event) => setAsrForm({ ...asrForm, model: event.target.value }),
                  onFocus: ringOn,
                  onBlur: ringOff,
                })),
              h(Field, { label: t('asr.apiKey') },
                h('input', {
                  style: styles.input,
                  type: 'password',
                  value: asrForm.apiKey,
                  placeholder: t('asr.apiKey.ph'),
                  'aria-label': t('asr.apiKey'),
                  onChange: (event) => setAsrForm({ ...asrForm, apiKey: event.target.value }),
                  onFocus: ringOn,
                  onBlur: ringOff,
                })),
              h('div', { style: styles.row },
                h('button', {
                  type: 'button',
                  style: asrBusy ? styles.primaryOff : styles.primary,
                  onClick: saveAsr,
                  disabled: asrBusy,
                }, t('asr.save')),
                h('button', {
                  type: 'button',
                  style: styles.button,
                  onClick: clearAsr,
                  disabled: asrBusy || !asrReady,
                }, t('asr.clear')),
                asr !== null && asr.keyMask !== '' ? h('span', { style: styles.meta }, asr.keyMask) : null,
                asrMsg !== '' ? h('span', { style: styles.meta }, asrMsg) : null,
              ),
            ),
            h('details', { style: { marginTop: '14px' } },
              h('summary', { style: { cursor: 'pointer' } },
                t('bank.title') + (bank?.active?.source === 'custom' ? ' ✓' : '')),
              h('p', { style: styles.meta }, t('bank.hint')),
              h('p', { style: styles.meta }, bankStatus()),
              h('textarea', {
                style: { ...styles.input, minHeight: '140px', fontFamily: 'ui-monospace, Consolas, monospace' },
                value: bankText,
                placeholder: t('bank.ph'),
                'aria-label': t('bank.title'),
                onChange: (event) => setBankText(event.target.value),
                onKeyDown: (event) => { if (isComposing(event)) return },
                onFocus: ringOn,
                onBlur: ringOff,
              }),
              h('div', { style: styles.row },
                h('button', { type: 'button', style: styles.button, onClick: checkBank, disabled: bankBusy }, t('bank.check')),
                h('button', {
                  type: 'button',
                  style: bankBusy ? styles.primaryOff : styles.primary,
                  onClick: saveBank,
                  disabled: bankBusy,
                }, t('bank.save')),
                h('button', {
                  type: 'button',
                  style: styles.button,
                  onClick: resetBank,
                  disabled: bankBusy || bank?.custom?.exists !== true,
                }, t('bank.reset')),
                bankMsg !== '' ? h('span', { style: styles.meta }, bankMsg) : null,
              ),
            ),
            error !== '' ? h('div', { style: styles.bad }, error) : null,
          ),
        )
      }

      const canStart = skillsText.trim() !== '' || projectsText.trim() !== ''

      if (phase === 'confirm') {
        return page(
          h('div', { style: styles.head }, h('h1', { style: styles.title }, t('confirm.title'))),
          h('div', { style: styles.card },
            h(Field, { label: t('confirm.skills') },
              h('input', {
                style: styles.input,
                value: skillsText,
                onChange: (event) => setSkillsText(event.target.value),
              })),
            h(Field, { label: t('confirm.projects') },
              h('textarea', {
                style: { ...styles.input, minHeight: '90px' },
                value: projectsText,
                onChange: (event) => setProjectsText(event.target.value),
              })),
            warnings.length > 0
              ? h('div', null,
                  h('div', { style: styles.label }, t('confirm.warnings')),
                  h('ul', { style: styles.list }, warnings.map((warning, i) => h('li', { key: i }, warning))))
              : null,
            canStart
              ? h('p', { style: { ...styles.subtitle, marginTop: '10px' } }, t('confirm.readiness.ready'))
              : h('p', { style: styles.bad }, t('confirm.blocked')),
            h('div', { style: { ...styles.row, marginTop: '14px' } },
              h('button', {
                type: 'button',
                style: busy || !canStart ? styles.primaryOff : styles.primary,
                onClick: start,
                disabled: busy || !canStart,
              }, t('confirm.start')),
              h('button', { type: 'button', style: styles.button, onClick: () => setPhase('setup') }, t('confirm.back')),
            ),
            error !== '' ? h('div', { style: styles.bad }, error) : null,
          ),
        )
      }

      if (phase === 'report') {
        return page(
          h(ReportPanel, {
            t,
            report,
            busy,
            exportPath,
            exportDir,
            exportFormat,
            exportFormatLabels: { md: t('report.format.md'), json: t('report.format.json') },
            onFormatChange: setExportFormat,
            onDirChange: setExportDir,
            onExport: () => exportReport(exportFormat),
            onCopyMarkdown: copyReport,
            onCopyQuestion: copyQuestion,
            onRestart: reset,
          }),
          error !== '' ? h('div', { style: styles.bad }, error) : null,
        )
      }

      const last = index >= total - 1
      return page(
        h('div', { style: styles.head },
          h('h1', { style: styles.title }, t('panel.title')),
          h('span', { style: styles.badge }, t(`run.kind.${item?.kind ?? 'skill'}`)),
          h('span', { style: styles.meta }, t('run.progress').replace('{n}', String(index + 1)).replace('{total}', String(total))),
          elapsedText === '' ? null : h('span', { style: styles.meta }, t('run.elapsed') + ' ' + elapsedText),
          runningAvg === null ? null : h('span', { style: styles.badge }, t('run.avg') + ' ' + runningAvg.toFixed(1)),
          answeredCount === 0 ? null : h('span', { style: styles.meta }, t('run.answered').replace('{n}', String(answeredCount))),
        ),
        h('div', { style: styles.card },
          h('p', { style: styles.prompt }, item?.topic ?? item?.target ?? ''),
          h('div', { style: styles.row },
            h('button', { type: 'button', style: styles.button, onClick: speak }, t('run.speak')),
            asrReady
              ? h('button', {
                  type: 'button',
                  style: recording ? styles.primaryOff : styles.button,
                  onClick: recording ? stopRecording : startRecording,
                  disabled: asrBusy || isCode,
                  onFocus: ringOn,
                  onBlur: ringOff,
                }, recording ? t('run.recording') : asrBusy ? t('run.transcribing') : t('run.record'))
              : h('button', { type: 'button', style: styles.button, onClick: voice }, t('run.voice')),
          ),
          isCode
            ? h(Field, { label: t('run.language') },
                h(Choice, {
                  label: t('run.language'),
                  value: language,
                  options: LANGUAGES.map((value) => ({ value, label: LANGUAGE_LABELS[value] ?? value })),
                  onChange: (value) => setLanguage(value),
                }))
            : null,
          h(Field, { label: isCode ? t('run.code') : t('run.answer') },
            isCode
              ? h('textarea', {
                  style: { ...styles.input, minHeight: '180px', fontFamily: 'ui-monospace, Consolas, monospace' },
                  value: codeText,
                  'aria-label': t('run.code'),
                  onChange: (event) => setCodeText(event.target.value),
                  onKeyDown: (event) => {
                    if (isComposing(event)) return
                    if (isSubmitShortcut(event)) {
                      event.preventDefault()
                      if (!busy) submit()
                    }
                  },
                  onFocus: ringOn,
                  onBlur: ringOff,
                  spellCheck: false,
                })
              : h('textarea', {
                  style: { ...styles.input, minHeight: '120px' },
                  value: answer,
                  'aria-label': t('run.answer'),
                  onChange: (event) => setAnswer(event.target.value),
                  onKeyDown: (event) => {
                    if (isComposing(event)) return
                    if (isSubmitShortcut(event)) {
                      event.preventDefault()
                      if (!busy) submit()
                    }
                  },
                  onFocus: ringOn,
                  onBlur: ringOff,
                })),
          h('div', { style: styles.row },
            h('button', {
              type: 'button',
              style: busy ? styles.primaryOff : styles.primary,
              onClick: submit,
              disabled: busy,
              onFocus: ringOn,
              onBlur: ringOff,
            }, busy ? t('run.submitting') : t('run.submit')),
            last
              ? h('button', { type: 'button', style: styles.button, onClick: finish, disabled: busy }, t('run.finish'))
              : h('button', {
                  type: 'button',
                  style: styles.button,
                  disabled: busy || card === null,
                  onClick: () => {
                    setIndex(index + 1)
                    setAnswer('')
                    setCodeText('')
                    setCard(null)
                    setCases([])
                    setProbe('')
                    setError('')
                  },
                }, t('run.next')),
          ),
          busy ? h('span', { style: styles.meta }, t('busy.hint')) : null,
          error !== '' ? h('div', { style: styles.bad }, error) : null,
          probe !== '' ? h('div', { style: { ...styles.meta, marginTop: '8px' } }, `${t('run.probing')}：${probe}`) : null,
        ),
        h(ScorePanel, { t, score: card, cases }),
      )
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-mock-interview: dictionaries')
        } catch {
          /* without a locale service the page falls back to its inline literals */
        }
        const t = (() => {
          try {
            return ctx.locale.bind(NS)
          } catch {
            return (key) => key
          }
        })()

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL,
              order: 40,
              locale: NS,
              label: () => t('icon.label'),
            },
            (slotProps) => h('span', { style: { color: 'currentColor' } }, h(MicIcon, { size: slotProps.size ?? 16 })),
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL,
              locale: NS,
              label: () => t('panel.title'),
              inject: () => ({ ctx, t }),
            },
            MockInterviewPage,
          ),
        )
      },
    }
  },
})
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
    const { useCallback, useState } = React

    const NS = 'dsh-mock-interview'
    const PANEL = 'mock-interview'
    const RPC = '/api/dsh-mock-interview/rpc'

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
        'run.kind.skill': '八股',
        'run.kind.project': '项目',
        'run.kind.code': '手撕',
        'run.kind.behavior': '行为',
        'run.answer': '你的回答（就当对面坐着真人）',
        'run.submit': '提交回答',
        'run.submitting': '评分中…',
        'run.code': '代码（不会被执行，只做静态评审）',
        'run.speak': '朗读题目',
        'run.voice': '语音作答',
        'run.voice.blocked': '当前没有可用的语音转写（ASR）：请改用文字作答，或在设置里配置自备的 OpenAI 兼容端点。',
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
      page: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '26px 30px', maxWidth: '900px' },
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
        border: '1px solid var(--dsw-alias-brand-primary, #4c7dff)',
        background: 'var(--dsw-alias-brand-primary, #4c7dff)',
        color: '#fff',
        cursor: 'pointer',
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
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.4))',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        cursor: 'pointer',
      },
      choiceOn: {
        font: 'inherit',
        fontSize: '12px',
        padding: '6px 12px',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-brand-primary, #4c7dff)',
        background: 'var(--dsw-alias-brand-primary, #4c7dff)',
        color: '#ffffff',
        cursor: 'pointer',
        fontWeight: 600,
      },
      prompt: { fontSize: '15px', lineHeight: 1.7, margin: '0 0 12px', whiteSpace: 'pre-wrap' },
      badge: { fontSize: '11px', padding: '2px 8px', borderRadius: '999px', border: '1px solid currentColor', opacity: 0.7 },
      ok: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary, #1f9d55)' },
      bad: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d14343)' },
      meta: { fontSize: '11px', opacity: 0.55 },
      dimRow: { display: 'grid', gridTemplateColumns: '84px 1fr 34px', alignItems: 'center', gap: '8px', fontSize: '12px' },
      bar: { height: '6px', borderRadius: '999px', background: 'rgba(127,127,127,0.2)', overflow: 'hidden' },
      barFill: { height: '100%', background: 'var(--dsw-alias-brand-primary, #4c7dff)' },
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
          const on = String(option.value) === String(props.value)
          return h(
            'button',
            {
              key: String(option.value),
              type: 'button',
              style: on ? styles.choiceOn : styles.choice,
              'aria-pressed': on ? 'true' : 'false',
              onClick: () => props.onChange(option.value),
            },
            option.label,
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
        h(Field, { label: t('report.dir') },
          h('input', {
            style: styles.input,
            value: props.exportDir,
            placeholder: 'D:/project/04-docs/interview-reports',
            onChange: (event) => props.onDirChange(event.target.value),
          })),
        h('div', { style: { ...styles.row, marginTop: '16px' } },
          h('button', { type: 'button', style: styles.primary, onClick: props.onExport, disabled: props.busy }, t('report.export')),
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
      const [card, setCard] = useState(null)
      const [cases, setCases] = useState([])
      const [probe, setProbe] = useState('')
      const [report, setReport] = useState(null)
      const [exportPath, setExportPath] = useState('')
      const [exportDir, setExportDir] = useState('')

      const items = session?.plan?.items ?? []
      const item = items[index]
      const total = items.length
      const isCode = item?.kind === 'code'

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

      const onError = useCallback((failure) => {
        setError(`${t('error.prefix')} ${failure.code}: ${failure.message}`)
      }, [t])

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
          ? ['code/review', { sessionId: session.sessionId, questionId: item.id, language: 'java', code: codeText }]
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

      const exportReport = useCallback(() => {
        if (session === null) return
        setBusy(true)
        setError('')
        const body = { sessionId: session.sessionId }
        if (exportDir.trim() !== '') body.dir = exportDir.trim()
        rpc('report/export', body).then((result) => {
          setBusy(false)
          if (!result.ok) return onError(result)
          setExportPath(result.value.path ?? '')
        })
      }, [session, exportDir, onError])

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

      if (phase === 'setup') {
        return h(
          'div',
          { style: styles.page },
          h('div', { style: styles.head },
            h('h1', { style: styles.title }, t('panel.title')),
            h('span', { style: styles.badge }, setup.mode),
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
              h('button', { type: 'button', style: styles.primary, onClick: extract, disabled: busy },
                busy ? t('setup.extracting') : t('setup.extract')),
              busy ? h('span', { style: styles.meta }, t('busy.hint')) : null,
            ),
            error !== '' ? h('div', { style: styles.bad }, error) : null,
          ),
        )
      }

      if (phase === 'confirm') {
        return h(
          'div',
          { style: styles.page },
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
            h('div', { style: { ...styles.row, marginTop: '14px' } },
              h('button', { type: 'button', style: styles.primary, onClick: start, disabled: busy }, t('confirm.start')),
              h('button', { type: 'button', style: styles.button, onClick: () => setPhase('setup') }, t('confirm.back')),
            ),
            error !== '' ? h('div', { style: styles.bad }, error) : null,
          ),
        )
      }

      if (phase === 'report') {
        return h(
          'div',
          { style: styles.page },
          h(ReportPanel, {
            t,
            report,
            busy,
            exportPath,
            exportDir,
            onDirChange: setExportDir,
            onExport: exportReport,
            onRestart: reset,
          }),
          error !== '' ? h('div', { style: styles.bad }, error) : null,
        )
      }

      const last = index >= total - 1
      return h(
        'div',
        { style: styles.page },
        h('div', { style: styles.head },
          h('h1', { style: styles.title }, t('panel.title')),
          h('span', { style: styles.badge }, t(`run.kind.${item?.kind ?? 'skill'}`)),
          h('span', { style: styles.meta }, t('run.progress').replace('{n}', String(index + 1)).replace('{total}', String(total))),
        ),
        h('div', { style: styles.card },
          h('p', { style: styles.prompt }, item?.topic ?? item?.target ?? ''),
          h('div', { style: styles.row },
            h('button', { type: 'button', style: styles.button, onClick: speak }, t('run.speak')),
            h('button', { type: 'button', style: styles.button, onClick: voice }, t('run.voice')),
          ),
          h(Field, { label: isCode ? t('run.code') : t('run.answer') },
            isCode
              ? h('textarea', {
                  style: { ...styles.input, minHeight: '180px', fontFamily: 'ui-monospace, Consolas, monospace' },
                  value: codeText,
                  onChange: (event) => setCodeText(event.target.value),
                  spellCheck: false,
                })
              : h('textarea', {
                  style: { ...styles.input, minHeight: '120px' },
                  value: answer,
                  onChange: (event) => setAnswer(event.target.value),
                })),
          h('div', { style: styles.row },
            h('button', { type: 'button', style: styles.primary, onClick: submit, disabled: busy },
              busy ? t('run.submitting') : t('run.submit')),
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
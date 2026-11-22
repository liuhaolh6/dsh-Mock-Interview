/**
 * dsh-mock-interview — Client half.
 *
 * G1 scope: prove the mount. One `sidebar.panellist` icon opens the interview
 * page registered in the `main` slot (key `mock-interview`); the page renders
 * the roadmap plus a live transport self-check that round-trips to the host
 * half. Interview UI (setup form, transcript, voice, report) replaces the body
 * of this page in G4.
 *
 * Kept dependency-free on purpose: React comes from the shell (`require`), the
 * dictionaries are inlined like the other local plugins, and nothing is
 * bundled.
 */

window.__ModuleLoader__.load({
  id: 'dsh-mock-interview',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useCallback } = React

    const NS = 'dsh-mock-interview'
    const PANEL = 'mock-interview'
    const RPC = '/api/dsh-mock-interview/rpc'

    const DICT = {
      zh: {
        'icon.label': '模拟面试',
        'panel.title': '模拟面试',
        'panel.subtitle': '用简历和岗位做靶子，把临场反应练成肌肉记忆',
        'panel.stage': 'G1 骨架',
        'panel.note': '当前只有挂载与连通性自检；面试流程按 docs/test-plan.md 逐用例实现。',
        'check.run': '连通性自检',
        'check.running': '自检中…',
        'check.ok': '宿主应答正常',
        'check.failed': '宿主无应答',
        'check.hint': '若失败：确认插件已加入 profile 的 bundles，并重启 Web 端。',
        'roadmap.title': '后续阶段',
        'roadmap.profile': '简历与岗位录入 → 结构化画像（可编辑确认）',
        'roadmap.director': '出题编排：八股 / 项目深挖 / 手撕 / 行为面，动态追问',
        'roadmap.voice': '语音：TTS 播报 + 可配置 ASR 转写，未配置则降级文字',
        'roadmap.score': '六维评分、原话证据、Top3 短板与改进清单',
        'roadmap.report': '会话持久化与 Markdown 复盘报告导出',
        'meta.version': '版本',
        'meta.schema': '会话格式',
      },
      en: {
        'icon.label': 'Mock interview',
        'panel.title': 'Mock interview',
        'panel.subtitle': 'Aim at your resume and the role, drill until the answer is reflex',
        'panel.stage': 'G1 skeleton',
        'panel.note': 'Mounting and the transport self-check only; the interview itself lands test case by test case.',
        'check.run': 'Run self-check',
        'check.running': 'Checking…',
        'check.ok': 'Host answered',
        'check.failed': 'No host answer',
        'check.hint': 'If this fails: add the plugin to the profile bundles and restart the web end.',
        'roadmap.title': 'Coming next',
        'roadmap.profile': 'Resume + role input → editable structured profile',
        'roadmap.director': 'Question director: fundamentals / project deep-dive / live coding / behavioural',
        'roadmap.voice': 'Voice: TTS prompts + optional ASR, plain text when unconfigured',
        'roadmap.score': 'Six-dimension scoring, quoted evidence, top-3 gaps and fixes',
        'roadmap.report': 'Durable sessions and a Markdown report you can re-read',
        'meta.version': 'Version',
        'meta.schema': 'Session schema',
      },
    }

    const ICON_PATHS = [
      'M4 5.5h16v10.5H9.2L5.4 19.2v-3.4H4z',
      'M8 9.4h8',
      'M8 12.4h5.4',
    ]

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

    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: '18px', padding: '28px 32px', maxWidth: '860px' },
      head: { display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' },
      title: { fontSize: '22px', fontWeight: 650, margin: 0 },
      badge: {
        fontSize: '11px',
        letterSpacing: '0.04em',
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid currentColor',
        opacity: 0.65,
      },
      subtitle: { margin: 0, opacity: 0.75, fontSize: '13px', lineHeight: 1.6 },
      card: { border: '1px solid rgba(127,127,127,0.25)', borderRadius: '10px', padding: '16px 18px' },
      cardTitle: { margin: '0 0 10px', fontSize: '13px', fontWeight: 600, opacity: 0.8 },
      list: { margin: 0, paddingLeft: '18px', fontSize: '13px', lineHeight: 1.9, opacity: 0.85 },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
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
      ok: { fontSize: '12px', color: 'var(--dsh-color-success, #1f9d55)' },
      bad: { fontSize: '12px', color: 'var(--dsh-color-danger, #d14343)' },
      meta: { fontSize: '11px', opacity: 0.55 },
    }

    function MockInterviewPage(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [state, setState] = useState({ phase: 'idle', text: '', meta: '' })

      const check = useCallback(() => {
        setState({ phase: 'running', text: '', meta: '' })
        fetch(RPC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op: 'ping' }),
        })
          .then((response) => response.json())
          .then((payload) => {
            if (payload?.ok === true && payload.value?.pong === true) {
              setState({
                phase: 'ok',
                text: t('check.ok'),
                meta: `${t('meta.version')} ${payload.value.version} · ${t('meta.schema')} v${payload.value.schemaVersion}`,
              })
              return
            }
            const code = payload?.error?.code ?? 'E_INTERNAL'
            setState({ phase: 'failed', text: `${t('check.failed')} (${code})`, meta: '' })
          })
          .catch((problem) => {
            setState({ phase: 'failed', text: `${t('check.failed')} (${problem?.message ?? problem})`, meta: '' })
          })
      }, [t])

      const roadmap = ['profile', 'director', 'voice', 'score', 'report']

      return h(
        'div',
        { style: styles.page },
        h(
          'div',
          { style: styles.head },
          h('h1', { style: styles.title }, t('panel.title')),
          h('span', { style: styles.badge }, t('panel.stage')),
        ),
        h('p', { style: styles.subtitle }, t('panel.subtitle')),
        h(
          'div',
          { style: styles.card },
          h('h2', { style: styles.cardTitle }, t('check.run')),
          h(
            'div',
            { style: styles.row },
            h(
              'button',
              { type: 'button', style: styles.button, onClick: check, disabled: state.phase === 'running' },
              state.phase === 'running' ? t('check.running') : t('check.run'),
            ),
            state.phase === 'ok' ? h('span', { style: styles.ok }, state.text) : null,
            state.phase === 'failed' ? h('span', { style: styles.bad }, state.text) : null,
          ),
          state.meta !== '' ? h('div', { style: styles.meta }, state.meta) : null,
          state.phase === 'failed' ? h('p', { style: styles.subtitle }, t('check.hint')) : null,
        ),
        h(
          'div',
          { style: styles.card },
          h('h2', { style: styles.cardTitle }, t('roadmap.title')),
          h(
            'ul',
            { style: styles.list },
            roadmap.map((key) => h('li', { key }, t(`roadmap.${key}`))),
          ),
        ),
        h('p', { style: styles.subtitle }, t('panel.note')),
      )
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-mock-interview: dictionaries')
        } catch {
          /* without a locale service the page shows its own literals */
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
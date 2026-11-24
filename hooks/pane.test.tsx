import { expect, test } from 'claude-code/testing'
import { tally, fmtTok, fmtUsd, laneSvg, accentSvg, bandSvg, emptySvg, headerSvg, rowHeadSvg, tilesSvg } from './register'

const PANE = {
  plugin: 'agent-monitor',
  component: 'Pane',
  requestId: 'agent-monitor',
  props: {
    title: 'Agent monitor',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the pane draws a background shell and a monitor on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'monitor' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 5000 }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('tool.call', () => ({ result: {} }))
  on('ui.open', () => ({ value: null }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'sleep 25', description: 'Sleep test', run_in_background: true })
  await $.tool.call({ tool: 'Monitor', description: 'Watch the build log', timeout_ms: 1000, command: 'tail -f x' })
  await new Promise(r => setTimeout(r, 50))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // The terminal draws rows as Text, the other surfaces as one Svg per row whose alt names it.
    const q = (re: RegExp) => (surface === 'terminal' ? { type: 'Text', text: re } : { type: 'Svg', alt: re })
    expect(await ui.find(q(/Sleep test/))).toBeDefined()
    expect(await ui.find(q(/Watch the build log/))).toBeDefined()
    await ui.unmount()
  }
})

test('an empty monitor says so', async ($, on) => {
  on('state.get', () => ({ value: { value: [], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Waiting for work/ })).toBeDefined()
  await ui.unmount()
})

test('CronDelete ends the job it names, not the oldest one', async ($, on) => {
  const text: Record<string, string> = { first: 'Scheduled recurring job aaaa1111 (*/5 * * * *).', second: 'Scheduled recurring job bbbb2222 (*/7 * * * *).', bbbb2222: 'Cancelled job bbbb2222.' }
  on('command.register', () => ({ value: { command: 'monitor' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 5000 }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('tool.call', (_, e) => ({ result: {}, text: text[String((e as any).prompt ?? (e as any).id)] ?? '' }))
  on('ui.open', () => ({ value: null }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'first' })
  await $.tool.call({ tool: 'CronCreate', cron: '*/7 * * * *', prompt: 'second' })
  await $.tool.call({ tool: 'CronDelete', id: 'bbbb2222' })
  await new Promise(r => setTimeout(r, 50))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Both rows exist, only the second one is finished: the section header counts 1 of 2 done.
  expect(await ui.find({ type: 'Svg', alt: /first/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg', alt: /second/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 of 2 done/ })).toBeDefined()
  await ui.unmount()
})

test('cost and token numbers are formatted for the panel', () => {
  expect(fmtUsd(0)).toBe('$0.00')
  expect(fmtUsd(0.004)).toBe('<$0.01')
  expect(fmtUsd(1.234)).toBe('$1.23')
  expect(fmtTok(950)).toBe('950')
  expect(fmtTok(31200)).toBe('31.2k')
  expect(fmtTok(2500000)).toBe('2.5M')
})

test('glow and pulse only draw for running work', () => {
  const fx = { glow: true, pulse: true, live: true }
  expect(laneSvg(300, 'x', 0, 0.5, '#fff', '5s', fx)).toContain('filter="url(#g)"')
  expect(laneSvg(300, 'x', 0, 0.5, '#fff', '5s', fx)).toContain('class="live"')
  expect(laneSvg(300, 'x', 0, 1, '#fff', '5s', { ...fx, live: false })).not.toContain('filter="url(#g)"')
  expect(tilesSvg(200, [{ k: 'a', v: '1', c: '#fff', glow: true }])).toContain('filter="url(#g)"')
  expect(tilesSvg(200, [{ k: 'a', v: '1' }])).not.toContain('filter="url(#g)"')
})

test('the spinner ring and the accent line animate in phase', () => {
  const fx = { glow: true, pulse: true, phase: 0.25 }
  const head = (state: any) => rowHeadSvg(300, { indent: 0, chip: 'bash', label: 'x', time: '5s', state, color: '#fff', dim: false, warn: false }, fx)
  expect(head('running')).toContain('class="spin" style="animation-delay:-0.25s"')
  expect(head('done')).not.toContain('class="spin"')
  expect(accentSvg(300, '#fff', fx)).toContain('class="live" style="animation-delay:-0.25s"')
  expect(accentSvg(300, '#fff', { ...fx, pulse: false })).not.toContain('class="live"')
})

test('the Done tile draws a progress ring and the empty pane breathes', () => {
  expect(tilesSvg(200, [{ k: 'Done', v: '1/2', ring: 0.5, rc: '#0af' }])).toContain('stroke-dasharray')
  expect(tilesSvg(200, [{ k: 'Done', v: '0/0', ring: 0, rc: '#0af' }])).not.toContain('stroke-dasharray')
  expect(emptySvg(300, { glow: true, pulse: true })).toContain('💤')
})

test('the header glows while work runs and the tally ignores a stale batch', () => {
  const h = { color: '#0af', title: 'Agent monitor', sub: '3 running', ratio: 0.5, live: true }
  expect(headerSvg(300, h, { glow: true, pulse: true })).toContain('filter="url(#g)"')
  expect(headerSvg(300, { ...h, live: false }, { glow: true, pulse: true })).not.toContain('filter="url(#g)"')
  const item = (status: string) => ({ id: status + Math.random(), kind: 'agent', status }) as any
  // The batch says 9 started, 0 finished, but only 3 agents exist and all run.
  expect(tally({ agent: [9, 0] }, [item('running'), item('running'), item('running')])).toEqual({ t: 3, d: 0 })
  expect(tally({ agent: [5, 2] }, [item('running')])).toEqual({ t: 3, d: 2 })
})

test('the band draws counts, progress and names, and glows only while running', () => {
  const b = { color: '#0af', live: true, flash: false, chips: [{ icon: '🤖', n: 3, c: '#0af' }], d: 1, t: 4, slow: 0, cost: '~$0.10', names: ['Review the diff 5s'] }
  const svg = bandSvg(600, b, { glow: true, pulse: true })
  expect(svg).toContain('Review the diff 5s')
  expect(svg).toContain('1/4')
  expect(svg).toContain('filter="url(#g)"')
  expect(bandSvg(600, { ...b, live: false }, { glow: true, pulse: true })).not.toContain('filter="url(#g)"')
})

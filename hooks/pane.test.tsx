import { expect, test } from 'claude-code/testing'
import { fmtTok, fmtUsd } from './register'

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
    expect(await ui.find({ type: 'Text', text: /Sleep test/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Watch the build log/ })).toBeDefined()
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
  // Both rows exist, only the second one is finished: the pane counts 1 of 2 tasks done.
  expect(await ui.find({ type: 'Text', text: /first/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /second/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\/2/ })).toBeDefined()
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

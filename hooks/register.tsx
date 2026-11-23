import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Item, Kind, LogEntry, Status } from '../types'

const PANE = 'agent-monitor'
const SETTINGS = 'agent-monitor-settings'
const MAX_ITEMS = 200
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const KINDS: Record<Kind, { icon: string; name: string; one: string; color: string }> = {
  agent: { icon: '🤖', name: 'Subagents', one: 'Subagent', color: 'cyan' },
  shell: { icon: '🖥️', name: 'Background shells', one: 'Shell', color: 'yellow' },
  task: { icon: '📄', name: 'Background tasks', one: 'Task', color: 'magenta' },
}
const ORDER: Kind[] = ['agent', 'shell', 'task']

// Change a tag when Item's fields change: it declines what an older version stored.
const items = atom({ plugin: 'agent-monitor', key: 'items' } as const, [], { shape: 'items-4' })
const flat = atom({ plugin: 'agent-monitor', key: 'flat' } as const, null, { shape: 'flat-1' })
// The mod's option values, mirrored here so the settings pane can draw them.
const optsAtom = atom({ plugin: 'agent-monitor', key: 'opts' } as const, {}, { shape: 'opts-1' })

const SPEC: { key: string; label: string; desc: string; def: boolean | number; step?: number; min?: number; choices?: { label: string; value: number }[] }[] = [
  { key: 'showSubagents', label: 'Subagents', desc: 'Track subagents (Agent tool, teammates).', def: true },
  { key: 'showShell', label: 'Background shells', desc: 'Track Bash commands run in the background.', def: true },
  { key: 'showTasks', label: 'Background tasks', desc: 'Track crons, monitors and workflows.', def: true },
  { key: 'treeView', label: 'Tree view', desc: 'Nest subagents under their parent. Off shows a flat list.', def: true },
  { key: 'showBand', label: 'Summary band', desc: 'One-line summary above the prompt.', def: true },
  { key: 'showButtons', label: 'Row buttons', desc: 'View agent, clear finished, layout toggle.', def: true },
  { key: 'showTimeline', label: 'Timeline', desc: 'One lane per item on a shared time axis.', def: true },
  { key: 'showLog', label: 'Event log', desc: 'Start and finish lines with the time, kept after items are cleared.', def: false },
  { key: 'autoOpenPane', label: 'Auto-open pane', desc: 'Open the monitor when a subagent, shell or task starts.', def: true },
  { key: 'autoClosePane', label: 'Auto-close pane', desc: 'Close the monitor it opened itself once nothing is running or listed.', def: true },
  { key: 'showCost', label: 'Cost and tokens', desc: 'Show tokens and estimated cost per subagent, and the spend of the last prompt and the session. Local data, no tokens used.', def: true },
  { key: 'showSpinner', label: 'Spinner', desc: 'Animate running rows with a spinner instead of a static dot.', def: true },
  { key: 'flashOnFinish', label: 'Finish flash', desc: 'Show a sparkle for a moment on items that just finished.', def: true },
  { key: 'compactBand', label: 'Compact band', desc: 'A shorter band: counts and progress only, without the latest item names.', def: false },
  { key: 'notifyToast', label: 'Toast on finish', desc: 'Show a toast when something finishes.', def: true },
  { key: 'notifySound', label: 'Sound on finish', desc: 'Play a chime when something finishes.', def: true },
  { key: 'showResultPreview', label: 'Result preview', desc: 'First line of a subagent answer. No tokens.', def: true },
  { key: 'aiSummary', label: 'AI summary (uses tokens)', desc: 'WARNING: sends each finished agent answer to a small model. Costs tokens.', def: false },
  { key: 'clearAfterSeconds', label: 'Clear finished after', desc: 'Press to change. How long finished items stay listed.', def: 5, choices: [{ label: 'Never', value: -1 }, { label: 'Instant', value: 0 }, { label: '5s', value: 5 }, { label: '10s', value: 10 }, { label: '20s', value: 20 }, { label: '1m', value: 60 }, { label: '5m', value: 300 }, { label: '10m', value: 600 }] },
  { key: 'stuckAfterSeconds', label: 'Flag as stuck after', desc: 'Press to change. Running items older than this turn orange.', def: 600, choices: [{ label: 'Off', value: 0 }, { label: '1m', value: 60 }, { label: '5m', value: 300 }, { label: '10m', value: 600 }, { label: '30m', value: 1800 }, { label: '1h', value: 3600 }] },
  { key: 'theme', label: 'Color theme', desc: 'Press to switch palette.', def: 0, choices: [{ label: 'Ocean', value: 0 }, { label: 'Sunset', value: 1 }, { label: 'Forest', value: 2 }, { label: 'Mono', value: 3 }, { label: 'Pastel', value: 4 }] },
  { key: 'refreshSeconds', label: 'Refresh interval (s)', desc: 'Type a number and press Enter. How often state is polled. Local only.', def: 1, step: 1, min: 1 },
]

// Running tally per kind, [started, finished]: it survives clearing, so a bar shows real progress.
const batchAtom = atom({ plugin: 'agent-monitor', key: 'batch' } as const, {}, { shape: 'batch-1' })
const logAtom = atom({ plugin: 'agent-monitor', key: 'log' } as const, [], { shape: 'log-2' })
// Session spend in US dollars: the whole session, and what was spent since the last prompt you typed.
const spendAtom = atom({ plugin: 'agent-monitor', key: 'spend' } as const, { session: 0, turn: 0 }, { shape: 'spend-1' })
// The panel's "only running" view, toggled from its header.
const activeOnlyAtom = atom({ plugin: 'agent-monitor', key: 'activeOnly' } as const, false, { shape: 'active-1' })
const collapsed = atom({ plugin: 'agent-monitor', key: 'collapsed' } as const, [], { shape: 'collapsed-1' })

const PALETTES = [
  { name: 'Ocean', accent: 'cyan', agent: 'cyan', shell: 'yellow', task: 'magenta' },
  { name: 'Sunset', accent: 'magenta', agent: 'magenta', shell: 'yellow', task: 'red' },
  { name: 'Forest', accent: 'green', agent: 'green', shell: 'cyan', task: 'yellow' },
  { name: 'Mono', accent: 'white', agent: 'white', shell: 'white', task: 'gray' },
  { name: 'Pastel', accent: '#b8e0d2', agent: '#a5d8ff', shell: '#ffd6a5', task: '#d0bfff' },
]
const palOf = (o: Record<string, boolean | number>) => PALETTES[Number(o.theme ?? 0)] ?? PALETTES[0]
const WARN = '#ff9f1c'
// Last poll time: drawing reads it instead of calling the clock, and it drives the spinner.
const clock = atom({ plugin: 'agent-monitor', key: 'now' } as const, 0)

type Patch = Partial<Item> & { id: string; kind: Kind }
type Opts = Record<string, boolean | number>

// Set by register(); hooks run in one module environment, so top-level helpers read it.
let base: Opts = {}
// Items the person cleared (or the timer pruned): the agent list would add them back.
const gone = new Set<string>()
const KEYS: Record<Kind, string> = { agent: 'showSubagents', shell: 'showShell', task: 'showTasks' }

// Live options: the settings pane writes optsAtom, register() ran only once.
async function live($: any): Promise<Opts> {
  return { ...base, ...(await read($, optsAtom)) }
}
const on_ = (o: Opts, k: Kind) => o[KEYS[k]] !== false
// Module variables reset on reload, which is fine: they only smooth the next poll.
const tools: Record<string, string> = {}
let timer: { cancel: () => void } | undefined
// True while the pane on screen was opened by the mod itself: only that one is closed automatically.
let autoOpened = false
// Session dollars when the last user prompt was typed: the turn's spend is the difference.
let promptBase: number | undefined

export const fmtUsd = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : '$' + n.toFixed(2))
export const fmtTok = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))
// How long the sparkle shows on an item that just finished.
const FLASH_MS = 2500
const isDone = (i: Item) => i.status === 'done' || i.status === 'failed' || i.status === 'killed'
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s)
const oneLine = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
// Coloured ▰▰ bar: the finished share in colour, the rest dim.
const bar = (Text: any, done: number, total: number, w = 10, color?: string, dim = false) => {
  const f = total > 0 ? Math.max(0, Math.min(w, Math.round((done / total) * w))) : 0
  return (
    <Text>
      <Text dimColor={dim} color={color ?? (f === w && total > 0 ? 'green' : 'cyan')}>{'▰'.repeat(f)}</Text>
      <Text dimColor color="gray">{'▰'.repeat(w - f)}</Text>
    </Text>
  )
}
const stateEmoji = (c: string) => (c === 'red' ? '🔴' : c === WARN ? '⚠️' : c === 'green' ? '🟢' : '🟡')

type Batch = Record<string, number[]>
const tally = (b: Batch, list: Item[], kind?: Kind) => {
  const cells = Object.entries(b).filter(([k]) => k in KINDS && (!kind || k === kind)).map(([, c]) => c)
  const t = cells.reduce((n, c) => n + c[0], 0)
  const d = cells.reduce((n, c) => n + c[1], 0)
  if (t > 0) return { t, d }
  const mine = kind ? list.filter(i => i.kind === kind) : list
  return { t: mine.length, d: mine.filter(i => i.status === 'done' || i.status === 'failed' || i.status === 'killed').length }
}

const isStuck = (i: Item, now: number, lim: number) => lim > 0 && !i.until && i.status === 'running' && now - i.startedAt > lim * 1000
const isBad = (i: Item) => i.status === 'failed' || i.status === 'killed'
// Header colour says it at a glance: red failed, orange stuck, accent running, green all done.
function stateColor(list: Item[], now: number, o: Record<string, boolean | number>) {
  if (list.some(i => i.status === 'failed')) return 'red'
  if (list.some(i => isStuck(i, now, Number(o.stuckAfterSeconds ?? 600)))) return WARN
  if (list.some(i => !isDone(i))) return palOf(o).accent
  return 'green'
}

function dur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`
}

function mapStatus(s: string): Status {
  if (s === 'completed') return 'done'
  if (s === 'failed' || s === 'killed' || s === 'waiting' || s === 'idle') return s
  return 'running'
}

// Pure merge: returns the new list, whether anything changed, and which items just ended.
function reduce(list: Item[], patches: Patch[], now: number) {
  let changed = false
  const ended: Item[] = []
  const next = list.slice()
  for (const p of patches) {
    const at = next.findIndex(x => x.id === p.id)
    if (at < 0) {
      const item: Item = { label: p.id, status: 'running', startedAt: now, ...p } as Item
      if (isDone(item)) item.endedAt = now
      next.push(item)
      changed = true
      continue
    }
    const old = next[at]
    const merged: Item = { ...old, ...p }
    // A finished item stays finished: later polls must not reopen it.
    if (isDone(old)) merged.status = old.status
    if (isDone(merged) && !isDone(old)) {
      merged.endedAt = now
      ended.push(merged)
    }
    const diff = (Object.keys(merged) as (keyof Item)[]).some(k => merged[k] !== old[k])
    if (diff) {
      next[at] = merged
      changed = true
    }
  }
  return { list: next.slice(-MAX_ITEMS), changed, ended }
}

async function apply($: any, patches: Patch[]) {
  const o = await live($)
  const wanted = patches.filter(p => on_(o, p.kind) && !gone.has(p.id))
  if (wanted.length === 0) return
  const now: number = await $.clock.now()
  const before: Item[] = await read($, items)
  const first = reduce(before, wanted, now)
  if (!first.changed) return
  // The pane opens (without stealing focus) when work starts while nothing else is running.
  const newOnes = wanted.filter(p => !before.some(i => i.id === p.id))
  const idle = !before.some(i => !isDone(i))
  const fresh = newOnes.some(p => !isDone({ status: p.status ?? 'running' } as Item))
  await update($, batchAtom, (b: Batch) => {
    const nb: Batch = idle && fresh ? {} : { ...b }
    if (newOnes.length || first.ended.length) nb.span = [nb.span?.[0] ?? now, now]
    for (const p of newOnes) {
      const c = nb[p.kind] ?? [0, 0]
      nb[p.kind] = [c[0] + 1, c[1] + (isDone({ status: p.status ?? 'running' } as Item) ? 1 : 0)]
    }
    for (const it of first.ended) {
      const c = nb[it.kind] ?? [0, 0]
      nb[it.kind] = [c[0], Math.min(c[0], c[1] + 1)]
    }
    return nb
  })
  await update($, logAtom, (l: LogEntry[]) =>
    [
      ...l,
      ...newOnes.map(p => ({ at: now, icon: '▶', text: `${KINDS[p.kind].icon} ${clip(String(p.label ?? p.id), 160)}` })),
      ...first.ended.map(it => ({
        at: now,
        icon: it.status === 'done' ? '🟢' : it.status === 'failed' ? '🔴' : '⛔',
        text: `${KINDS[it.kind].icon} ${clip(it.label, 160)} · ${dur(now - it.startedAt)}`,
      })),
    ].slice(-60),
  )
  if (fresh && o.autoOpenPane !== false && !before.some(i => !isDone(i))) {
    autoOpened = true
    void Promise.resolve($.ui.open({ id: PANE, title: 'Agent monitor' })).catch(() => undefined)
  }
  await update($, items, (l: Item[]) => reduce(l, wanted, now).list)
  for (const it of first.ended) void alertEnded($, it, now, o)
}

async function alertEnded($: any, it: Item, now: number, o: Opts) {
  const mark = it.status === 'done' ? '✓' : '✗'
  if (o.notifyToast !== false) {
    $.ui.toast(`${mark} ${KINDS[it.kind].one}: ${clip(it.label, 60)} (${dur(now - it.startedAt)})`)
  }
  if (o.notifySound !== false) {
    await $.audio.play({ asset: 'assets/done.wav' }).catch(() => undefined)
  }
}

async function summarize($: any, id: string, answer: string) {
  const r = await $.model
    .complete({ model: 'haiku', prompt: `Summarize in at most 12 words, no preamble:\n${answer.slice(0, 2000)}` })
    .catch(() => undefined)
  if (r?.isAnswered) await apply($, [{ id, kind: 'agent', note: oneLine(r.text) }])
}

async function sync($: any) {
  const now: number = await $.clock.now()
  const o = await live($)
  if (on_(o, 'agent')) {
    const patches: Patch[] = []
    const seen = new Set<string>()
    for (const a of await $.agent.list()) {
      seen.add(a.id)
      patches.push({
        id: a.id,
        kind: 'agent',
        label: oneLine(a.description || a.name || a.type),
        type: a.type,
        parentId: a.parentId,
        status: mapStatus(a.status),
        tool: tools[a.id],
        ...(a.usage?.length
          ? { tokens: a.usage.reduce((n: number, u: any) => n + u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens, 0) }
          : {}),
        ...(typeof a.cost?.usd === 'number' ? { usd: a.cost.usd } : {}),
      })
    }
    // An agent the engine dropped from its list has ended.
    for (const it of await read($, items)) {
      if (it.kind === 'agent' && !isDone(it) && !seen.has(it.id)) {
        patches.push({ id: it.id, kind: 'agent', status: 'done' })
      }
    }
    await apply($, patches)
  }
  const cur: Item[] = await read($, items)
  const lapsed: Patch[] = cur.filter(i => i.until && !isDone(i) && now > i.until).map(i => ({ id: i.id, kind: i.kind, status: 'done' }))
  if (lapsed.length) await apply($, lapsed)
  // A subagent's background work reports to the subagent, never to the main prompt: it ends with its owner.
  const owners = new Map(cur.map(i => [i.id, i]))
  const orphans: Patch[] = cur
    .filter(i => i.kind !== 'agent' && !isDone(i) && i.parentId && owners.get(i.parentId) && isDone(owners.get(i.parentId)!))
    .map(i => ({ id: i.id, kind: i.kind, status: 'done' }))
  if (orphans.length) await apply($, orphans)
  const clearAfter = Number(o.clearAfterSeconds ?? 5)
  if (clearAfter >= 0) {
    const stale = cur.filter(i => isDone(i) && now - (i.endedAt ?? now) >= clearAfter * 1000)
    if (stale.length) {
      for (const i of stale) gone.add(i.id)
      await update($, items, (l: Item[]) => l.filter(i => !gone.has(i.id)))
    }
  }
  // Nothing left to show: close the pane the mod opened. Re-read first, an item may have just started.
  if (autoOpened && o.autoClosePane !== false && cur.every(i => gone.has(i.id)) && (await read($, items)).length === 0) {
    autoOpened = false
    await Promise.resolve($.ui.close({ id: PANE })).catch(() => undefined)
  }
  if (o.showCost !== false && cur.length > 0) {
    const usd = (await $.session.usage().catch(() => undefined))?.cost?.usd
    if (typeof usd === 'number') {
      promptBase ??= usd
      const spend = { session: usd, turn: Math.max(0, usd - promptBase) }
      const old = await read($, spendAtom)
      if (old.session !== spend.session || old.turn !== spend.turn) await update($, spendAtom, () => spend)
    }
  }
  // The clock also ticks while finished items wait to be cleared, so their countdown moves.
  if (cur.some(i => !isDone(i)) || (clearAfter >= 0 && cur.length > 0)) await update($, clock, () => now)
}

async function clearDone($: any) {
  for (const i of await read($, items)) if (isDone(i)) gone.add(i.id)
  await update($, items, (l: Item[]) => l.filter(i => !gone.has(i.id)))
}

async function dismiss($: any, id: string) {
  gone.add(id)
  await update($, items, (l: Item[]) => l.filter(i => i.id !== id))
}

async function startTimer($: any) {
  const o = await live($)
  timer?.cancel()
  timer = $.clock.every(Math.max(250, Number(o.refreshSeconds ?? 1) * 1000), () => void sync($).catch(() => undefined))
}

async function setOpt($: any, field: string, value: boolean | number) {
  await update($, optsAtom, (o: Record<string, boolean | number>) => ({ ...o, [field]: value }))
  if (field === 'treeView') await update($, flat, () => null)
  const rows: { key: string }[] = await $.config.list()
  const row = rows.find(r => String(r.key).includes('agent-monitor') && String(r.key).split('.').pop() === field)
  if (!row) {
    $.ui.toast(`Setting "${field}" not found among ${rows.length} config rows`)
    return
  }
  const r = await $.config.set({ key: row.key, value })
  if (r?.deny) $.ui.toast(`Setting refused: ${r.deny}`)
  if (field === 'refreshSeconds') await startTimer($)
}

export const register: Register = (on, options) => {
  base = Object.fromEntries(Object.entries(options).filter(([, v]) => typeof v === 'boolean' || typeof v === 'number')) as Opts

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'monitor', description: 'Open the agent monitor pane' })
    await $.command.register({ name: 'monitor-settings', description: 'Open the agent monitor settings' })
    const mirror: Record<string, boolean | number> = {}
    for (const [k, v] of Object.entries(options)) if (typeof v === 'boolean' || typeof v === 'number') mirror[k] = v
    await update($, optsAtom, () => mirror)
    await startTimer($)
    return next(e)
  })

  on('command.run', { command: 'monitor' }, async $ => {
    autoOpened = false
    await $.ui.open({ id: PANE, title: 'Agent monitor', focus: true })
    return { text: 'Agent monitor opened.' }
  })

  on('command.run', { command: 'monitor-settings' }, async $ => {
    await $.ui.open({ id: SETTINGS, title: 'Monitor settings', focus: true })
    return { text: 'Agent monitor settings opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    void sync($).catch(() => undefined)
    return r
  })

  // Background shells, monitors, workflows and scheduled wakeups start at their tool call.
  on('tool.call', async ($, e, next) => {
    const x = e as unknown as Record<string, unknown>
    const id = e.tool_use_id
    const parentId = typeof x.agentId === 'string' ? x.agentId : undefined
    if (typeof x.agentId === 'string') tools[x.agentId] = String(e.tool)
    if (e.tool === 'Bash' && x.run_in_background === true) {
      await apply($, [{ id, parentId, kind: 'shell', label: oneLine(x.description || x.command), command: String(x.command ?? ''), type: 'bash', status: 'running' }])
    } else if (e.tool === 'Monitor') {
      // A monitor's end notice ends it (matched by task id). Its own timeout is the fallback, unless it is persistent.
      const ms = Number(x.timeout_ms)
      const until = x.persistent === true || !Number.isFinite(ms) ? undefined : await $.clock.now() + ms
      await apply($, [{ id, parentId, kind: 'task', type: 'monitor', label: oneLine(x.description), status: 'running', until }])
    } else if (e.tool === 'Workflow') {
      await apply($, [{ id, parentId, kind: 'task', type: 'workflow', label: oneLine(x.name || x.title || x.description || 'workflow'), status: 'running' }])
    } else if (e.tool === 'CronCreate') {
      await apply($, [{ id, parentId, kind: 'task', type: x.recurring === false ? 'once' : 'cron', label: oneLine(`${x.cron} ${x.prompt}`), status: 'running' }])
    } else if (e.tool === 'ScheduleWakeup' && x.stop !== true) {
      await apply($, [{ id, parentId, kind: 'task', type: 'wakeup', label: oneLine(`in ${x.delaySeconds ?? '?'}s ${x.reason ?? x.prompt ?? ''}`), status: 'running' }])
    }
    const r: any = await next(e)
    const text = typeof r?.text === 'string' ? r.text : ''
    const tracked = (e.tool === 'Bash' && x.run_in_background === true) || e.tool === 'Monitor' || e.tool === 'CronCreate'
    if (tracked) {
      // The tool's own text names the task or job id: "task abc", "job abc" or "ID: abc".
      const ref = /(?:task|job|ID:)\s+([a-z0-9]+)/i.exec(text)?.[1]
      const kind: Kind = e.tool === 'Bash' ? 'shell' : 'task'
      if (r?.isError || r?.deny) await apply($, [{ id, kind, status: 'failed' }])
      else if (ref) await apply($, [{ id, kind, ref }])
    } else if (e.tool === 'CronDelete' && !r?.isError && !r?.deny) {
      // Match the job by the id CronCreate reported. An unknown id (created before this mod loaded) ends nothing.
      const hit = (await read($, items)).find((i: Item) => i.ref === x.id && (i.type === 'cron' || i.type === 'once') && !isDone(i))
      if (hit) await apply($, [{ id: hit.id, kind: 'task', status: 'done' }])
    }
    return r
  })

  // A subagent's final turn: its answer is a free one-line preview, and optionally an AI summary.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const o = await live($)
      const first = oneLine(e.answer.split('\n').find(l => l.trim()))
      const note = o.showResultPreview !== false && first ? { note: clip(first, 160) } : {}
      void apply($, [{ id: e.agentId, kind: 'agent', status: e.isAborted ? 'killed' : 'done', ...note }])
      if (o.aiSummary === true && e.answer) void summarize($, e.agentId, e.answer)
    }
    return next(e)
  })

  // Task notifications and scheduled fires arrive as prompts: they say what ended.
  on('prompt.submit', async ($, e, next) => {
    // A task notice is not the person's prompt: the turn that handles it still counts toward the last prompt.
    if (!e.text.includes('<task-notification>') && (await live($)).showCost !== false) {
      promptBase = (await $.session.usage().catch(() => undefined))?.cost?.usd ?? promptBase
    }
    try {
      if (e.text.includes('<task-notification>')) {
        const cur: Item[] = await read($, items)
        const tag = (b: string, t: string) => new RegExp(`<${t}>([^<]+)</${t}>`).exec(b)?.[1].trim()
        for (const b of e.text.match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? []) {
          const [use, tid, st] = [tag(b, 'tool-use-id'), tag(b, 'task-id'), tag(b, 'status')]
          // The tool-use id is ours for shells and tasks. The task id also covers a notice that omits it.
          const it = cur.find(i => (use && i.id === use) || (tid && i.ref === tid))
          if (it && st) void apply($, [{ id: it.id, kind: it.kind, status: mapStatus(st) }])
        }
      }
      const origin = (e as unknown as { origin?: { kind?: string } }).origin
      if (origin?.kind === 'scheduled-trigger') {
        const live = (await read($, items)).filter((i: Item) => (i.type === 'wakeup' || i.type === 'once') && !isDone(i))
        if (live[0]) void apply($, [{ id: live[0].id, kind: 'task', status: 'done' }])
      }
    } catch {
      // Parsing is a shortcut: a miss only leaves an item showing as running.
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const o = await live($)
    if (o.showBand === false || e.props.hasSurvey) return next(e)
    const list: Item[] = await read($, items)
    if (list.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const now: number = await read($, clock)
    const spin = SPIN[Math.floor(now / 1000) % SPIN.length]
    const running = list.filter(i => !isDone(i))
    const batch: Batch = await read($, batchAtom)
    const tl = tally(batch, list)
    const done = tl.d
    const chips = ORDER.map(k => ({ k, n: running.filter(i => i.kind === k).length })).filter(c => c.n > 0)
    const latest = running.slice(-2)
    const P = palOf(o)
    const slow = running.filter(i => isStuck(i, now, Number(o.stuckAfterSeconds ?? 600))).length
    const spend: { session: number; turn: number } = await read($, spendAtom)
    const flash = o.flashOnFinish !== false && list.some(i => i.status === 'done' && i.endedAt && now - i.endedAt < FLASH_MS)

    return (
      <Box borderStyle="round" borderColor={stateColor(list, now, o)} paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold color={stateColor(list, now, o)}>{flash ? '✨' : stateEmoji(stateColor(list, now, o))} Agent monitor </Text>
          {chips.map(c => (
            <Text inverse color={P[c.k]}> {KINDS[c.k].icon} {c.n} </Text>
          ))}
          <Text> </Text>{bar(Text, tl.d, tl.t)}<Text dimColor> {tl.d}/{tl.t}  </Text>{slow > 0 && <Text color={WARN}>⚠️ {slow} slow  </Text>}
          {o.showCost !== false && spend.turn > 0 && <Text dimColor>💰 ~{fmtUsd(spend.turn)}  </Text>}
          {o.compactBand !== true && latest.map(i => (
            <Text dimColor>{clip(i.label, 28)} {dur(now - i.startedAt)}  </Text>
          ))}
        </Box>
        <Box>
          <Box>
            <Button key="open" label="🔍" onPress={() => $.ui.open({ id: PANE, title: 'Agent monitor', focus: true })} />
          </Box>
          <Box>
            <Button key="cfg" label="⚙️" onPress={() => $.ui.open({ id: SETTINGS, title: 'Monitor settings', focus: true })} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list: Item[] = await read($, items)
    const override = await read($, flat)
    const now: number = await read($, clock)
    const spin = SPIN[Math.floor(now / 1000) % SPIN.length]
    const o = await live($)
    const P = palOf(o)
    const shutList: string[] = await read($, collapsed)
    const lim = Number(o.stuckAfterSeconds ?? 600)
    const clearAfter = Number(o.clearAfterSeconds ?? 5)
    const isFlat = override ?? o.treeView === false
    const activeOnly: boolean = await read($, activeOnlyAtom)
    const spend: { session: number; turn: number } = await read($, spendAtom)
    const cols = Number((e.props as { bodyColumns?: number }).bodyColumns ?? 60) - 6
    const showButtons = o.showButtons !== false
    const running = list.filter(i => !isDone(i)).length
    const batch: Batch = await read($, batchAtom)
    const tl = tally(batch, list)
    const done = tl.d
    const failed = list.filter(i => i.status === 'failed' || i.status === 'killed').length
    const mood: Mood = list.some(i => i.status === 'failed') ? 'error' : list.some(i => isStuck(i, now, lim)) ? 'stuck' : running > 0 ? 'working' : list.length > 0 ? 'done' : 'idle'

    const glyph = (i: Item) => {
      if (isStuck(i, now, lim)) return <Text>⚠️</Text>
      if (o.flashOnFinish !== false && i.status === 'done' && i.endedAt && now - i.endedAt < FLASH_MS) return <Text>✨</Text>
      if (i.status === 'running') return o.showSpinner === false ? <Text>🟡</Text> : <Text color={P[i.kind]}>{spin}</Text>
      if (i.status === 'waiting' || i.status === 'idle') return <Text>⏸️</Text>
      if (i.status === 'failed') return <Text>🔴</Text>
      if (i.status === 'killed') return <Text>⛔</Text>
      return <Text>🟢</Text>
    }

    const money = (i: Item) => {
      if (o.showCost === false || i.kind !== 'agent') return ''
      const parts = [i.tokens ? fmtTok(i.tokens) + ' tok' : '', typeof i.usd === 'number' ? '~' + fmtUsd(i.usd) : ''].filter(Boolean)
      return parts.join(' · ')
    }
    const row = (i: Item, depth: number) => {
      const fin = isDone(i)
      const left = fin && clearAfter >= 0 ? Math.max(0, Math.ceil(clearAfter - (now - (i.endedAt ?? now)) / 1000)) : -1
      const meta = [!fin && i.tool, `⏱️ ${dur((i.endedAt ?? now) - i.startedAt)}`, money(i), left >= 0 && `🧹 ${left}s`].filter(Boolean).join(' · ')
      const stuck = isStuck(i, now, lim)
      const parent = i.parentId ? list.find(x => x.id === i.parentId) : undefined
      const pulse = parent && !isDone(parent) ? ['·', '•', '●'][Math.floor(now / 1000) % 3] : '─'
      const pre = depth > 0 ? '  '.repeat(depth - 1) + `└${pulse} ` : ''
      const room = Math.max(12, cols - pre.length - (i.type ? i.type.length + 2 : 0) - 6)
      return (
        <Box flexDirection="column" key={i.id}>
          <Box>
            <Text dimColor>{pre}</Text>
            {glyph(i)}
            <Text> </Text>
            {i.type && <Text inverse dimColor={fin} color={P[i.kind]}> {i.type} </Text>}
            <Text dimColor={fin} bold={!fin}> {i.label}</Text>
          </Box>
          <Box paddingLeft={pre.length + 3} justifyContent="space-between">
            <Box>
              {i.until && !fin && <Text>{bar(Text, now - i.startedAt, i.until - i.startedAt, 6, P.task)} </Text>}
              <Text dimColor={!stuck} color={stuck ? WARN : undefined}>{meta}</Text>
            </Box>
            <Box>
              {showButtons && i.kind === 'agent' && !fin && (
                <Button key={`v-${i.id}`} plain label="🔍" onPress={() => $.ui.view({ agentId: i.id })} />
              )}
              {showButtons && i.kind !== 'agent' && !fin && (
                <Button key={`x-${i.id}`} plain label="❌" onPress={() => dismiss($, i.id)} />
              )}
            </Box>
          </Box>
          {i.note && (
            <Box paddingLeft={pre.length + 2}>
              <Text dimColor italic>↳ {clip(i.note, Math.max(10, cols - pre.length - 4))}</Text>
            </Box>
          )}
        </Box>
      )
    }

    const ordered = (kind: Kind): { i: Item; depth: number }[] => {
      const mine = list.filter(i => i.kind === kind && (!activeOnly || !isDone(i)))
      if (isFlat || kind !== 'agent') {
        // Problems first: failed, stuck, running, waiting, then finished (newest first).
        const rank = (i: Item) => (isBad(i) && !isDone(i) ? 0 : isBad(i) ? 0 : isStuck(i, now, lim) ? 1 : i.status === 'running' ? 2 : isDone(i) ? 4 : 3)
        return mine.slice().reverse().sort((a, b) => rank(a) - rank(b)).map(i => ({ i, depth: 0 }))
      }
      const ids = new Set(mine.map(i => i.id))
      const out: { i: Item; depth: number }[] = []
      const walk = (parent: string | undefined, depth: number) => {
        for (const i of mine) {
          const isRoot = parent === undefined && (!i.parentId || !ids.has(i.parentId))
          if (isRoot || (parent !== undefined && i.parentId === parent)) {
            out.push({ i, depth })
            walk(i.id, depth + 1)
          }
        }
      }
      walk(undefined, 0)
      return out
    }

    const logList: LogEntry[] = await read($, logAtom)
    const hms = (at: number) => {
      try {
        return new Date(at).toTimeString().slice(0, 8)
      } catch {
        return ''
      }
    }
    const logLine = (e: LogEntry, n: number) => (
      <Text key={`${e.at}-${n}`} dimColor={e.icon === '▶'}>{hms(e.at)}  {e.icon} {e.text}</Text>
    )
    const rep = (c: string, n: number) => c.repeat(Math.max(0, Math.floor(n)))
    const lanes = list.slice().sort((a, b) => a.startedAt - b.startedAt).slice(-8)
    const t0 = lanes.length ? Math.min(...lanes.map(i => i.startedAt)) : now
    const span = Math.max(30000, now - t0)
    const W = Math.max(10, Math.min(40, cols - 12))
    const lane = (i: Item) => {
      const a = Math.min(W - 1, ((i.startedAt - t0) / span) * W)
      const b = Math.min(W, Math.max(a + 1, (((i.endedAt ?? now) - t0) / span) * W))
      const color = isBad(i) ? 'red' : isStuck(i, now, lim) ? WARN : P[i.kind]
      return (
        <Box key={`l-${i.id}`} flexDirection="column">
          <Text dimColor={isDone(i)}>{KINDS[i.kind].icon} {i.label}</Text>
          <Text>
            <Text dimColor color="gray">{rep('▰', a)}</Text>
            <Text color={color} dimColor={isDone(i) && !isBad(i)}>{rep('▰', b - Math.floor(a))}</Text>
            <Text dimColor color="gray">{rep('▰', W - b)}</Text>
            <Text dimColor> {dur((i.endedAt ?? now) - i.startedAt)}</Text>
          </Text>
        </Box>
      )
    }
    const section = (key: string, title: string, color: string, right: string, body: any) => {
      const shut = shutList.includes(key)
      return (
        <Box flexDirection="column" key={key} borderStyle="round" borderColor={color} paddingX={1} marginTop={1}>
          <Box justifyContent="space-between">
            <Button key={`c-${key}`} plain onPress={() => update($, collapsed, (l: string[]) => (l.includes(key) ? l.filter(x => x !== key) : [...l, key]))}>
              <Text bold color={color}>{shut ? '▸' : '▾'} {title}</Text>
            </Button>
            <Text dimColor>{right}</Text>
          </Box>
          {!shut && body}
        </Box>
      )
    }
    const nStuck = list.filter(i => isStuck(i, now, lim)).length
    const nFailed = list.filter(i => i.status === 'failed').length
    const liveOf = (k: Kind) => list.filter(i => i.kind === k && !isDone(i)).length
    const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`
    const parts = [
      nFailed > 0 && `🔴 ${nFailed} failed`,
      nStuck > 0 && `⚠️ ${nStuck} stuck`,
      liveOf('agent') > 0 && `🤖 ${plural(liveOf('agent'), 'agent')} working`,
      liveOf('shell') > 0 && `🖥️ ${liveOf('shell')} bash running`,
      liveOf('task') > 0 && `📄 ${plural(liveOf('task'), 'task')} in progress`,
    ].filter(Boolean)
    const statusLines = parts.length ? (parts as string[]) : [list.length > 0 ? '🟢 All done' : '💤 Waiting for work']
    const statusColor = parts.length || list.length > 0 ? stateColor(list, now, o) : 'gray'
    const sp = (batch.span ?? [0, 0]) as number[]
    const receipt = running === 0 && tl.t > 0
      ? `Last batch: ${ORDER.filter(k => tally(batch, list, k).t > 0).map(k => `${KINDS[k].icon} ${tally(batch, list, k).t}`).join(' · ')} · ⏱️ ${dur(Math.max(0, sp[1] - sp[0]))}`
      : ''

    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={stateColor(list, now, o)} paddingX={1} flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold color={stateColor(list, now, o)}>{stateEmoji(stateColor(list, now, o))} Agent monitor</Text>
            <Box>
              <Box>
                <Button key="cfg" label="⚙️" onPress={() => $.ui.open({ id: SETTINGS, title: 'Monitor settings', focus: true })} />
              </Box>
              {showButtons && (
                <Box>
                  <Box>
                    <Button key="layout" label={isFlat ? '🌲' : '📋'} onPress={() => update($, flat, () => !isFlat)} />
                  </Box>
                  <Box>
                    <Button key="active" label={activeOnly ? '👁️' : '🙈'} onPress={() => update($, activeOnlyAtom, () => !activeOnly)} />
                  </Box>
                  <Box>
                    <Button key="clear" label="🧹" onPress={() => clearDone($)} />
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
          <Box>
            <Text color="green">{running} running </Text>
            {list.some(i => isStuck(i, now, lim)) && <Text color={WARN}>· ⚠️ {list.filter(i => isStuck(i, now, lim)).length} stuck </Text>}
            <Text dimColor>· {tl.d}/{tl.t} done </Text>
            {failed > 0 && <Text color="red">· ❌ {failed} failed </Text>}
            {bar(Text, tl.d, tl.t, 16)}
          </Box>
          <Text dimColor>⚙️ settings {showButtons ? `· ${isFlat ? '🌲 tree' : '📋 list'} view · ${activeOnly ? '👁️ running only' : '🙈 all'} · 🧹 clear done · 🔍 view · ❌ hide` : ''}</Text>
        </Box>
        {ORDER.filter(k => on_(o, k)).map(k => {
          const rows = ordered(k)
          if (rows.length === 0) return <Box key={k} />
          const live = rows.filter(r => !isDone(r.i)).length
          const shut = shutList.includes(k)
          const complete = live === 0
          return (
            <Box flexDirection="column" key={k} borderStyle="round" borderColor={complete ? 'gray' : P[k]} paddingX={1} marginTop={1}>
              <Box justifyContent="space-between">
                <Button key={`c-${k}`} plain onPress={() => update($, collapsed, (l: string[]) => (l.includes(k) ? l.filter(x => x !== k) : [...l, k]))}>
                  <Text bold dimColor={complete} color={P[k]}>{shut ? '▸' : '▾'} {KINDS[k].icon} {KINDS[k].name}</Text>
                </Button>
                <Box>
                  <Text dimColor>{live}/{rows.length} </Text>
                  {bar(Text, tally(batch, list, k).d, tally(batch, list, k).t, 8, P[k], complete)}
                </Box>
              </Box>
              {!shut && rows.map(r => row(r.i, r.depth))}
            </Box>
          )
        })}
        {o.showTimeline !== false && lanes.length > 0 && section('timeline', '⏱️ Timeline', P.accent, `${lanes.length} lane${lanes.length > 1 ? 's' : ''}`, lanes.map(lane))}
        {o.showLog === true && logList.length > 0 && section('log', '📜 Event log', P.accent, 'newest first', [<Text key="legend" dimColor>▶ start · 🟢 done · 🔴 failed · ⛔ stopped</Text>, ...logList.slice(-6).reverse().map(logLine)])}
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          {statusLines.map(l => (
            <Text key={l} bold color={statusColor}>{l}</Text>
          ))}
          {receipt && <Text dimColor>{receipt}</Text>}
          {o.showCost !== false && spend.session > 0 && (
            <Text dimColor>💰 Subagents ~{fmtUsd(list.reduce((n, i) => n + (i.usd ?? 0), 0))} · Last prompt ~{fmtUsd(spend.turn)} · Session ~{fmtUsd(spend.session)}</Text>
          )}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const opts: Record<string, boolean | number> = await read($, optsAtom)

    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">⚙️ Settings </Text>
          <Text dimColor>apply instantly</Text>
        </Box>
        {SPEC.map(r => {
          const v = opts[r.key] ?? r.def
          return (
            <Box key={r.key} flexDirection="column" paddingX={1} marginTop={1}>
              <Box justifyContent="space-between">
                <Text bold>{r.label}</Text>
                {typeof r.def === 'boolean' ? (
                  <Button key={`t-${r.key}`} label={v === true ? '✅' : '☑️'} onPress={() => setOpt($, r.key, v !== true)} />
                ) : r.choices ? (
                  <Button
                    key={`s-${r.key}`}
                    label={`${r.choices.find(c => c.value === v)?.label ?? String(v)} ▾`}
                    onPress={() => {
                      const at = r.choices!.findIndex(c => c.value === v)
                      return setOpt($, r.key, r.choices![(at + 1) % r.choices!.length].value)
                    }}
                  />
                ) : (
                  <Input
                    key={`n-${r.key}`}
                    value={String(v)}
                    submitLabel="save"
                    onSubmit={(t: string) => {
                      const n = Number(t.trim())
                      if (t.trim() === '' || !Number.isFinite(n) || n < (r.min ?? 0)) return void $.ui.toast(`${r.label}: enter a number, minimum ${r.min ?? 0}`)
                      return setOpt($, r.key, n)
                    }}
                  />
                )}
              </Box>
              <Text dimColor>{r.desc}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}

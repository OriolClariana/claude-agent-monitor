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
  { key: 'cleanLayout', label: 'Clean layout', desc: 'Hide the help line, the duplicate header counts, section mini-bars and the status lines under the sections.', def: true },
  { key: 'showTiles', label: 'Summary tiles', desc: 'Three tiles under the header: running, done and cost.', def: true },
  { key: 'glowEffect', label: 'Glow', desc: 'A soft glow on running bars, the Running tile and the narrow-pane dots.', def: true },
  { key: 'pulseEffect', label: 'Pulse', desc: 'Running bars and the glow slowly pulse. Respects reduced motion.', def: true },
  { key: 'notifyToast', label: 'Toast on finish', desc: 'Show a toast when something finishes.', def: true },
  { key: 'notifySound', label: 'Sound on finish', desc: 'Play a chime when something finishes.', def: true },
  { key: 'showResultPreview', label: 'Result preview', desc: 'First line of a subagent answer. No tokens.', def: true },
  { key: 'aiSummary', label: 'AI summary (uses tokens)', desc: 'WARNING: sends each finished agent answer to a small model. Costs tokens.', def: false },
  { key: 'clearAfterSeconds', label: 'Clear finished after', desc: 'Press to change. How long finished items stay listed.', def: 5, choices: [{ label: 'Never', value: -1 }, { label: 'Instant', value: 0 }, { label: '5s', value: 5 }, { label: '10s', value: 10 }, { label: '20s', value: 20 }, { label: '1m', value: 60 }, { label: '5m', value: 300 }, { label: '10m', value: 600 }] },
  { key: 'stuckAfterSeconds', label: 'Flag as stuck after', desc: 'Press to change. Running items older than this turn orange.', def: 600, choices: [{ label: 'Off', value: 0 }, { label: '1m', value: 60 }, { label: '5m', value: 300 }, { label: '10m', value: 600 }, { label: '30m', value: 1800 }, { label: '1h', value: 3600 }] },
  { key: 'theme', label: 'Color theme', desc: 'Press to switch palette.', def: 0, choices: [{ label: 'Ocean', value: 0 }, { label: 'Sunset', value: 1 }, { label: 'Forest', value: 2 }, { label: 'Mono', value: 3 }, { label: 'Pastel', value: 4 }] },
  { key: 'refreshSeconds', label: 'Refresh interval (s)', desc: 'Type a number and press Enter. How often state is polled. Local only.', def: 1, step: 1, min: 1 },
]

// The settings pane groups the options under these headings, in this order.
const GROUP_ORDER = ['Show', 'Visual', 'Behavior', 'Alerts']
const GROUP_OF: Record<string, string> = {
  showSubagents: 'Show', showShell: 'Show', showTasks: 'Show', treeView: 'Show', showCost: 'Show', showResultPreview: 'Show', showTimeline: 'Show', showLog: 'Show',
  theme: 'Visual', cleanLayout: 'Visual', showBand: 'Visual', compactBand: 'Visual', showTiles: 'Visual', showSpinner: 'Visual', glowEffect: 'Visual', pulseEffect: 'Visual', flashOnFinish: 'Visual',
  notifyToast: 'Alerts', notifySound: 'Alerts', aiSummary: 'Alerts',
}
const groupOf = (key: string) => GROUP_OF[key] ?? 'Behavior'

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

// SVG drawings for the desktop pane (the terminal keeps the text rows).
const HEX: Record<string, string> = { cyan: '#22b8cf', yellow: '#f0b429', magenta: '#cc5de8', red: '#f03e3e', green: '#40c057', white: '#adb5bd', gray: '#868e96' }
const hex = (c: string) => HEX[c] ?? c
const SVG_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const SVG_CSS = `<style>.t{fill:#1f1f1f}.s{fill:#6b6b68}.k{fill:#ecebe8}.tile{fill:#f4f3f0}.br{stroke:#c4c3bf;fill:none}.rk{stroke:#e4e3df;fill:none}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.k{fill:#2c2c2b}.tile{fill:#262625}.br{stroke:#4a4a47}.rk{stroke:#3a3a38}}
.live{animation:p 1s ease-in-out infinite}@keyframes p{50%{opacity:.35}}
.spin{transform-box:fill-box;transform-origin:center;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.live,.spin{animation:none}}</style>`
const svgWrap = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${SVG_CSS}<defs><filter id="g" x="-50%" y="-80%" width="200%" height="260%"><feGaussianBlur stdDeviation="2.5"/></filter></defs>${body}</svg>`
const svgEsc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// Animations last exactly 1s and start `phase` seconds in, so a redraw continues them instead of restarting.
const anim = (fx: { phase?: number }, c: 'live' | 'spin') => ` class="${c}"${fx.phase ? ` style="animation-delay:-${fx.phase.toFixed(2)}s"` : ''}`
export type Fx = { glow: boolean; pulse: boolean; live?: boolean; spin?: boolean; phase?: number }

// Summary tiles: label on top, value below. A glowing tile gets a soft halo in its colour.
export const tilesSvg = (W: number, tiles: { k: string; v: string; c?: string; glow?: boolean; ring?: number; rc?: string }[], fx: { pulse: boolean; phase?: number } = { pulse: true }) => {
  const gap = 6
  const pad = 3
  const tw = (W - pad * 2 - gap * (tiles.length - 1)) / tiles.length
  return svgWrap(
    W,
    46,
    tiles
      .map((t, n) => {
        const x = pad + n * (tw + gap)
        const halo = t.glow && t.c
          ? `<rect${fx.pulse ? anim(fx, 'live') : ''} x="${x}" y="3" width="${tw}" height="40" rx="8" fill="none" stroke="${t.c}" stroke-width="2" filter="url(#g)"/><rect x="${x}" y="3" width="${tw}" height="40" rx="8" fill="none" stroke="${t.c}" stroke-width="1" opacity=".7"/>`
          : ''
        // A progress ring at the tile's far end: 0..1 of the circle in the tile's ring colour.
        const cx = x + tw - 22
        const circ = 2 * Math.PI * 10
        const ring = t.ring === undefined ? '' : `<circle class="rk" cx="${cx}" cy="23" r="10" stroke-width="3"/>${t.ring > 0 ? `<circle cx="${cx}" cy="23" r="10" fill="none" stroke="${t.rc}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(circ * Math.min(1, t.ring)).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} 23)"/>` : ''}`
        return `<rect class="tile" x="${x}" y="3" width="${tw}" height="40" rx="8"/>${halo}${ring}
<text class="s" x="${x + 9}" y="18" font-family="${SVG_FONT}" font-size="11">${svgEsc(t.k)}</text>
<text ${t.c ? `fill="${t.c}"` : 'class="t"'} x="${x + 9}" y="35" font-family="${SVG_FONT}" font-size="15" font-weight="600">${svgEsc(t.v)}</text>`
      })
      .join(''),
  )
}

// The band above the prompt in one drawing: state orb, live counts, progress, cost and the latest names.
export const bandSvg = (
  W: number,
  b: { color: string; live: boolean; flash: boolean; chips: { icon: string; n: number; c: string }[]; d: number; t: number; slow: number; cost: string; names: string[] },
  fx: Fx,
) => {
  const cls = fx.pulse && b.live ? anim(fx, 'live') : ''
  const out: string[] = []
  const txt = (x: number, body: string, attrs = 'class="s"', size = 12, weight = 400) =>
    out.push(`<text ${attrs} x="${x}" y="19" font-family="${SVG_FONT}" font-size="${size}" font-weight="${weight}">${svgEsc(body)}</text>`)
  out.push(b.flash ? `<text x="0" y="19" font-size="14">✨</text>` : `${fx.glow && b.live ? `<circle${cls} cx="9" cy="14" r="7" fill="${b.color}" filter="url(#g)"/>` : ''}<circle cx="9" cy="14" r="5" fill="${b.color}"/>`)
  let x = 24
  txt(x, 'Monitor', 'class="t"', 13, 600)
  x += 66
  for (const c of b.chips) {
    txt(x, `${c.icon} ${c.n}`, `fill="${c.c}"`, 13, 600)
    x += 36 + String(c.n).length * 7
  }
  const ratio = b.t > 0 ? Math.min(1, b.d / b.t) : 0
  const fw = Math.round(80 * ratio)
  out.push(`<rect class="k" x="${x}" y="11" width="80" height="6" rx="3"/>${fx.glow && b.live && fw > 0 ? `<rect${cls} x="${x}" y="11" width="${fw}" height="6" rx="3" fill="${b.color}" filter="url(#g)"/>` : ''}<rect${cls} x="${x}" y="11" width="${fw}" height="6" rx="3" fill="${b.color}"/>`)
  x += 90
  txt(x, `${b.d}/${b.t}`)
  x += (`${b.d}/${b.t}`.length) * 7 + 14
  if (b.slow > 0) {
    txt(x, `⚠️ ${b.slow} slow`, `fill="${WARN}"`)
    x += 74
  }
  if (b.cost) {
    txt(x, `💰 ${b.cost}`)
    x += (b.cost.length + 3) * 7 + 12
  }
  for (const n of b.names) {
    const room = Math.min(40, Math.floor((W - x - 8) / 6.6))
    if (room < 10) break
    const shown = clip(n, room)
    txt(x, shown)
    x += shown.length * 6.6 + 16
  }
  return svgWrap(W, 28, out.join('\n'))
}

// The pane's hero: a glowing state orb, the title, one line of status and a progress bar.
export const headerSvg = (W: number, h: { color: string; title: string; sub: string; ratio: number; live: boolean }, fx: Fx) => {
  const cls = fx.pulse && h.live ? anim(fx, 'live') : ''
  const fw = Math.round((W - 4) * Math.min(1, Math.max(0, h.ratio)))
  const glow = fx.glow && h.live ? `<circle${cls} cx="12" cy="16" r="8" fill="${h.color}" filter="url(#g)"/><rect${cls} x="2" y="44" width="${fw}" height="6" rx="3" fill="${h.color}" filter="url(#g)"/>` : ''
  return svgWrap(
    W,
    54,
    `${glow}<circle cx="12" cy="16" r="6" fill="${h.color}"/>
<text class="t" x="28" y="22" font-family="${SVG_FONT}" font-size="17" font-weight="600">${svgEsc(h.title)}</text>
<text class="s" x="28" y="39" font-family="${SVG_FONT}" font-size="12">${svgEsc(h.sub)}</text>
<rect class="k" x="2" y="45" width="${W - 4}" height="4" rx="2"/><rect${cls} x="2" y="45" width="${fw}" height="4" rx="2" fill="${h.color}"/>`,
  )
}

// The empty pane: two soft rings breathing around a moon.
export const emptySvg = (W: number, fx: Fx) => {
  const cx = W / 2
  const delay = fx.phase ? ` style="animation-delay:-${fx.phase.toFixed(2)}s"` : ''
  return svgWrap(
    W,
    72,
    `<circle class="rk" cx="${cx}" cy="36" r="28" stroke-width="2"/><circle class="${fx.pulse ? 'live ' : ''}rk"${delay} cx="${cx}" cy="36" r="20" stroke-width="2"/><text x="${cx}" y="43" text-anchor="middle" font-size="20">💤</text>`,
  )
}

// One timeline lane in a single row: label, a bar on the shared time axis, then the duration.
export const laneSvg = (W: number, label: string, from: number, to: number, color: string, time: string, fx: Fx) => {
  const lw = Math.floor(W * 0.4)
  const bx = lw + 8
  const bw = Math.max(40, W - bx - 48)
  const x = bx + Math.round(bw * Math.min(1, Math.max(0, from)))
  const w = Math.max(4, Math.min(bx + bw - x, Math.round(bw * (to - from))))
  const cls = fx.pulse && fx.live ? anim(fx, 'live') : ''
  const glow = fx.glow && fx.live ? `<rect${cls} x="${x}" y="8" width="${w}" height="6" rx="3" fill="${color}" filter="url(#g)"/>` : ''
  return svgWrap(
    W,
    22,
    `<text class="t" x="0" y="15" font-family="${SVG_FONT}" font-size="12">${svgEsc(clip(label, Math.floor(lw / 6.6)))}</text>
<rect class="k" x="${bx}" y="9" width="${bw}" height="4" rx="2"/>${glow}<rect${cls} x="${x}" y="9" width="${w}" height="4" rx="2" fill="${color}"${fx.live ? '' : ' opacity=".6"'}/>
<text class="s" x="${W}" y="15" text-anchor="end" font-family="${SVG_FONT}" font-size="11">${svgEsc(time)}</text>`,
  )
}

// One dot per item for narrow panes: running ones glow and pulse, the rest are solid.
export const stripSvg = (W: number, dots: { c: string; live: boolean }[], fx: Fx) => {
  const fit = Math.max(1, Math.floor((W - 36) / 14))
  const shown = dots.slice(0, fit)
  const more = dots.length - shown.length
  const cls = (d: { live: boolean }) => (fx.pulse && d.live ? anim(fx, 'live') : '')
  return svgWrap(
    W,
    24,
    shown
      .map((d, n) => `${fx.glow && d.live ? `<circle${cls(d)} cx="${8 + n * 14}" cy="12" r="6" fill="${d.c}" filter="url(#g)"/>` : ''}<circle${cls(d)} cx="${8 + n * 14}" cy="12" r="5" fill="${d.c}"/>`)
      .join('') + (more > 0 ? `<text class="s" x="${shown.length * 14 + 2}" y="16" font-family="${SVG_FONT}" font-size="11">+${more}</text>` : ''),
  )
}

export type RowState = 'running' | 'done' | 'failed' | 'killed' | 'waiting' | 'stuck' | 'flash'

// The status mark at the start of a row: a spinning ring while running.
const mark = (st: RowState, c: string, fx: Fx): string => {
  const o = 'cx="8" cy="12" r="6"'
  if (st === 'running') {
    if (fx.spin === false) return `<circle cx="8" cy="12" r="5" fill="${c}"/>`
    const arc = `${o} fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-dasharray="10 28"`
    return `<circle ${o} fill="none" stroke="${c}" stroke-width="2" opacity=".25"/>${fx.glow ? `<circle${anim(fx, 'spin')} ${arc} filter="url(#g)"/>` : ''}<circle${anim(fx, 'spin')} ${arc}/>`
  }
  const ico = (fill: string, d: string) => `<circle ${o} fill="${fill}"/><path d="${d}" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (st === 'flash') return `<text x="0" y="17" font-size="14">✨</text>`
  if (st === 'done') return ico('#40c057', 'M5 12.5l2.2 2.2L11.5 9.5')
  if (st === 'failed') return ico('#f03e3e', 'M5.5 9.5l5 5M10.5 9.5l-5 5')
  if (st === 'killed') return ico('#868e96', 'M5 12h6')
  if (st === 'stuck') return ico(WARN, 'M8 8.5v4M8 15v.1')
  return `<circle ${o} fill="#868e96"/><path d="M6.5 9.5v5M9.5 9.5v5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`
}

// The first line of a row in one drawing: mark, type chip, name, then the time at the far end.
export const rowHeadSvg = (
  W: number,
  h: { indent: number; chip?: string; label: string; time: string; state: RowState; color: string; dim: boolean; warn: boolean },
  fx: Fx,
) => {
  const x0 = h.indent
  const chipW = h.chip ? Math.round(h.chip.length * 6.8 + 12) : 0
  const lx = x0 + 22 + (h.chip ? chipW + 8 : 0)
  const max = Math.max(4, Math.floor((W - lx - Math.round(h.time.length * 6.4) - 14) / 6.8))
  const chip = h.chip
    ? `<rect x="${x0 + 22}" y="3" width="${chipW}" height="18" rx="4" fill="${h.color}"${h.dim ? ' opacity=".5"' : ''}/><text x="${x0 + 22 + chipW / 2}" y="16" text-anchor="middle" fill="#101010" font-family="${SVG_FONT}" font-size="11" font-weight="600">${svgEsc(h.chip)}</text>`
    : ''
  return svgWrap(
    W,
    24,
    `${x0 > 0 ? `<path class="br" stroke-width="1" d="M${x0 - 8} 0V12H${x0 - 2}"/>` : ''}<g transform="translate(${x0},0)">${mark(h.state, h.color, fx)}</g>${chip}
<text class="${h.dim ? 's' : 't'}" x="${lx}" y="16" font-family="${SVG_FONT}" font-size="13" font-weight="${h.dim ? 400 : 600}">${svgEsc(clip(h.label, max))}</text>
<text ${h.warn ? `fill="${WARN}"` : 'class="s"'} x="${W - 2}" y="16" text-anchor="end" font-family="${SVG_FONT}" font-size="11" font-variant-numeric="tabular-nums">${svgEsc(h.time)}</text>`,
  )
}

// The line under a section header while something runs: it glows and pulses.
export const accentSvg = (W: number, color: string, fx: Fx) => {
  const cls = fx.pulse ? anim(fx, 'live') : ''
  return svgWrap(W, 8, `${fx.glow ? `<rect${cls} x="4" y="2" width="${W - 8}" height="3" rx="1.5" fill="${color}" filter="url(#g)"/>` : ''}<rect${cls} x="4" y="3" width="${W - 8}" height="2" rx="1" fill="${color}"/>`)
}
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
export const tally = (b: Batch, list: Item[], kind?: Kind) => {
  let t = 0
  let d = 0
  for (const k of kind ? [kind] : ORDER) {
    const mine = list.filter(i => i.kind === k)
    const live = mine.filter(i => !isDone(i)).length
    // The batch only remembers finished items that were already cleared: what still runs is read from the list, so a stale batch cannot inflate the total.
    const done = b[k] ? Math.min(b[k][1], b[k][0]) : mine.length - live
    d += done
    t += done + live
  }
  return { t, d }
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
    const ui: any = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
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

    if (Svg) {
      // About 8 CSS px per column; the border, padding and the two buttons take the rest.
      const width = Math.max(180, Math.min(1600, Number(e.props.bodyColumns || 100) * 8 - 130))
      const names = o.compactBand === true ? [] : latest.map(i => `${i.label} ${dur(now - i.startedAt)}`)
      return (
        <Box borderStyle="round" borderColor={stateColor(list, now, o)} paddingX={1} justifyContent="space-between" alignItems="center">
          <Svg
            source={bandSvg(width, { color: hex(stateColor(list, now, o)), live: running.length > 0, flash, chips: chips.map(c => ({ icon: KINDS[c.k].icon, n: c.n, c: hex(P[c.k]) })), d: tl.d, t: tl.t, slow, cost: o.showCost !== false && spend.turn > 0 ? '~' + fmtUsd(spend.turn) : '', names }, { glow: o.glowEffect !== false, pulse: o.pulseEffect !== false, phase: (now % 1000) / 1000 })}
            alt={`Monitor: ${running.length} running, ${tl.d} of ${tl.t} done`}
            width={width}
            height={28}
          />
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
    }

    return (
      <Box borderStyle="round" borderColor={stateColor(list, now, o)} paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold color={stateColor(list, now, o)}>{flash ? '✨' : stateEmoji(stateColor(list, now, o))} Monitor </Text>
          {chips.map(c => (
            <Text bold color={P[c.k]}>{KINDS[c.k].icon} {c.n}  </Text>
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
    const ui: any = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
    const list: Item[] = await read($, items)
    const override = await read($, flat)
    const now: number = await read($, clock)
    const spin = SPIN[Math.floor(now / 1000) % SPIN.length]
    const o = await live($)
    const P = palOf(o)
    const shutList: string[] = await read($, collapsed)
    const toggle = (key: string) => update($, collapsed, (l: string[]) => (l.includes(key) ? l.filter(x => x !== key) : [...l, key]))
    const lim = Number(o.stuckAfterSeconds ?? 600)
    const clearAfter = Number(o.clearAfterSeconds ?? 5)
    const isFlat = override ?? o.treeView === false
    const activeOnly: boolean = await read($, activeOnlyAtom)
    const spend: { session: number; turn: number } = await read($, spendAtom)
    const cols = Number((e.props as { bodyColumns?: number }).bodyColumns ?? 60) - 6
    const showButtons = o.showButtons !== false
    const svgW = Math.max(200, Math.min(900, Number((e.props as { bodyColumns?: number }).bodyColumns ?? 40) * 8 - 8))
    const narrow = !!Svg && cols < 34
    const clean = o.cleanLayout !== false
    const tilesOn = !!Svg && o.showTiles !== false && list.length > 0
    const glowOn = o.glowEffect !== false
    const pulseOn = o.pulseEffect !== false
    const phase = (now % 1000) / 1000
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
      const meta = [!fin && i.tool, money(i), left >= 0 && `🧹 ${left}s`].filter(Boolean).join(' · ')
      const time = `⏱️ ${dur((i.endedAt ?? now) - i.startedAt)}`
      const stuck = isStuck(i, now, lim)
      const parent = i.parentId ? list.find(x => x.id === i.parentId) : undefined
      const pulse = parent && !isDone(parent) ? ['·', '•', '●'][Math.floor(now / 1000) % 3] : '─'
      const pre = depth > 0 ? '  '.repeat(depth - 1) + `└${pulse} ` : ''
      const room = Math.max(12, cols - pre.length - (i.type ? i.type.length + 2 : 0) - 6)
      const flashing = o.flashOnFinish !== false && i.status === 'done' && !!i.endedAt && now - i.endedAt < FLASH_MS
      const st: RowState = stuck ? 'stuck' : flashing ? 'flash' : i.status === 'running' ? 'running' : i.status === 'waiting' || i.status === 'idle' ? 'waiting' : i.status === 'failed' ? 'failed' : i.status === 'killed' ? 'killed' : 'done'
      const buttons = (
        <Box>
          {showButtons && i.kind === 'agent' && !fin && <Button key={`v-${i.id}`} plain label="🔍" onPress={() => $.ui.view({ agentId: i.id })} />}
          {showButtons && i.kind !== 'agent' && !fin && <Button key={`x-${i.id}`} plain label="❌" onPress={() => dismiss($, i.id)} />}
        </Box>
      )
      const rowW = Math.max(120, svgW - 48 - (showButtons && !fin ? 44 : 0))
      return (
        <Box flexDirection="column" key={i.id}>
          {Svg ? (
            <Box justifyContent="space-between">
              <Svg
                source={rowHeadSvg(rowW, { indent: depth > 0 ? depth * 16 : 0, chip: i.type, label: i.label, time: dur((i.endedAt ?? now) - i.startedAt), state: st, color: hex(isBad(i) ? 'red' : P[i.kind]), dim: fin && !isBad(i), warn: stuck }, { glow: glowOn, pulse: pulseOn, spin: o.showSpinner !== false, phase })}
                alt={`${i.label}: ${i.status}`}
                width={rowW}
                height={24}
              />
              {buttons}
            </Box>
          ) : (
          <Box justifyContent="space-between">
            <Box>
              <Text dimColor>{pre}</Text>
              {glyph(i)}
              <Text> </Text>
              {i.type && <Text inverse dimColor={fin} color={P[i.kind]}> {i.type} </Text>}
              <Text dimColor={fin} bold={!fin}> {clip(i.label, Math.max(10, room - 10))}</Text>
            </Box>
            <Box>
              <Text dimColor={!stuck} color={stuck ? WARN : undefined}>{time} </Text>
              {buttons}
            </Box>
          </Box>
          )}
          {(meta || (i.until && !fin)) && (
            <Box paddingLeft={pre.length + 3}>
              {i.until && !fin && <Text>{bar(Text, now - i.startedAt, i.until - i.startedAt, 6, P.task)} </Text>}
              <Text dimColor>{meta}</Text>
            </Box>
          )}
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
      if (Svg) {
        const color = hex(isBad(i) ? 'red' : isStuck(i, now, lim) ? WARN : P[i.kind])
        const from = (i.startedAt - t0) / span
        const to = ((i.endedAt ?? now) - t0) / span
        return (
          <Svg key={`l-${i.id}`} source={laneSvg(svgW - 48, `${KINDS[i.kind].icon} ${i.label}`, from, to, color, dur((i.endedAt ?? now) - i.startedAt), { glow: glowOn, pulse: pulseOn, live: !isDone(i), phase })} alt={`${i.label}: ${i.status}`} width={svgW - 48} height={22} />
        )
      }
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
    // A full-row button: the title, then the running and done counts pushed to the far end with spaces.
    const head = (key: string, title: string, color: string, shut: boolean, live: number, right: string) => {
      const dot = ({ agent: '🔵', shell: '🟡', task: '🟣' } as Record<string, string>)[key] ?? '🟢'
      const run = live > 0 ? `${dot} ${live} running  ` : ''
      const pad = Math.max(2, Math.round((cols - title.length - right.length - run.length - 6) * 1.7))
      return (
        <Box flexDirection="column" key={`h-${key}`}>
          <Button key={`c-${key}`} onPress={() => toggle(key)}>
            <Text bold>{shut ? '▸' : '▾'} {title}</Text>
            <Text>{' '.repeat(pad)}</Text>
            {live > 0 && <Text bold color={color}>{run}</Text>}
            <Text dimColor>{right}</Text>
          </Button>
          {Svg && live > 0 && <Svg source={accentSvg(svgW - 40, hex(color), { glow: glowOn, pulse: pulseOn, phase })} alt="running" width={svgW - 40} height={8} />}
        </Box>
      )
    }
    const section = (key: string, title: string, color: string, right: string, body: any) => {
      const shut = shutList.includes(key)
      return (
        <Box flexDirection="column" key={key} borderStyle="round" borderColor={Svg ? 'gray' : color} paddingX={1} marginTop={1}>
          {Svg ? (
            head(key, title, color, shut, 0, right)
          ) : (
          <Box justifyContent="space-between">
            <Button key={`c-${key}`} label={`${shut ? '▸' : '▾'} ${title}`} onPress={() => update($, collapsed, (l: string[]) => (l.includes(key) ? l.filter(x => x !== key) : [...l, key]))} />
            <Text dimColor>{right}</Text>
          </Box>
          )}
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
            {Svg ? (
              <Svg
                source={headerSvg(Math.max(120, svgW - 48 - 170), { color: hex(stateColor(list, now, o)), title: 'Agent monitor', sub: running > 0 ? `${running} running · ${tl.d} of ${tl.t} done${failed > 0 ? ` · ${failed} failed` : ''}` : tl.t > 0 ? `All ${tl.t} done` : 'Waiting for work', ratio: tl.t > 0 ? tl.d / tl.t : 0, live: running > 0 }, { glow: glowOn, pulse: pulseOn, phase })}
                alt={`Agent monitor: ${running} running`}
                width={Math.max(120, svgW - 48 - 170)}
                height={54}
              />
            ) : (
              <Text bold color={stateColor(list, now, o)}>{stateEmoji(stateColor(list, now, o))} Agent monitor</Text>
            )}
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
          {!(clean && tilesOn) && (
          <Box>
            <Text color="green">{running} running </Text>
            {list.some(i => isStuck(i, now, lim)) && <Text color={WARN}>· ⚠️ {list.filter(i => isStuck(i, now, lim)).length} stuck </Text>}
            <Text dimColor>· {tl.d}/{tl.t} done </Text>
            {failed > 0 && <Text color="red">· ❌ {failed} failed </Text>}
            {bar(Text, tl.d, tl.t, 16)}
          </Box>
          )}
          {!clean && <Text dimColor>⚙️ settings {showButtons ? `· ${isFlat ? '🌲 tree' : '📋 list'} view · ${activeOnly ? '👁️ running only' : '🙈 all'} · 🧹 clear done · 🔍 view · ❌ hide` : ''}</Text>}
        </Box>
        {tilesOn && (
          <Box marginTop={1}>
            <Svg
              source={tilesSvg(svgW, [
                { k: 'Running', v: String(running), c: running > 0 ? hex(P.accent) : undefined, glow: glowOn && running > 0 },
                { k: 'Done', v: `${tl.d}/${tl.t}`, ring: tl.t > 0 ? tl.d / tl.t : 0, rc: hex(P.accent) },
                failed > 0 ? { k: 'Failed', v: String(failed), c: hex('red') } : o.showCost !== false && spend.session > 0 ? { k: 'Session', v: '~' + fmtUsd(spend.session) } : { k: 'Total', v: String(list.length) },
              ], { pulse: pulseOn, phase })}
              alt={`${running} running, ${tl.d} of ${tl.t} done`}
              width={svgW}
              height={46}
            />
          </Box>
        )}
        {Svg && list.length === 0 && (
          <Box marginTop={1}>
            <Svg source={emptySvg(svgW, { glow: glowOn, pulse: pulseOn, phase })} alt="Waiting for work" width={svgW} height={72} />
          </Box>
        )}
        {narrow && (
          <Box marginTop={1}>
            <Svg source={stripSvg(svgW, list.map(i => ({ c: hex(isBad(i) ? 'red' : isStuck(i, now, lim) ? WARN : P[i.kind]), live: !isDone(i) })), { glow: glowOn, pulse: pulseOn, phase })} alt={`${list.length} items`} width={svgW} height={24} />
          </Box>
        )}
        {!narrow && ORDER.filter(k => on_(o, k)).map(k => {
          const rows = ordered(k)
          if (rows.length === 0) return <Box key={k} />
          const live = rows.filter(r => !isDone(r.i)).length
          const shut = shutList.includes(k)
          const complete = live === 0
          const tt = tally(batch, list, k)
          const beat = pulseOn && Math.floor(now / 1000) % 2 ? '◉' : '●'
          return (
            <Box flexDirection="column" key={k} borderStyle="round" borderColor={Svg || complete ? 'gray' : P[k]} paddingX={1} marginTop={1}>
              {Svg ? (
                head(k, `${KINDS[k].icon} ${KINDS[k].name}`, complete ? 'gray' : P[k], shut, live, complete ? `✅ all ${tt.t} done` : `✅ ${tt.d} of ${tt.t} done`)
              ) : (
              <Box justifyContent="space-between">
                <Button key={`c-${k}`} label={`${shut ? '▸' : '▾'} ${KINDS[k].icon} ${KINDS[k].name}`} onPress={() => update($, collapsed, (l: string[]) => (l.includes(k) ? l.filter(x => x !== k) : [...l, k]))} />
                <Box>
                  {live > 0 && <Text bold color={P[k]}>{beat} {live} running  </Text>}
                  <Text dimColor>{complete ? `✓ all ${tt.t} done` : `✓ ${tt.d} of ${tt.t} done`} </Text>
                  {!clean && bar(Text, tally(batch, list, k).d, tally(batch, list, k).t, 8, P[k], complete)}
                </Box>
              </Box>
              )}
              {!shut && rows.map(r => row(r.i, r.depth))}
            </Box>
          )
        })}
        {o.showTimeline !== false && lanes.length > 0 && section('timeline', '⏱️ Timeline', P.accent, `${lanes.length} lane${lanes.length > 1 ? 's' : ''}`, lanes.map(lane))}
        {o.showLog === true && logList.length > 0 && section('log', '📜 Event log', P.accent, 'newest first', [<Text key="legend" dimColor>▶ start · 🟢 done · 🔴 failed · ⛔ stopped</Text>, ...logList.slice(-6).reverse().map(logLine)])}
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          {(!clean || running === 0) && statusLines.map(l => (
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
        {SPEC.slice().sort((x, y) => GROUP_ORDER.indexOf(groupOf(x.key)) - GROUP_ORDER.indexOf(groupOf(y.key))).map((r, n, all) => {
          const v = opts[r.key] ?? r.def
          const g = groupOf(r.key)
          return (
            <Box key={r.key} flexDirection="column">
              {(n === 0 || groupOf(all[n - 1].key) !== g) && (
                <Box paddingX={1} marginTop={1} borderStyle="round" borderColor="cyan">
                  <Text bold color="cyan">{g}</Text>
                </Box>
              )}
              <Box flexDirection="column" paddingX={1} marginTop={1}>
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
            </Box>
          )
        })}
      </Box>
    )
  })
}

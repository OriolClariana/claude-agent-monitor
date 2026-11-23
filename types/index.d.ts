export type Kind = 'agent' | 'shell' | 'task'
export type Status = 'running' | 'waiting' | 'idle' | 'done' | 'failed' | 'killed'

export type LogEntry = { at: number; icon: string; text: string }

export type Item = {
  id: string
  kind: Kind
  label: string
  type?: string
  parentId?: string
  status: Status
  startedAt: number
  endedAt?: number
  until?: number
  tool?: string
  command?: string
  ref?: string
  tokens?: number
  usd?: number
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': {
      items: Shaped<Item[]>
      flat: Shaped<boolean | null>
      now: number
      collapsed: Shaped<string[]>
      batch: Shaped<Record<string, number[]>>
      log: Shaped<LogEntry[]>
      opts: Shaped<Record<string, boolean | number>>
      spend: Shaped<{ session: number; turn: number }>
      activeOnly: Shaped<boolean>
    }
  }
}

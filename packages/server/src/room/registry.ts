import type { Engine } from '@cardgame/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEngine = Engine<any, any>

const engines = new Map<string, AnyEngine>()

export function registerEngine(engine: AnyEngine): void {
  engines.set(engine.id, engine)
}

export function getEngine(id: string): AnyEngine {
  const e = engines.get(id)
  if (!e) throw new Error(`玩法未注册：${id}`)
  return e
}

export function listEngines(): string[] {
  return [...engines.keys()]
}

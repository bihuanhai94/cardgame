export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'join'; roomId: string }
  | { t: 'leave' }
  | { t: 'action'; action: unknown }
  | { t: 'start' }
  | { t: 'ping' }

export type ServerMessage =
  | { t: 'authOk'; userId: string }
  | { t: 'roomState'; roomId: string; ownerId: string; seats: SeatInfo[]; started: boolean }
  | { t: 'gameView'; view: unknown }
  | { t: 'events'; events: { type: string; payload?: unknown }[] }
  | { t: 'settled'; deltas: Record<string, number> }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' }

export interface SeatInfo {
  index: number
  userId: string | null
  nickname: string | null
  online: boolean
  isAi: boolean
}

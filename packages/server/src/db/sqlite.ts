import { createRequire } from 'node:module'

// Vite 5 无法解析 node:sqlite（剥掉 node: 前缀后 sqlite 不在 builtinModules 中），
// 用 createRequire 在运行时加载以绕开其静态分析。
const nodeRequire = createRequire(import.meta.url)

export const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')
export type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

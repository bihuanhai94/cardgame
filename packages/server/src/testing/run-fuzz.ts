import { highCard } from '../games/highcard.js'
import { zhajinhua, type ZjhState } from '../games/zhajinhua.js'
import { fuzzEngine } from './fuzz.js'

const gameId = process.argv[2] ?? 'highcard'
const rounds = Number(process.argv[3] ?? 100000)

const started = Date.now()
let totalRounds = 0
let totalActions = 0

switch (gameId) {
  case 'highcard': {
    const result = fuzzEngine(highCard, {
      rounds,
      players: ['a', 'b', 'c'],
      options: { ante: 100 },
      probeIllegal: true,
    })
    totalRounds = result.rounds
    totalActions = result.actions
    break
  }
  case 'zhajinhua': {
    // 手牌逐局随机，secretProbe 只接受单个固定字符串，所以逐局 peek 一次
    // engine.init 取 owner 手牌的 JSON 表示作为该局专属探针，再以 rounds: 1
    // 跑一局 fuzz——只调用引擎已公开的 init，不改动引擎本身。
    const players = ['a', 'b', 'c']
    const options = { ante: 100, maxRounds: 10 }
    const owner = players[0]!
    for (let round = 0; round < rounds; round++) {
      const state = zhajinhua.init({ seed: round + 1, players, options }) as ZjhState
      const probe = JSON.stringify(state.hands[owner])
      const result = fuzzEngine(zhajinhua, {
        rounds: 1,
        players,
        options,
        probeIllegal: true,
        secretProbe: probe,
        secretOwner: owner,
      })
      totalRounds += result.rounds
      totalActions += result.actions
    }
    break
  }
  default:
    throw new Error(`未知玩法 id：${gameId}`)
}

console.log(
  `[${gameId}] 通过 ${totalRounds} 局，共 ${totalActions} 个动作，耗时 ${Date.now() - started}ms`,
)

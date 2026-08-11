import { highCard } from '../games/highcard.js'
import { zhajinhua, type ZjhState } from '../games/zhajinhua.js'
import { fuzzEngine } from './fuzz.js'

const gameId = process.argv[2] ?? 'highcard'
const rounds = Number(process.argv[3] ?? 100000)

const started = Date.now()
let result: { rounds: number; actions: number }

switch (gameId) {
  case 'highcard': {
    result = fuzzEngine(highCard, {
      rounds,
      players: ['a', 'b', 'c'],
      options: { ante: 100 },
      probeIllegal: true,
    })
    break
  }
  case 'zhajinhua': {
    // secretProbe 是单个固定字符串，但炸金花每局手牌不同，需要按局给出探针。
    // secretFor 拿到的是 fuzzEngine 自己 init 出来的该局初始状态，不用（也不能）
    // 自己重新派生种子，因此不会跟内部真正玩的那一局手牌错位。
    const players = ['a', 'b', 'c']
    const options = { ante: 100, maxRounds: 10 }
    const owner = players[0]!
    result = fuzzEngine(zhajinhua, {
      rounds,
      players,
      options,
      probeIllegal: true,
      secretFor: (_round, state: ZjhState) => ({
        probe: JSON.stringify(state.hands[owner]),
        owner,
      }),
    })
    break
  }
  default:
    throw new Error(`未知玩法 id：${gameId}`)
}

console.log(
  `[${gameId}] 通过 ${result.rounds} 局，共 ${result.actions} 个动作，耗时 ${Date.now() - started}ms`,
)

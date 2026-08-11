import { highCard } from '../games/highcard.js'
import { fuzzEngine } from './fuzz.js'

const rounds = Number(process.argv[2] ?? 100000)
const started = Date.now()
const result = fuzzEngine(highCard, {
  rounds,
  players: ['a', 'b', 'c'],
  options: { ante: 100 },
  probeIllegal: true,
})
console.log(
  `通过 ${result.rounds} 局，共 ${result.actions} 个动作，耗时 ${Date.now() - started}ms`,
)

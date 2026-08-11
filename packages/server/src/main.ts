import { openDb } from './db/open.js'
import { buildApp } from './http/routes.js'
import { RoomManager } from './room/room.js'
import { registerEngine } from './room/registry.js'
import { highCard } from './games/highcard.js'
import { zhajinhua } from './games/zhajinhua.js'
import { attachGateway } from './ws/gateway.js'
import { checkGlobalInvariant } from './domain/ledger.js'

const DB_PATH = process.env.CARDGAME_DB ?? '/opt/cardgame/data/cardgame.db'
const PORT = Number(process.env.PORT ?? 3100)
const HOST = process.env.HOST ?? '127.0.0.1'

const db = openDb(DB_PATH)

const invariant = checkGlobalInvariant(db)
if (!invariant.ok) {
  console.error(`账本零和不变量被破坏，总和为 ${invariant.total}，拒绝启动`)
  process.exit(1)
}

registerEngine(highCard)
registerEngine(zhajinhua)

const rooms = new RoomManager()
const app = buildApp({ db, rooms })

await app.listen({ port: PORT, host: HOST })
attachGateway(app.server, { db, rooms })
console.log(`cardgame 已启动：http://${HOST}:${PORT}`)

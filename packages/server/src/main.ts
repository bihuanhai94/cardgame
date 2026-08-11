import { openDb } from './db/open.js'
import { RoomManager } from './room/room.js'
import { buildApp } from './http/routes.js'

const PORT = parseInt(process.env.PORT || '3000', 10)
const db = openDb(process.env.DATABASE_URL || './cardgame.db')
const rooms = new RoomManager()

const app = buildApp({ db, rooms })

app.listen({ port: PORT, host: '0.0.0.0' }, (err, addr) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening on ${addr}`)
})

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const LIMIT = 300 * 1024
const dir = 'packages/web/dist/assets'

let total = 0
for (const name of readdirSync(dir)) {
  if (!/\.(js|css)$/.test(name)) continue
  const path = join(dir, name)
  if (!statSync(path).isFile()) continue
  const gz = gzipSync(readFileSync(path)).length
  total += gz
  console.log(`${name}  ${(gz / 1024).toFixed(1)} KB (gzip)`)
}

console.log(`合计 ${(total / 1024).toFixed(1)} KB / 上限 ${(LIMIT / 1024).toFixed(0)} KB`)
if (total > LIMIT) {
  console.error('首屏体积超出上限')
  process.exit(1)
}


import { connect } from './src/index.ts'
const client = await connect(process.argv[2], { onStateChange: (s) => console.error('[state]', s), onDeviceToken: (t) => console.error('[resumeToken]', t.slice(0,12)+'...') })
console.log('HANDSHAKE OK, tunnel open')
const res = await client.fetch('/')
const html = await res.text()
console.log('GET / via tunnel:', res.status, '| bytes:', html.length, '| __DSH_BOOT__:', html.includes('__DSH_BOOT__'))
const pair = await client.fetch('/pair/devices')
console.log('GET /pair/devices via tunnel:', pair.status, await pair.text())
client.close()
process.exit(0)

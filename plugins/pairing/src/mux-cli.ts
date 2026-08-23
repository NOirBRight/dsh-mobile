/** Standalone Public Endpoint mux: one loopback origin in front of several Host Gateways. */
import { pathToFileURL } from 'node:url'
import { createEndpointMux } from './endpoint-mux.ts'

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

export function parseMuxCliOptions(env: NodeJS.ProcessEnv): { bind: '127.0.0.1' | '::1' | 'localhost'; port: number; backends: number[] } {
  const bind = env.DSH_PAIR_MUX_BIND ?? '127.0.0.1'
  if (!LOOPBACK.has(bind)) throw new Error('DSH_PAIR_MUX_BIND must be loopback')
  const port = Number(env.DSH_PAIR_MUX_PORT ?? '0')
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('DSH_PAIR_MUX_PORT must be an integer 0-65535')
  const rawBackends = env.DSH_PAIR_MUX_BACKENDS
  if (rawBackends === undefined || rawBackends.trim() === '') {
    throw new Error('DSH_PAIR_MUX_BACKENDS must be a comma-separated list of this Host\'s Gateway ports')
  }
  const backends = rawBackends
    .split(',')
    .map(part => Number(part.trim()))
    .filter(value => Number.isInteger(value) && value > 0 && value <= 65535)
  if (backends.length === 0) throw new Error('DSH_PAIR_MUX_BACKENDS must be a comma-separated list of this Host\'s Gateway ports')
  return { bind: bind as '127.0.0.1' | '::1' | 'localhost', port, backends }
}

async function main(): Promise<void> {
  const options = parseMuxCliOptions(process.env)
  const mux = createEndpointMux(options)
  const listened = await mux.listen()
  console.log('dsh-pair-mux listening on ' + options.bind + ':' + listened + ' backends ' + options.backends.join(','))
  const stop = (): void => {
    void mux.close().then(() => process.exit(0))
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

import Fastify, { FastifyInstance } from 'fastify'
import { registerLivekitWebhookRoute } from './routes/livekitWebhook.js'

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true })

  app.get('/health', async () => ({ status: 'ok' }))
  registerLivekitWebhookRoute(app)

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildServer()
  app.listen({ port: 3000, host: '0.0.0.0' })
}

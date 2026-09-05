import Fastify, { FastifyInstance } from 'fastify'
import { registerLivekitWebhookRoute } from './routes/livekitWebhook.js'
import { registerDeepgramWebhookRoute } from './routes/deepgramWebhook.js'
import { registerRoomsRoute } from './routes/rooms.js'
import { registerProposedTasksRoute } from './routes/proposedTasks.js'
import { registerMeetingDataRoute } from './routes/meetingData.js'

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true })

  app.get('/health', async () => ({ status: 'ok' }))
  registerLivekitWebhookRoute(app)
  registerDeepgramWebhookRoute(app)
  registerRoomsRoute(app)
  registerProposedTasksRoute(app)
  registerMeetingDataRoute(app)

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildServer()
  app.listen({ port: 3000, host: '0.0.0.0' })
}

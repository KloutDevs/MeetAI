import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { registerLivekitWebhookRoute } from './routes/livekitWebhook.js'
import { registerDeepgramWebhookRoute } from './routes/deepgramWebhook.js'
import { registerRoomsRoute } from './routes/rooms.js'
import { registerProposedTasksRoute } from './routes/proposedTasks.js'
import { registerMeetingDataRoute } from './routes/meetingData.js'
import { registerRetryTranscriptionRoute } from './routes/retryTranscription.js'

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true })

  const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/^["']|["']$/g, '').replace(/\/$/, ''))
    .filter(Boolean)

  app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true
  })

  app.get('/health', async () => ({ status: 'ok' }))
  registerLivekitWebhookRoute(app)
  registerDeepgramWebhookRoute(app)
  registerRoomsRoute(app)
  registerProposedTasksRoute(app)
  registerMeetingDataRoute(app)
  registerRetryTranscriptionRoute(app)

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildServer()
  app.listen({ port: 3000, host: '0.0.0.0' })
}

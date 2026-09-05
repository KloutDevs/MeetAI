import type { FastifyInstance } from 'fastify'
import { WebhookReceiver } from 'livekit-server-sdk'
import { dispatchTrackForTranscription } from '../services/deepgramDispatch.js'

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
)

// Stubbed for this task — real participant resolution depends on the
// LiveKit room-management sub-project (metadata set at egress-start time).
function resolveParticipantId(trackFilename: string): string {
  return trackFilename.split('.')[0]
}

export function registerLivekitWebhookRoute(app: FastifyInstance): void {
  // LiveKit signs the raw request body, so we must not let Fastify's
  // default JSON parser touch it (and it also may arrive without a
  // recognized Content-Type header). Read it as a raw string instead.
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body)
  })

  app.post('/webhooks/livekit-egress', async (request, reply) => {
    const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
    const authHeader = request.headers.authorization ?? ''

    const event = await receiver.receive(body, authHeader)

    // The SDK types egressInfo.status as the protobuf EgressStatus enum, but
    // the webhook payload's JSON representation transmits it as its string
    // name (protobuf-es JSON convention), hence the cast below.
    const status = event.egressInfo?.status as unknown as string | undefined
    if (event.event !== 'egress_ended' || status !== 'EGRESS_COMPLETE') {
      return reply.code(200).send({ received: true })
    }

    const egressInfo = event.egressInfo!
    const meetingId = egressInfo.roomName!
    const callbackBaseUrl = process.env.BACKEND_PUBLIC_URL!

    for (const file of egressInfo.fileResults ?? []) {
      await dispatchTrackForTranscription({
        meetingId,
        trackId: file.filename,
        participantId: resolveParticipantId(file.filename),
        trackUrl: file.location,
        callbackBaseUrl
      })
    }

    return reply.code(200).send({ received: true })
  })
}

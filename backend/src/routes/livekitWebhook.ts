import type { FastifyInstance } from 'fastify'
import { DirectFileOutput, EgressClient, TrackType, WebhookReceiver } from 'livekit-server-sdk'
import { dispatchTrackForTranscription } from '../services/deepgramDispatch.js'

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
)

const egressClient = new EgressClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
)

// Stubbed for this task — real participant resolution depends on the
// LiveKit room-management sub-project (metadata set at egress-start time).
function resolveParticipantId(trackFilename: string): string {
  return trackFilename.split('.')[0]
}

export function registerLivekitWebhookRoute(app: FastifyInstance): void {
  // Registered inside an encapsulated child context so the raw-string
  // content-type parser below only applies to this route, not to /health
  // or any future route registered directly on the shared `app` instance.
  app.register(async (instance) => {
    // LiveKit signs the raw request body, so we must not let Fastify's
    // default JSON parser touch it (and it also may arrive without a
    // recognized Content-Type header). Read it as a raw string instead.
    instance.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body)
    })

    instance.post('/webhooks/livekit-egress', async (request, reply) => {
      const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
      const authHeader = request.headers.authorization ?? ''

      const event = await receiver.receive(body, authHeader)

      // Unlike egressInfo.status below, WebhookEvent.fromJson (the real
      // decode path used by WebhookReceiver.receive, verified against the
      // installed livekit-server-sdk@2.9.0 / @livekit/protocol) decodes
      // proto enum JSON names into their numeric TS enum values, so
      // event.track.type really is the numeric TrackType and this direct
      // comparison against TrackType.AUDIO (0) is correct as-is.
      if (event.event === 'track_published') {
        if (event.track?.type === TrackType.AUDIO) {
          const roomName = event.room!.name
          const participantId = event.participant!.identity
          await egressClient.startTrackEgress(
            roomName,
            new DirectFileOutput({ filepath: `${roomName}/${participantId}.ogg` }),
            event.track.sid
          )
        }
        return reply.code(200).send({ received: true })
      }

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
  })
}

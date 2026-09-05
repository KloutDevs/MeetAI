import type { FastifyInstance } from 'fastify'
import { DirectFileOutput, EgressClient, EgressStatus, S3Upload, TrackType, WebhookReceiver } from 'livekit-server-sdk'
import { dispatchTrackForTranscription } from '../services/deepgramDispatch.js'

function s3Output(filepath: string): DirectFileOutput {
  return new DirectFileOutput({
    filepath,
    output: {
      case: 's3',
      value: new S3Upload({
        accessKey: process.env.S3_ACCESS_KEY!,
        secret: process.env.S3_SECRET_KEY!,
        bucket: process.env.S3_BUCKET!,
        region: process.env.S3_REGION ?? 'auto',
        endpoint: process.env.S3_ENDPOINT!,
        forcePathStyle: true
      })
    }
  })
}

// LiveKit's egress_ended callback reports `location` as the S3 API endpoint
// URL (private, not fetchable by Deepgram). We rebuild the public URL from
// our own known S3_ENDPOINT/S3_BUCKET -> S3_PUBLIC_URL mapping instead of
// trusting `location` directly.
function toPublicUrl(location: string): string {
  const publicUrl = process.env.S3_PUBLIC_URL!
  const privatePrefix = `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}`
  return location.replace(privatePrefix, publicUrl)
}

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

      // WebhookEvent.fromJson (the real decode path used by
      // WebhookReceiver.receive, verified against the installed
      // livekit-server-sdk@2.9.0 / @livekit/protocol) decodes proto enum
      // JSON names into their numeric TS enum values, so event.track.type
      // really is the numeric TrackType and this direct comparison against
      // TrackType.AUDIO (0) is correct as-is. Same applies to
      // event.egressInfo.status vs EgressStatus below.
      if (event.event === 'track_published') {
        if (event.track?.type === TrackType.AUDIO) {
          const roomName = event.room!.name
          const participantId = event.participant!.identity
          await egressClient.startTrackEgress(
            roomName,
            s3Output(`${roomName}/${participantId}.ogg`),
            event.track.sid
          )
        }
        return reply.code(200).send({ received: true })
      }

      if (event.event !== 'egress_ended' || event.egressInfo?.status !== EgressStatus.EGRESS_COMPLETE) {
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
          trackUrl: toPublicUrl(file.location),
          callbackBaseUrl
        })
      }

      return reply.code(200).send({ received: true })
    })
  })
}

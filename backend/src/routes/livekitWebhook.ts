import type { FastifyInstance } from 'fastify'
import {
  DirectFileOutput,
  EgressClient,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  S3Upload,
  TrackType,
  WebhookReceiver
} from 'livekit-server-sdk'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { meetings } from '../db/schema.js'
import { dispatchTrackForTranscription } from '../services/deepgramDispatch.js'

function s3Upload(): S3Upload {
  return new S3Upload({
    accessKey: process.env.S3_ACCESS_KEY!,
    secret: process.env.S3_SECRET_KEY!,
    bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT!,
    forcePathStyle: true
  })
}

function s3Output(filepath: string): DirectFileOutput {
  return new DirectFileOutput({
    filepath,
    output: {
      case: 's3',
      value: s3Upload()
    }
  })
}

function compositeOutput(filepath: string): EncodedFileOutput {
  return new EncodedFileOutput({
    filepath,
    fileType: EncodedFileType.MP4,
    output: {
      case: 's3',
      value: s3Upload()
    }
  })
}

// LiveKit can report path-style or virtual-hosted S3 locations. The filepath
// is controlled by us, so deriving the public URL from it is deterministic
// for R2 custom domains and avoids depending on the private endpoint shape.
function toPublicUrl(filename: string): string {
  const publicUrl = process.env.S3_PUBLIC_URL!.replace(/\/+$/, '')
  const objectKey = filename.replace(/^\/+/, '')
  return `${publicUrl}/${objectKey}`
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

function resolveParticipantId(trackFilename: string): string {
  const basename = trackFilename.split('/').pop() ?? trackFilename
  return basename.replace(/\.[^.]+$/, '')
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
      if (event.event === 'room_started') {
        const roomName = event.room?.name
        if (roomName) {
          await egressClient.startRoomCompositeEgress(
            roomName,
            compositeOutput(`${roomName}/recording.mp4`),
            {
              layout: 'grid',
              audioOnly: false,
              videoOnly: false,
              encodingOptions: EncodingOptionsPreset.H264_1080P_30
            }
          )
        }
        return reply.code(200).send({ received: true })
      }

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
      const requestCase = egressInfo.request?.case

      for (const file of egressInfo.fileResults ?? []) {
        const isRoomComposite = requestCase === 'roomComposite'
          || (requestCase === undefined && file.filename.toLowerCase().endsWith('/recording.mp4'))

        if (isRoomComposite) {
          await db
            .update(meetings)
            .set({ recordingUrl: toPublicUrl(file.filename) })
            .where(eq(meetings.id, meetingId))
          continue
        }

        // Only per-track egress feeds Deepgram. Unknown egress types are
        // acknowledged but deliberately ignored.
        if (requestCase !== undefined && requestCase !== 'track') continue

        await dispatchTrackForTranscription({
          meetingId,
          trackId: file.filename,
          participantId: resolveParticipantId(file.filename),
          trackUrl: toPublicUrl(file.filename),
          callbackBaseUrl
        })
      }

      return reply.code(200).send({ received: true })
    })
  })
}

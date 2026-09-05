// backend/src/services/livekitRoom.ts
import { RoomServiceClient, AccessToken } from 'livekit-server-sdk'
import { db } from '../db/client.js'
import { meetings, participants } from '../db/schema.js'

function roomServiceClient(): RoomServiceClient {
  return new RoomServiceClient(
    process.env.LIVEKIT_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!
  )
}

export async function createMeetingRoom(title: string): Promise<{ meetingId: string; roomName: string }> {
  const [meeting] = await db.insert(meetings).values({
    title,
    startedAt: new Date()
  }).returning()

  await roomServiceClient().createRoom({ name: meeting.id, emptyTimeout: 30 })

  return { meetingId: meeting.id, roomName: meeting.id }
}

export async function issueParticipantToken(
  meetingId: string,
  participantName: string
): Promise<{ participantId: string; token: string }> {
  const [participant] = await db.insert(participants).values({
    meetingId,
    name: participantName
  }).returning()

  const accessToken = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    { identity: participant.id }
  )
  accessToken.addGrant({ room: meetingId, roomJoin: true, canPublish: true, canSubscribe: true })

  const token = await accessToken.toJwt()

  return { participantId: participant.id, token }
}

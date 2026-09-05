import type { FastifyInstance } from 'fastify'
import { createMeetingRoom, issueParticipantToken } from '../services/livekitRoom.js'

interface CreateRoomBody { title: string }
interface TokenBody { participantName: string }
interface TokenParams { meetingId: string }

export function registerRoomsRoute(app: FastifyInstance): void {
  app.post<{ Body: CreateRoomBody }>('/rooms', async (request, reply) => {
    const result = await createMeetingRoom(request.body.title)
    return reply.code(200).send(result)
  })

  app.post<{ Body: TokenBody; Params: TokenParams }>('/rooms/:meetingId/token', async (request, reply) => {
    const result = await issueParticipantToken(request.params.meetingId, request.body.participantName)
    return reply.code(200).send(result)
  })
}

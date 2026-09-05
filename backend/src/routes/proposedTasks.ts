// backend/src/routes/proposedTasks.ts
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { proposedTasks, tasks } from '../db/schema.js'

interface ApproveBody { assignee?: string }
interface ProposedTaskParams { id: string }

export function registerProposedTasksRoute(app: FastifyInstance): void {
  app.post<{ Body: ApproveBody; Params: ProposedTaskParams }>('/proposed-tasks/:id/approve', async (request, reply) => {
    const proposedTask = await db.query.proposedTasks.findFirst({
      where: (pt, { eq: eqFn }) => eqFn(pt.id, request.params.id)
    })

    if (!proposedTask) {
      return reply.code(404).send({ error: 'not_found' })
    }

    await db.insert(tasks).values({
      proposedTaskId: proposedTask.id,
      description: proposedTask.description,
      assignee: request.body.assignee ?? null
    })

    await db.update(proposedTasks).set({ status: 'aprobada' }).where(eq(proposedTasks.id, proposedTask.id))

    return reply.code(200).send({ approved: true })
  })

  app.post<{ Params: ProposedTaskParams }>('/proposed-tasks/:id/reject', async (request, reply) => {
    const proposedTask = await db.query.proposedTasks.findFirst({
      where: (pt, { eq: eqFn }) => eqFn(pt.id, request.params.id)
    })

    if (!proposedTask) {
      return reply.code(404).send({ error: 'not_found' })
    }

    await db.update(proposedTasks).set({ status: 'rechazada' }).where(eq(proposedTasks.id, proposedTask.id))

    return reply.code(200).send({ rejected: true })
  })
}

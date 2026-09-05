// backend/src/services/timeoutSweeper.ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { transcriptionJobs } from '../db/schema.js'
import { checkMeetingCompletion } from './meetingCompletion.js'

const TIMEOUT_MS = 15 * 60 * 1000

export async function sweepTimedOutJobs(now: Date = new Date()): Promise<void> {
  const pendingJobs = await db.query.transcriptionJobs.findMany({
    where: (t, { eq: eqFn }) => eqFn(t.status, 'pending')
  })

  const timedOutMeetingIds = new Set<string>()

  for (const job of pendingJobs) {
    const ageMs = now.getTime() - new Date(job.createdAt).getTime()
    if (ageMs > TIMEOUT_MS) {
      await db.update(transcriptionJobs).set({ status: 'timeout' }).where(eq(transcriptionJobs.id, job.id))
      timedOutMeetingIds.add(job.meetingId)
    }
  }

  for (const meetingId of timedOutMeetingIds) {
    await checkMeetingCompletion(meetingId)
  }
}

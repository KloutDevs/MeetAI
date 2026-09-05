// backend/src/db/schema.ts
import { pgTable, uuid, varchar, timestamp, doublePrecision, text, unique } from 'drizzle-orm/pg-core'

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  recordingUrl: text('recording_url')
})

export const participants = pgTable('participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').references(() => meetings.id).notNull(),
  name: varchar('name', { length: 255 }).notNull()
})

export const transcriptionJobs = pgTable('transcription_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').references(() => meetings.id).notNull(),
  trackId: varchar('track_id', { length: 255 }).notNull(),
  participantId: uuid('participant_id').references(() => participants.id).notNull(),
  deepgramRequestId: varchar('deepgram_request_id', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, (table) => ({
  uniqueTrackPerMeeting: unique().on(table.meetingId, table.trackId)
}))

export const transcriptSegments = pgTable('transcript_segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').references(() => meetings.id).notNull(),
  speakerId: uuid('speaker_id').references(() => participants.id).notNull(),
  start: doublePrecision('start').notNull(),
  end: doublePrecision('end').notNull(),
  text: text('text').notNull()
})

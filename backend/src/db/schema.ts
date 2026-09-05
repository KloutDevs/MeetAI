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
  words: text('words'), // JSON-stringified DeepgramWord[]
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

export const summaries = pgTable('summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').references(() => meetings.id).notNull(),
  context: text('context'),
  keyPoints: text('key_points'),
  status: varchar('status', { length: 20 }).notNull().default('pending')
})

export const chapters = pgTable('chapters', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').references(() => meetings.id).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  start: doublePrecision('start').notNull(),
  end: doublePrecision('end').notNull()
})

export const highlights = pgTable('highlights', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').references(() => meetings.id).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  timestamp: doublePrecision('timestamp').notNull(),
  quote: text('quote').notNull()
})

export const proposedTasks = pgTable('proposed_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').references(() => meetings.id).notNull(),
  description: text('description').notNull(),
  sourceSpeakerId: uuid('source_speaker_id').references(() => participants.id),
  sourceTimestamp: doublePrecision('source_timestamp'),
  sourceQuote: text('source_quote'),
  status: varchar('status', { length: 20 }).notNull().default('pendiente'),
  assignee: varchar('assignee', { length: 255 })
})

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  proposedTaskId: uuid('proposed_task_id').references(() => proposedTasks.id).notNull(),
  description: text('description').notNull(),
  assignee: varchar('assignee', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

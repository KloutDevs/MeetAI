# Critical Bugfix: Audio track URL never persisted

## Root cause

`transcriptionJobs` (backend/src/db/schema.ts) only stored `trackId`, a bare
filename (e.g. `p1.ogg`) set from `file.filename` in `livekitWebhook.ts`. The
real playable location — S3 `file.location`, passed into
`dispatchTrackForTranscription` as `trackUrl` (backend/src/services/deepgramDispatch.ts)
— was used only to call the Deepgram API and was never written to the
database. `backend/src/routes/meetingData.ts` then built the `tracks` response
using `j.trackId` for the `url` field, so the frontend's
`<audio src={firstTrack.url}>` in `MeetingReview.tsx` received a bare filename
that can never resolve against the frontend's own origin. This broke the
audio player and every timestamp-seek button across Speakers/Chapters/
Highlights/Transcript tabs.

## Fix

1. `backend/src/db/schema.ts`: added nullable `trackUrl: text('track_url')`
   column to `transcriptionJobs`.
2. Generated migration `backend/drizzle/0003_broad_proemial_gods.sql`
   (`ALTER TABLE "transcription_jobs" ADD COLUMN "track_url" text;`) and
   applied it against `postgres://nahuelschmidt@localhost:5432/meetai_test`.
3. `backend/src/services/deepgramDispatch.ts`: `db.insert(transcriptionJobs).values({...})`
   now also persists `trackUrl` (already available as a function parameter,
   previously dropped on the floor).
4. `backend/src/routes/meetingData.ts`: `tracks` mapping now uses
   `j.trackUrl` for `url` instead of `j.trackId`. `trackId` remains on the
   row/query for other uses (e.g. webhook correlation).

## Tests updated

- `backend/test/deepgramDispatch.test.ts`: asserts the insert call includes
  `trackUrl: 'https://bucket.s3.amazonaws.com/track-1.ogg'`.
- `backend/test/meetingData.test.ts`: mock `transcriptionJobs.findMany`
  fixture now includes `trackUrl`, and the response assertion checks
  `body.tracks` returns that S3 URL, not the filename.

## Verification

- `DATABASE_URL=postgres://nahuelschmidt@localhost:5432/meetai_test LIVEKIT_URL=wss://test.livekit.cloud LIVEKIT_API_KEY=test LIVEKIT_API_SECRET=test DEEPSEEK_API_KEY=test npx vitest run`
  → 14 test files, 50 tests, all passing.
- `npx tsc --noEmit` → no errors.

## Result

`GET /meetings/:id/full` now returns `tracks[].url` pointing at the real S3
object location instead of a bare filename, so `<audio src={firstTrack.url}>`
and timestamp-seek in the frontend will resolve to real, playable audio.

## Files changed

- backend/src/db/schema.ts
- backend/drizzle/0003_broad_proemial_gods.sql (generated)
- backend/src/services/deepgramDispatch.ts
- backend/src/routes/meetingData.ts
- backend/test/deepgramDispatch.test.ts
- backend/test/meetingData.test.ts

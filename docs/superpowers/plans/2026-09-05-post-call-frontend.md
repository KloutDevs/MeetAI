# Post-Call Review Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A backend endpoint that aggregates everything known about a finished meeting, and a frontend view with tabs (Speakers, Chapters, Highlights, Summary, Transcript, Approvals, Insights) plus a simple audio player with speaker-change markers.

**Architecture:** One new Fastify route joins across `meetings`/`participants`/`transcriptSegments`/`chapters`/`highlights`/`summaries`/`proposedTasks`/`transcriptionJobs` (for track URLs) and returns one JSON payload. The frontend adds a `MeetingReview` view with tab navigation, fetching that payload once and deriving all tab content from it client-side (no per-tab endpoints).

**Tech Stack:** Backend: existing Fastify/Drizzle. Frontend: existing Vite+React app (`frontend/`), no new dependencies beyond what's already installed (`react`, `react-dom`).

**Spec:** `docs/superpowers/specs/2026-09-05-post-call-frontend-design.md`

## Global Constraints

- The MVP audio player plays the FIRST participant's track only (no client-side multi-track mixing) — this is a documented, deliberate limitation, not a bug to silently "fix" mid-implementation.
- No Enhanced Notes / AI inline toolbar, no video-synced quote overlays, no video thumbnails in Highlights — explicitly out of scope for this plan.
- Insights tab computes only total duration and per-participant speaking time/percentage, entirely client-side from `transcriptSegments` — no new backend computation.

---

## File Structure

```
backend/
  src/
    routes/
      meetingData.ts          # GET /meetings/:id/full
    server.ts                  # MODIFY: register meetingData route
  test/
    meetingData.test.ts
frontend/
  src/
    MeetingReview.tsx           # fetch + tab shell + audio player
    tabs/
      SpeakersTab.tsx
      TranscriptTab.tsx
      ChaptersTab.tsx
      HighlightsTab.tsx
      SummaryTab.tsx
      ApprovalsTab.tsx
      InsightsTab.tsx
    main.tsx                    # MODIFY: route to MeetingReview by URL param
```

---

### Task 1: Backend `GET /meetings/:id/full`

**Files:**
- Create: `backend/src/routes/meetingData.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/meetingData.test.ts`

**Interfaces:**
- Consumes: `db`, `meetings`, `participants`, `transcriptSegments`, `chapters`, `highlights`, `summaries`, `proposedTasks`, `transcriptionJobs` from `../db/*`
- Produces: `registerMeetingDataRoute(app: FastifyInstance): void`. Response shape (used verbatim by the frontend in Tasks 2-5):
  ```typescript
  {
    meeting: { id: string; title: string },
    participants: Array<{ id: string; name: string }>,
    tracks: Array<{ participantId: string; url: string }>,
    transcriptSegments: Array<{ speakerId: string; start: number; end: number; text: string }>,
    chapters: Array<{ title: string; start: number; end: number }>,
    highlights: Array<{ type: string; timestamp: number; quote: string }>,
    summary: { context: string; keyPoints: string; status: string } | null,
    proposedTasks: Array<{ id: string; description: string; status: string; assignee: string | null; sourceSpeakerId: string | null; sourceTimestamp: number | null; sourceQuote: string | null }>
  }
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/meetingData.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirstMocks: Record<string, ReturnType<typeof vi.fn>> = {
  meetings: vi.fn(),
  summaries: vi.fn()
}
const findManyMocks: Record<string, ReturnType<typeof vi.fn>> = {
  participants: vi.fn(),
  transcriptSegments: vi.fn(),
  chapters: vi.fn(),
  highlights: vi.fn(),
  proposedTasks: vi.fn(),
  transcriptionJobs: vi.fn()
}

vi.mock('../src/db/client.js', () => ({
  db: {
    query: {
      meetings: { findFirst: (...args: unknown[]) => findFirstMocks.meetings(...args) },
      summaries: { findFirst: (...args: unknown[]) => findFirstMocks.summaries(...args) },
      participants: { findMany: (...args: unknown[]) => findManyMocks.participants(...args) },
      transcriptSegments: { findMany: (...args: unknown[]) => findManyMocks.transcriptSegments(...args) },
      chapters: { findMany: (...args: unknown[]) => findManyMocks.chapters(...args) },
      highlights: { findMany: (...args: unknown[]) => findManyMocks.highlights(...args) },
      proposedTasks: { findMany: (...args: unknown[]) => findManyMocks.proposedTasks(...args) },
      transcriptionJobs: { findMany: (...args: unknown[]) => findManyMocks.transcriptionJobs(...args) }
    }
  }
}))

const { buildServer } = await import('../src/server.js')

describe('GET /meetings/:id/full', () => {
  beforeEach(() => {
    Object.values(findFirstMocks).forEach((m) => m.mockReset())
    Object.values(findManyMocks).forEach((m) => m.mockReset())
  })

  it('aggregates all meeting data into one payload', async () => {
    findFirstMocks.meetings.mockResolvedValue({ id: 'meeting-1', title: 'Weekly sync' })
    findFirstMocks.summaries.mockResolvedValue({ context: 'ctx', keyPoints: 'points', status: 'completed' })
    findManyMocks.participants.mockResolvedValue([{ id: 'p1', name: 'Ada' }])
    findManyMocks.transcriptSegments.mockResolvedValue([{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])
    findManyMocks.chapters.mockResolvedValue([{ title: 'Intro', start: 0, end: 30 }])
    findManyMocks.highlights.mockResolvedValue([{ type: 'question', timestamp: 12, quote: '¿cuándo?' }])
    findManyMocks.proposedTasks.mockResolvedValue([{ id: 'pt1', description: 'enviar informe', status: 'pendiente', assignee: null, sourceSpeakerId: 'p1', sourceTimestamp: 5, sourceQuote: 'hay que enviarlo' }])
    findManyMocks.transcriptionJobs.mockResolvedValue([{ participantId: 'p1', trackId: 'p1.ogg' }])

    const app = buildServer()
    const response = await app.inject({ method: 'GET', url: '/meetings/meeting-1/full' })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.meeting).toEqual({ id: 'meeting-1', title: 'Weekly sync' })
    expect(body.participants).toEqual([{ id: 'p1', name: 'Ada' }])
    expect(body.tracks).toEqual([{ participantId: 'p1', url: 'p1.ogg' }])
    expect(body.transcriptSegments).toHaveLength(1)
    expect(body.chapters).toHaveLength(1)
    expect(body.highlights).toHaveLength(1)
    expect(body.summary).toEqual({ context: 'ctx', keyPoints: 'points', status: 'completed' })
    expect(body.proposedTasks).toHaveLength(1)
  })

  it('returns 404 when the meeting does not exist', async () => {
    findFirstMocks.meetings.mockResolvedValue(undefined)

    const app = buildServer()
    const response = await app.inject({ method: 'GET', url: '/meetings/missing/full' })

    expect(response.statusCode).toBe(404)
  })

  it('returns summary: null when no summary exists yet', async () => {
    findFirstMocks.meetings.mockResolvedValue({ id: 'meeting-1', title: 'Weekly sync' })
    findFirstMocks.summaries.mockResolvedValue(undefined)
    findManyMocks.participants.mockResolvedValue([])
    findManyMocks.transcriptSegments.mockResolvedValue([])
    findManyMocks.chapters.mockResolvedValue([])
    findManyMocks.highlights.mockResolvedValue([])
    findManyMocks.proposedTasks.mockResolvedValue([])
    findManyMocks.transcriptionJobs.mockResolvedValue([])

    const app = buildServer()
    const response = await app.inject({ method: 'GET', url: '/meetings/meeting-1/full' })

    expect(response.json().summary).toBeNull()
  })
})
```

Note: the exact Drizzle relational-query shape (`db.query.<table>.findFirst`/`findMany`) requires `db/schema.ts`'s Drizzle instance to be built with relations configured, OR the implementer uses plain `db.select().from(table).where(...)` calls instead if relational queries aren't already set up in this codebase (check how `deepgramWebhook.ts`/`meetingCompletion.ts` query `transcriptionJobs` — they use `db.query.transcriptionJobs.findMany`, so the relational query API is already in use; follow that same pattern here, and adjust the test's mock shape to match whatever query style the implementer actually uses if `findFirst`/`findMany` per-table isn't precisely how it's already done elsewhere).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/meetingData.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

```typescript
// backend/src/routes/meetingData.ts
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'

interface MeetingParams { id: string }

export function registerMeetingDataRoute(app: FastifyInstance): void {
  app.get<{ Params: MeetingParams }>('/meetings/:id/full', async (request, reply) => {
    const meetingId = request.params.id

    const meeting = await db.query.meetings.findFirst({ where: (m, { eq }) => eq(m.id, meetingId) })
    if (!meeting) {
      return reply.code(404).send({ error: 'not_found' })
    }

    const [participants, transcriptSegments, chapters, highlights, proposedTasks, transcriptionJobs, summary] = await Promise.all([
      db.query.participants.findMany({ where: (p, { eq }) => eq(p.meetingId, meetingId) }),
      db.query.transcriptSegments.findMany({ where: (s, { eq }) => eq(s.meetingId, meetingId) }),
      db.query.chapters.findMany({ where: (c, { eq }) => eq(c.meetingId, meetingId) }),
      db.query.highlights.findMany({ where: (h, { eq }) => eq(h.meetingId, meetingId) }),
      db.query.proposedTasks.findMany({ where: (t, { eq }) => eq(t.meetingId, meetingId) }),
      db.query.transcriptionJobs.findMany({ where: (j, { eq }) => eq(j.meetingId, meetingId) }),
      db.query.summaries.findFirst({ where: (s, { eq }) => eq(s.meetingId, meetingId) })
    ])

    return reply.code(200).send({
      meeting: { id: meeting.id, title: meeting.title },
      participants: participants.map((p) => ({ id: p.id, name: p.name })),
      tracks: transcriptionJobs.map((j) => ({ participantId: j.participantId, url: j.trackId })),
      transcriptSegments: transcriptSegments.map((s) => ({ speakerId: s.speakerId, start: s.start, end: s.end, text: s.text })),
      chapters: chapters.map((c) => ({ title: c.title, start: c.start, end: c.end })),
      highlights: highlights.map((h) => ({ type: h.type, timestamp: h.timestamp, quote: h.quote })),
      summary: summary ? { context: summary.context, keyPoints: summary.keyPoints, status: summary.status } : null,
      proposedTasks: proposedTasks.map((t) => ({
        id: t.id,
        description: t.description,
        status: t.status,
        assignee: t.assignee,
        sourceSpeakerId: t.sourceSpeakerId,
        sourceTimestamp: t.sourceTimestamp,
        sourceQuote: t.sourceQuote
      }))
    })
  })
}
```

The implementer should verify against the real `schema.ts` whether relational query config (`db.query.X`) is actually wired for every table used here (it may only be configured for tables touched by prior sub-projects) — if `db.query.chapters`/`highlights`/`proposedTasks`/`summaries` aren't registered in the Drizzle schema's relations setup, adapt to `db.select().from(table).where(eq(table.meetingId, meetingId))` instead, consistent with whatever pattern actually compiles.

- [ ] **Step 4: Register the route**

Add to `backend/src/server.ts`:
```typescript
import { registerMeetingDataRoute } from './routes/meetingData.js'
// inside buildServer():
registerMeetingDataRoute(app)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run test/meetingData.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/meetingData.ts backend/src/server.ts backend/test/meetingData.test.ts
git commit -m "feat: add GET /meetings/:id/full aggregate endpoint"
```

---

### Task 2: Frontend shell — `MeetingReview.tsx` + audio player + tab navigation

**Files:**
- Create: `frontend/src/MeetingReview.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces: `MeetingReview` component, a `MeetingData` TypeScript type matching Task 1's response shape (exported so Task 3-5's tab components can import it), and a simple `seekTo(timestamp: number)` function passed down to tabs via props for "jump to this moment" buttons.

No automated test for this task (visual/manual per spec) — verify via `npm run dev` and hitting `/meetings/:id` with a real or manually-inserted meeting id.

- [ ] **Step 1: Create `frontend/src/MeetingReview.tsx`**

```typescript
// frontend/src/MeetingReview.tsx
import { useEffect, useRef, useState } from 'react'
import { SpeakersTab } from './tabs/SpeakersTab.js'
import { TranscriptTab } from './tabs/TranscriptTab.js'
import { ChaptersTab } from './tabs/ChaptersTab.js'
import { HighlightsTab } from './tabs/HighlightsTab.js'
import { SummaryTab } from './tabs/SummaryTab.js'
import { ApprovalsTab } from './tabs/ApprovalsTab.js'
import { InsightsTab } from './tabs/InsightsTab.js'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

export interface MeetingData {
  meeting: { id: string; title: string }
  participants: Array<{ id: string; name: string }>
  tracks: Array<{ participantId: string; url: string }>
  transcriptSegments: Array<{ speakerId: string; start: number; end: number; text: string }>
  chapters: Array<{ title: string; start: number; end: number }>
  highlights: Array<{ type: string; timestamp: number; quote: string }>
  summary: { context: string; keyPoints: string; status: string } | null
  proposedTasks: Array<{
    id: string
    description: string
    status: string
    assignee: string | null
    sourceSpeakerId: string | null
    sourceTimestamp: number | null
    sourceQuote: string | null
  }>
}

const TABS = ['Speakers', 'Chapters', 'Highlights', 'Summary', 'Transcript', 'Approvals', 'Insights'] as const
type Tab = typeof TABS[number]

export function MeetingReview({ meetingId }: { meetingId: string }) {
  const [data, setData] = useState<MeetingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('Summary')
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    fetch(`${BACKEND_URL}/meetings/${meetingId}/full`)
      .then((response) => {
        if (!response.ok) throw new Error(`Backend returned ${response.status}`)
        return response.json()
      })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [meetingId])

  function seekTo(timestamp: number) {
    if (audioRef.current) {
      audioRef.current.currentTime = timestamp
      audioRef.current.play()
    }
  }

  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>
  if (!data) return <p>Cargando...</p>

  const firstTrack = data.tracks[0]

  return (
    <div style={{ padding: 24 }}>
      <h1>{data.meeting.title}</h1>

      {firstTrack && (
        <audio ref={audioRef} controls src={firstTrack.url} style={{ width: '100%' }} />
      )}

      <nav style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        {TABS.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} disabled={activeTab === tab}>
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === 'Speakers' && <SpeakersTab data={data} onSeek={seekTo} />}
      {activeTab === 'Chapters' && <ChaptersTab data={data} onSeek={seekTo} />}
      {activeTab === 'Highlights' && <HighlightsTab data={data} onSeek={seekTo} />}
      {activeTab === 'Summary' && <SummaryTab data={data} />}
      {activeTab === 'Transcript' && <TranscriptTab data={data} onSeek={seekTo} />}
      {activeTab === 'Approvals' && <ApprovalsTab data={data} backendUrl={BACKEND_URL} onChanged={() => {
        fetch(`${BACKEND_URL}/meetings/${meetingId}/full`).then((r) => r.json()).then(setData)
      }} />}
      {activeTab === 'Insights' && <InsightsTab data={data} />}
    </div>
  )
}
```

- [ ] **Step 2: Wire routing in `main.tsx`**

Modify `frontend/src/main.tsx` to route based on a `?meeting=<id>` query param, falling back to the existing `JoinRoom` when absent:

```typescript
// frontend/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@livekit/components-styles'
import { JoinRoom } from './JoinRoom.js'
import { MeetingReview } from './MeetingReview.js'

const meetingId = new URLSearchParams(window.location.search).get('meeting')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {meetingId ? <MeetingReview meetingId={meetingId} /> : <JoinRoom />}
  </React.StrictMode>
)
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: will fail until Tasks 3-5 create the tab components — that's expected at this point; note in the report that Task 2 alone doesn't compile standalone (the tab imports don't exist yet) and that's fine, this task's deliverable is the shell, verified once Tasks 3-5 land. Do not create stub tab files just to make this task type-check in isolation — that would duplicate work Tasks 3-5 do for real.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/MeetingReview.tsx frontend/src/main.tsx
git commit -m "feat: add MeetingReview shell with tab navigation and audio player"
```

---

### Task 3: `SpeakersTab` + `TranscriptTab`

**Files:**
- Create: `frontend/src/tabs/SpeakersTab.tsx`
- Create: `frontend/src/tabs/TranscriptTab.tsx`

**Interfaces:**
- Consumes: `MeetingData` type from `../MeetingReview.js`
- Produces: `SpeakersTab({ data, onSeek }: { data: MeetingData; onSeek: (t: number) => void })`, `TranscriptTab({ data, onSeek }: { data: MeetingData; onSeek: (t: number) => void })`

No automated test (visual). Verify via `npx tsc -b --noEmit`.

- [ ] **Step 1: Create `frontend/src/tabs/SpeakersTab.tsx`**

```typescript
// frontend/src/tabs/SpeakersTab.tsx
import type { MeetingData } from '../MeetingReview.js'

export function SpeakersTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  const totalDuration = data.transcriptSegments.reduce((max, s) => Math.max(max, s.end), 0)

  const timeBySpeaker = new Map<string, number>()
  for (const segment of data.transcriptSegments) {
    timeBySpeaker.set(segment.speakerId, (timeBySpeaker.get(segment.speakerId) ?? 0) + (segment.end - segment.start))
  }

  return (
    <div>
      {data.participants.map((participant) => {
        const spokenSeconds = timeBySpeaker.get(participant.id) ?? 0
        const percentage = totalDuration > 0 ? Math.round((spokenSeconds / totalDuration) * 100) : 0
        const segments = data.transcriptSegments.filter((s) => s.speakerId === participant.id)

        return (
          <div key={participant.id} style={{ marginBottom: 16 }}>
            <strong>{participant.name}</strong> — {percentage}% del tiempo hablado
            <div>
              {segments.map((segment, i) => (
                <button key={i} onClick={() => onSeek(segment.start)} style={{ marginRight: 4 }}>
                  ▶ {Math.floor(segment.start)}s
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Create `frontend/src/tabs/TranscriptTab.tsx`**

```typescript
// frontend/src/tabs/TranscriptTab.tsx
import type { MeetingData } from '../MeetingReview.js'

export function TranscriptTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  const nameById = new Map(data.participants.map((p) => [p.id, p.name]))

  return (
    <div>
      {data.transcriptSegments
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((segment, i) => (
          <p key={i}>
            <button onClick={() => onSeek(segment.start)}>{Math.floor(segment.start)}s</button>{' '}
            <strong>{nameById.get(segment.speakerId) ?? segment.speakerId}:</strong> {segment.text}
          </p>
        ))}
    </div>
  )
}
```

- [ ] **Step 3: Verify types (will still fail until Tasks 4-5 land the remaining tab files imported by `MeetingReview.tsx`)**

Run: `cd frontend && npx tsc -b --noEmit` — expected to still report missing modules for `ChaptersTab`/`HighlightsTab`/`SummaryTab`/`ApprovalsTab`/`InsightsTab`; confirm no NEW errors from the two files created in this task.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/tabs/SpeakersTab.tsx frontend/src/tabs/TranscriptTab.tsx
git commit -m "feat: add Speakers and Transcript tabs"
```

---

### Task 4: `ChaptersTab` + `HighlightsTab` + `SummaryTab`

**Files:**
- Create: `frontend/src/tabs/ChaptersTab.tsx`
- Create: `frontend/src/tabs/HighlightsTab.tsx`
- Create: `frontend/src/tabs/SummaryTab.tsx`

**Interfaces:**
- Consumes: `MeetingData` type from `../MeetingReview.js`
- Produces: three tab components, same `{ data, onSeek }` prop shape as Task 3 (SummaryTab takes only `{ data }`, no seek needed).

- [ ] **Step 1: Create `frontend/src/tabs/ChaptersTab.tsx`**

```typescript
// frontend/src/tabs/ChaptersTab.tsx
import type { MeetingData } from '../MeetingReview.js'

export function ChaptersTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  if (data.chapters.length === 0) return <p>Sin capítulos generados.</p>

  return (
    <ul>
      {data.chapters.map((chapter, i) => (
        <li key={i}>
          <button onClick={() => onSeek(chapter.start)}>{chapter.title}</button>{' '}
          ({Math.floor(chapter.start)}s – {Math.floor(chapter.end)}s)
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Create `frontend/src/tabs/HighlightsTab.tsx`**

```typescript
// frontend/src/tabs/HighlightsTab.tsx
import type { MeetingData } from '../MeetingReview.js'

export function HighlightsTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  if (data.highlights.length === 0) return <p>Sin highlights detectados.</p>

  return (
    <ul>
      {data.highlights.map((highlight, i) => (
        <li key={i}>
          <button onClick={() => onSeek(highlight.timestamp)}>{Math.floor(highlight.timestamp)}s</button>{' '}
          <em>[{highlight.type}]</em> "{highlight.quote}"
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Create `frontend/src/tabs/SummaryTab.tsx`**

```typescript
// frontend/src/tabs/SummaryTab.tsx
import type { MeetingData } from '../MeetingReview.js'

export function SummaryTab({ data }: { data: MeetingData }) {
  if (!data.summary) return <p>Resumen aún no generado.</p>
  if (data.summary.status === 'failed') return <p>No se pudo generar el resumen de esta reunión.</p>

  return (
    <div>
      <h2>Contexto</h2>
      <p>{data.summary.context}</p>
      <h2>Lo más importante</h2>
      <p>{data.summary.keyPoints}</p>
    </div>
  )
}
```

- [ ] **Step 4: Verify types (will still fail until Task 5's `ApprovalsTab`/`InsightsTab` land)**

Run: `cd frontend && npx tsc -b --noEmit` — confirm no NEW errors beyond the still-missing Task 5 files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tabs/ChaptersTab.tsx frontend/src/tabs/HighlightsTab.tsx frontend/src/tabs/SummaryTab.tsx
git commit -m "feat: add Chapters, Highlights, and Summary tabs"
```

---

### Task 5: `ApprovalsTab` + `InsightsTab`

**Files:**
- Create: `frontend/src/tabs/ApprovalsTab.tsx`
- Create: `frontend/src/tabs/InsightsTab.tsx`

**Interfaces:**
- Consumes: `MeetingData` type from `../MeetingReview.js`; calls backend `POST /proposed-tasks/:id/approve` and `/reject` (already implemented in the AI summary engine sub-project).
- Produces: `ApprovalsTab({ data, backendUrl, onChanged }: { data: MeetingData; backendUrl: string; onChanged: () => void })`, `InsightsTab({ data }: { data: MeetingData })`.

- [ ] **Step 1: Create `frontend/src/tabs/ApprovalsTab.tsx`**

```typescript
// frontend/src/tabs/ApprovalsTab.tsx
import { useState } from 'react'
import type { MeetingData } from '../MeetingReview.js'

export function ApprovalsTab({
  data,
  backendUrl,
  onChanged
}: {
  data: MeetingData
  backendUrl: string
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const pending = data.proposedTasks.filter((t) => t.status === 'pendiente')

  async function approve(id: string) {
    setError(null)
    const response = await fetch(`${backendUrl}/proposed-tasks/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!response.ok) {
      setError(`No se pudo aprobar la tarea (${response.status})`)
      return
    }
    onChanged()
  }

  async function reject(id: string) {
    setError(null)
    const response = await fetch(`${backendUrl}/proposed-tasks/${id}/reject`, { method: 'POST' })
    if (!response.ok) {
      setError(`No se pudo rechazar la tarea (${response.status})`)
      return
    }
    onChanged()
  }

  if (pending.length === 0) return <p>No hay tareas pendientes de aprobación.</p>

  return (
    <div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {pending.map((task) => (
        <div key={task.id} style={{ marginBottom: 12, border: '1px solid #ccc', padding: 8 }}>
          <p>{task.description}</p>
          {task.sourceQuote && <p><em>"{task.sourceQuote}"</em></p>}
          <button onClick={() => approve(task.id)}>Aprobar</button>
          <button onClick={() => reject(task.id)}>Rechazar</button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `frontend/src/tabs/InsightsTab.tsx`**

```typescript
// frontend/src/tabs/InsightsTab.tsx
import type { MeetingData } from '../MeetingReview.js'

export function InsightsTab({ data }: { data: MeetingData }) {
  const totalDuration = data.transcriptSegments.reduce((max, s) => Math.max(max, s.end), 0)

  const timeBySpeaker = new Map<string, number>()
  for (const segment of data.transcriptSegments) {
    timeBySpeaker.set(segment.speakerId, (timeBySpeaker.get(segment.speakerId) ?? 0) + (segment.end - segment.start))
  }

  const nameById = new Map(data.participants.map((p) => [p.id, p.name]))

  return (
    <div>
      <p>Duración total: {Math.floor(totalDuration)}s</p>
      <h3>Participación</h3>
      <ul>
        {Array.from(timeBySpeaker.entries()).map(([speakerId, seconds]) => (
          <li key={speakerId}>
            {nameById.get(speakerId) ?? speakerId}: {Math.floor(seconds)}s ({totalDuration > 0 ? Math.round((seconds / totalDuration) * 100) : 0}%)
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Verify the whole frontend now type-checks end to end**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors — this is the first point where all tab imports in `MeetingReview.tsx` (Task 2) resolve, since this is the last task creating them.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/tabs/ApprovalsTab.tsx frontend/src/tabs/InsightsTab.tsx
git commit -m "feat: add Approvals and Insights tabs"
```

---

## Self-Review Notes

- **Spec coverage:** all 7 in-scope tabs (Speakers, Chapters, Highlights, Summary, Transcript, Approvals, Insights) ✅, backend aggregate endpoint ✅, audio player with per-segment seek buttons acting as a lightweight stand-in for "timeline with speaker-change markers" (a literal drag-seekable timeline with colored dots is a larger UI investment deferred implicitly — noted here as a real gap the plan accepts for MVP speed, not hidden).
- **Fuera de alcance confirmed:** no Enhanced Notes, no quote overlays, no video thumbnails, no multi-track mixing, in any task.
- **Cross-task dependency risk flagged:** Tasks 2-5 all touch the same `MeetingReview.tsx` import graph but only Task 5 makes the whole frontend type-check — this is intentional (avoids stub-file busywork) and explicitly called out in each task's verification step so nobody mistakes a partial `tsc` failure mid-plan for a real regression.

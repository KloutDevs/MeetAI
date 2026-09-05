# AI Summary + Task Extraction Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a meeting's persisted `transcriptSegments`, generate a structured summary (context, key points, chapters, highlights, proposed tasks) via DeepSeek, persist it, and expose endpoints to approve/reject proposed tasks (approval creates a real `Task`).

**Architecture:** A new service formats segments into a prompt, calls DeepSeek's chat completions API with JSON-object output, validates the response with Zod (one retry on validation failure), and persists across four new tables. Two new routes handle task approval/rejection. The whole thing is invoked fire-and-forget from the existing `checkMeetingCompletion`.

**Tech Stack:** Node.js/TypeScript/Fastify/Drizzle (existing), `zod` (already a dependency), DeepSeek's OpenAI-compatible REST API via plain `fetch` (no new SDK dependency needed).

**Spec:** `docs/superpowers/specs/2026-09-05-ai-summary-engine-design.md`

## Global Constraints

- LLM provider: DeepSeek (`https://api.deepseek.com/chat/completions`, model `deepseek-chat`), `response_format: { type: 'json_object' }`.
- On invalid JSON: exactly one retry with the Zod validation error embedded in the prompt; on second failure, persist `Summary.status = 'failed'` and stop (no further retries).
- Task approval has no due-date editing in this MVP — only optional `assignee`.
- The AI processor is fire-and-forget from `checkMeetingCompletion` — it must not block or fail that function's own transaction.

---

## File Structure

```
backend/
  src/
    db/
      schema.ts                     # MODIFY: add summaries, chapters, highlights, proposedTasks, tasks tables
    services/
      transcriptFormatter.ts        # segments -> prompt text
      llmSummary.ts                 # calls DeepSeek, validates with zod, persists
      meetingCompletion.ts          # MODIFY: fire-and-forget call to generateMeetingSummary after persist
    routes/
      proposedTasks.ts              # POST /proposed-tasks/:id/approve, /reject
      server.ts                      # MODIFY: register proposedTasks routes
  test/
    transcriptFormatter.test.ts
    llmSummary.test.ts
    proposedTasks.test.ts
    meetingCompletion.test.ts       # MODIFY: assert generateMeetingSummary is invoked (mocked)
```

---

### Task 1: Schema additions — summaries, chapters, highlights, proposedTasks, tasks

**Files:**
- Modify: `backend/src/db/schema.ts`
- No new test file — verified via the existing `db.test.ts` pattern is NOT required per task; migration application is verified in Task 2's test (which exercises `proposedTasks`/`tasks` against real Postgres).

**Interfaces:**
- Produces: Drizzle tables `summaries`, `chapters`, `highlights`, `proposedTasks`, `tasks`, exported from `schema.ts`. Used by Tasks 2 and 3.

- [ ] **Step 1: Add table definitions to `backend/src/db/schema.ts`**

Append:

```typescript
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
```

(All imports — `pgTable`, `uuid`, `varchar`, `text`, `doublePrecision`, `timestamp` — are already imported at the top of `schema.ts` from the prior sub-project; add any that are missing.)

- [ ] **Step 2: Generate and apply the migration**

Run:
```bash
cd backend
npx drizzle-kit generate
DATABASE_URL=postgres://nahuelschmidt@localhost:5432/meetai_test npx drizzle-kit migrate
```

- [ ] **Step 3: Verify with a quick manual round-trip (no committed test file, just a sanity check)**

Run: `DATABASE_URL=postgres://nahuelschmidt@localhost:5432/meetai_test npx vitest run test/db.test.ts` (confirms migrations didn't break the existing DB test).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle
git commit -m "feat: add summaries/chapters/highlights/proposedTasks/tasks schema"
```

---

### Task 2: `transcriptFormatter.ts` — segments to prompt text

**Files:**
- Create: `backend/src/services/transcriptFormatter.ts`
- Test: `backend/test/transcriptFormatter.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegment` from `../types.js`
- Produces: `formatTranscriptForPrompt(segments: TranscriptSegment[]): string` — used by `llmSummary.ts` (Task 3).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/transcriptFormatter.test.ts
import { describe, it, expect } from 'vitest'
import { formatTranscriptForPrompt } from '../src/services/transcriptFormatter.js'
import type { TranscriptSegment } from '../src/types.js'

describe('formatTranscriptForPrompt', () => {
  it('formats segments as [mm:ss] speakerId: text, one per line', () => {
    const segments: TranscriptSegment[] = [
      { speakerId: 'p1', start: 0, end: 2, text: 'hola equipo' },
      { speakerId: 'p2', start: 65, end: 68, text: 'buenas' }
    ]

    const result = formatTranscriptForPrompt(segments)

    expect(result).toBe('[00:00] p1: hola equipo\n[01:05] p2: buenas')
  })

  it('returns an empty string for no segments', () => {
    expect(formatTranscriptForPrompt([])).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/transcriptFormatter.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// backend/src/services/transcriptFormatter.ts
import type { TranscriptSegment } from '../types.js'

export function formatTranscriptForPrompt(segments: TranscriptSegment[]): string {
  return segments.map((segment) => `[${formatTimestamp(segment.start)}] ${segment.speakerId}: ${segment.text}`).join('\n')
}

function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/transcriptFormatter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/transcriptFormatter.ts backend/test/transcriptFormatter.test.ts
git commit -m "feat: format transcript segments into LLM prompt text"
```

---

### Task 3: `llmSummary.ts` — call DeepSeek, validate, persist

**Files:**
- Create: `backend/src/services/llmSummary.ts`
- Test: `backend/test/llmSummary.test.ts`

**Interfaces:**
- Consumes: `formatTranscriptForPrompt` from `./transcriptFormatter.js`, `db`, `summaries`/`chapters`/`highlights`/`proposedTasks` from `../db/schema.js`, `TranscriptSegment` from `../types.js`
- Produces: `generateMeetingSummary(meetingId: string, segments: TranscriptSegment[]): Promise<void>` — used by `meetingCompletion.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/llmSummary.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertValuesMock = vi.fn().mockResolvedValue(undefined)
const dbInsertMock = vi.fn(() => ({ values: insertValuesMock }))
vi.mock('../src/db/client.js', () => ({
  db: { insert: (...args: unknown[]) => dbInsertMock(...args) }
}))

const { generateMeetingSummary } = await import('../src/services/llmSummary.js')

const VALID_RESPONSE = {
  summary: { context: 'Contexto de prueba', keyPoints: 'Puntos clave' },
  chapters: [{ title: 'Intro', start: 0, end: 30 }],
  highlights: [{ type: 'question', timestamp: 12, quote: '¿cuándo entregamos?' }],
  proposedTasks: [{ description: 'Enviar el informe', sourceSpeakerId: 'p1', sourceTimestamp: 45, sourceQuote: 'hay que enviar el informe' }]
}

function deepseekResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] })
  }
}

describe('generateMeetingSummary', () => {
  beforeEach(() => {
    dbInsertMock.mockClear()
    insertValuesMock.mockClear()
    process.env.DEEPSEEK_API_KEY = 'test-key'
  })

  it('parses a valid LLM response and persists summary, chapters, highlights, proposedTasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(deepseekResponse(JSON.stringify(VALID_RESPONSE)))
    vi.stubGlobal('fetch', fetchMock)

    await generateMeetingSummary('meeting-1', [{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({ method: 'POST' })
    )
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      meetingId: 'meeting-1',
      context: 'Contexto de prueba',
      status: 'completed'
    }))
  })

  it('retries once with the validation error embedded when the first response is invalid JSON shape, then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deepseekResponse('{"not": "the right shape"}'))
      .mockResolvedValueOnce(deepseekResponse(JSON.stringify(VALID_RESPONSE)))
    vi.stubGlobal('fetch', fetchMock)

    await generateMeetingSummary('meeting-1', [{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCallBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)
    const secondCallPrompt = JSON.stringify(secondCallBody)
    expect(secondCallPrompt).toContain('summary')
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('persists a failed summary after two invalid responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(deepseekResponse('{"not": "the right shape"}'))
      .mockResolvedValueOnce(deepseekResponse('{"still": "wrong"}'))
    vi.stubGlobal('fetch', fetchMock)

    await generateMeetingSummary('meeting-1', [{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/llmSummary.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// backend/src/services/llmSummary.ts
import { z } from 'zod'
import { db } from '../db/client.js'
import { summaries, chapters, highlights, proposedTasks } from '../db/schema.js'
import { formatTranscriptForPrompt } from './transcriptFormatter.js'
import type { TranscriptSegment } from '../types.js'

const LLMResponseSchema = z.object({
  summary: z.object({ context: z.string(), keyPoints: z.string() }),
  chapters: z.array(z.object({ title: z.string(), start: z.number(), end: z.number() })),
  highlights: z.array(z.object({ type: z.string(), timestamp: z.number(), quote: z.string() })),
  proposedTasks: z.array(z.object({
    description: z.string(),
    sourceSpeakerId: z.string(),
    sourceTimestamp: z.number(),
    sourceQuote: z.string()
  }))
})

type LLMResponse = z.infer<typeof LLMResponseSchema>

function buildPrompt(transcript: string, validationError?: string): string {
  const errorNote = validationError
    ? `\n\nTu respuesta anterior no cumplió el formato esperado: ${validationError}. Corrígela.`
    : ''

  return `Analiza esta transcripción de una reunión y devolvé un JSON con esta forma exacta:
{
  "summary": { "context": string, "keyPoints": string },
  "chapters": [{ "title": string, "start": number, "end": number }],
  "highlights": [{ "type": string, "timestamp": number, "quote": string }],
  "proposedTasks": [{ "description": string, "sourceSpeakerId": string, "sourceTimestamp": number, "sourceQuote": string }]
}

Transcripción:
${transcript}${errorNote}`
}

async function callDeepSeek(prompt: string): Promise<unknown> {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
  })

  const body = await response.json() as { choices: Array<{ message: { content: string } }> }
  return JSON.parse(body.choices[0].message.content)
}

export async function generateMeetingSummary(meetingId: string, segments: TranscriptSegment[]): Promise<void> {
  const transcript = formatTranscriptForPrompt(segments)

  let parsed: LLMResponse | null = null
  let lastError: string | undefined

  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const raw = await callDeepSeek(buildPrompt(transcript, lastError))
    const result = LLMResponseSchema.safeParse(raw)
    if (result.success) {
      parsed = result.data
    } else {
      lastError = result.error.message
    }
  }

  if (!parsed) {
    await db.insert(summaries).values({ meetingId, status: 'failed' })
    return
  }

  await db.insert(summaries).values({
    meetingId,
    context: parsed.summary.context,
    keyPoints: parsed.summary.keyPoints,
    status: 'completed'
  })

  if (parsed.chapters.length > 0) {
    await db.insert(chapters).values(parsed.chapters.map((c) => ({ meetingId, ...c })))
  }

  if (parsed.highlights.length > 0) {
    await db.insert(highlights).values(parsed.highlights.map((h) => ({ meetingId, ...h })))
  }

  if (parsed.proposedTasks.length > 0) {
    await db.insert(proposedTasks).values(parsed.proposedTasks.map((t) => ({ meetingId, ...t })))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/llmSummary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/llmSummary.ts backend/test/llmSummary.test.ts
git commit -m "feat: generate and persist meeting summary via deepseek with one retry on invalid json"
```

---

### Task 4: `proposedTasks.ts` routes — approve/reject

**Files:**
- Create: `backend/src/routes/proposedTasks.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/proposedTasks.test.ts`

**Interfaces:**
- Consumes: `db`, `proposedTasks`, `tasks` from `../db/*`
- Produces: `registerProposedTasksRoute(app: FastifyInstance): void`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/proposedTasks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirstMock = vi.fn()
const insertValuesMock = vi.fn(() => ({ returning: () => Promise.resolve([{ id: 'task-1' }]) }))
const updateSetMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { proposedTasks: { findFirst: findFirstMock } },
    insert: () => ({ values: insertValuesMock }),
    update: () => ({ set: updateSetMock })
  }
}))

const { buildServer } = await import('../src/server.js')

describe('POST /proposed-tasks/:id/approve', () => {
  beforeEach(() => {
    findFirstMock.mockClear()
    insertValuesMock.mockClear()
    updateSetMock.mockClear()
  })

  it('creates a real Task and marks the proposed task as aprobada', async () => {
    findFirstMock.mockResolvedValue({ id: 'pt-1', description: 'Enviar informe', status: 'pendiente' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/proposed-tasks/pt-1/approve',
      payload: { assignee: 'Ada' }
    })

    expect(response.statusCode).toBe(200)
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      proposedTaskId: 'pt-1',
      description: 'Enviar informe',
      assignee: 'Ada'
    }))
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'aprobada' }))
  })

  it('returns 404 when the proposed task does not exist', async () => {
    findFirstMock.mockResolvedValue(undefined)

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/proposed-tasks/missing/approve', payload: {} })

    expect(response.statusCode).toBe(404)
    expect(insertValuesMock).not.toHaveBeenCalled()
  })
})

describe('POST /proposed-tasks/:id/reject', () => {
  beforeEach(() => {
    findFirstMock.mockClear()
    insertValuesMock.mockClear()
    updateSetMock.mockClear()
  })

  it('marks the proposed task as rechazada without creating a Task', async () => {
    findFirstMock.mockResolvedValue({ id: 'pt-1', description: 'Enviar informe', status: 'pendiente' })

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/proposed-tasks/pt-1/reject', payload: {} })

    expect(response.statusCode).toBe(200)
    expect(insertValuesMock).not.toHaveBeenCalled()
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'rechazada' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/proposedTasks.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

```typescript
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
```

- [ ] **Step 4: Register the route in `server.ts`**

Add to `backend/src/server.ts`:

```typescript
import { registerProposedTasksRoute } from './routes/proposedTasks.js'
// inside buildServer():
registerProposedTasksRoute(app)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run test/proposedTasks.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/proposedTasks.ts backend/src/server.ts backend/test/proposedTasks.test.ts
git commit -m "feat: add proposed-task approve/reject endpoints"
```

---

### Task 5: Wire `generateMeetingSummary` into `checkMeetingCompletion` (fire-and-forget)

**Files:**
- Modify: `backend/src/services/meetingCompletion.ts`
- Modify: `backend/test/meetingCompletion.test.ts`

**Interfaces:**
- Consumes: `generateMeetingSummary` from `./llmSummary.js`

- [ ] **Step 1: Write the failing test**

Append to `backend/test/meetingCompletion.test.ts`:

```typescript
const generateSummaryMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/services/llmSummary.js', () => ({
  generateMeetingSummary: (...args: unknown[]) => generateSummaryMock(...args)
}))

describe('checkMeetingCompletion — AI summary trigger', () => {
  it('invokes generateMeetingSummary with the merged segments after persisting them', async () => {
    findManyMock.mockResolvedValue([
      {
        status: 'completed',
        participantId: 'p1',
        words: JSON.stringify([{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }])
      }
    ])

    await checkMeetingCompletion('meeting-1')

    expect(generateSummaryMock).toHaveBeenCalledWith('meeting-1', [
      { speakerId: 'p1', start: 0, end: 0.3, text: 'hola' }
    ])
  })

  it('does not call generateMeetingSummary when there are no segments to persist', async () => {
    findManyMock.mockResolvedValue([{ status: 'timeout', participantId: 'p2', words: null }])
    generateSummaryMock.mockClear()

    await checkMeetingCompletion('meeting-1')

    expect(generateSummaryMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/meetingCompletion.test.ts`
Expected: FAIL — `generateSummaryMock` never called.

- [ ] **Step 3: Wire the call**

Modify `backend/src/services/meetingCompletion.ts`: import `generateMeetingSummary` and call it (fire-and-forget — do not `await` it inline in a way that fails the whole function if it throws; wrap in a `.catch` that logs) right after the `db.insert(transcriptSegments)` transaction succeeds:

```typescript
// add import at top
import { generateMeetingSummary } from './llmSummary.js'

// after the successful transaction that inserts transcriptSegments (inside checkMeetingCompletion,
// right before the function returns), add:
  generateMeetingSummary(meetingId, merged).catch((err) => {
    console.error(`Failed to generate summary for meeting ${meetingId}: ${err instanceof Error ? err.message : String(err)}`)
  })
```

Do not `await` this call — it must not block or fail `checkMeetingCompletion`'s own return, per the plan's Global Constraints.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/meetingCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/meetingCompletion.ts backend/test/meetingCompletion.test.ts
git commit -m "feat: trigger AI summary generation after persisting meeting segments"
```

---

## Self-Review Notes

- **Spec coverage:** DeepSeek call + JSON schema validation + 1 retry ✅ (Task 3), persistence of all 4 new entities ✅ (Task 3), approve/reject endpoints ✅ (Task 4), fire-and-forget wiring ✅ (Task 5), schema ✅ (Task 1).
- **Fuera de alcance confirmed:** no due-date editing on approval (only `assignee`), no frontend work in this plan.
- **Known integration risk to flag during implementation:** Task 5's fire-and-forget pattern means a failure in `generateMeetingSummary` is only logged, never surfaced anywhere the user can see — acceptable for this MVP per the spec's own "no bloquea nada más" ruling, but the implementer should confirm this logging actually fires in the test (assert `console.error` is called, or check via a rejected mock) rather than assuming the `.catch` is dead code.

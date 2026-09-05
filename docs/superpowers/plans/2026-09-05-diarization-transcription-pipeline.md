# Pipeline de Transcripción + Diarización Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servicio backend que, al terminar una grabación de LiveKit Egress, transcribe cada pista de audio vía Deepgram (remote + callback asíncrono, sin descargar bytes), y produce `TranscriptSegment[]` etiquetados por speaker persistidos en Postgres.

**Architecture:** Fastify recibe el webhook `egress_ended` de LiveKit y, por pista, dispara un request a Deepgram con `url` (S3) + `callback` propio. Deepgram procesa async y hace POST a nuestro callback cuando termina cada pista. Cuando todas las pistas de una reunión llegan a estado terminal, el merger arma la línea de tiempo y persiste.

**Tech Stack:** Node.js, TypeScript, Fastify, Drizzle ORM + `postgres` driver, `livekit-server-sdk` (validación de webhook), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-diarization-transcription-pipeline-design.md`

## Global Constraints

- No se descargan bytes de audio en el backend — solo se pasan URLs a Deepgram (spec: "Decisión clave").
- Diarización = mapeo pista→participante, sin clustering acústico (fuera de alcance).
- Diarización de Deepgram (`diarize=true`) NO se activa — el speaker ya es conocido por la pista.
- Todo el manejo de callbacks debe ser idempotente (Deepgram/LiveKit pueden reintentar POSTs).
- Timeout de pista sin callback: 15 minutos.

---

## File Structure

```
backend/
  package.json
  tsconfig.json
  vitest.config.ts
  drizzle.config.ts
  src/
    server.ts                    # bootstrap Fastify, registra rutas
    db/
      schema.ts                  # tablas Drizzle: meetings, participants, transcriptionJobs, transcriptSegments
      client.ts                  # conexión Drizzle + postgres.js
    types.ts                     # DeepgramWord, TranscriptSegment, JobStatus
    services/
      merger.ts                  # words[] -> TranscriptSegment[] (por pista + multi-pista)
      deepgramDispatch.ts        # POST a Deepgram remote+callback, crea TranscriptionJob
      meetingCompletion.ts       # chequea si todas las jobs de una meeting están terminales, dispara merge+persist
      timeoutSweeper.ts          # marca jobs vencidos como timeout
    routes/
      livekitWebhook.ts          # POST /webhooks/livekit-egress
      deepgramWebhook.ts         # POST /webhooks/deepgram
  test/
    merger.test.ts
    deepgramDispatch.test.ts
    livekitWebhook.test.ts
    deepgramWebhook.test.ts
    meetingCompletion.test.ts
```

---

### Task 1: Project scaffolding + health check

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/src/server.ts`
- Test: `backend/test/server.test.ts`

**Interfaces:**
- Produces: `buildServer(): FastifyInstance` (exported from `src/server.ts`), used by every route test via `.inject()`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "meetai-backend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.4",
    "livekit-server-sdk": "^2.9.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "drizzle-kit": "^0.28.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node'
  }
})
```

- [ ] **Step 4: Install dependencies**

Run: `cd backend && npm install`

- [ ] **Step 5: Write the failing test for server bootstrap**

```typescript
// backend/test/server.test.ts
import { describe, it, expect } from 'vitest'
import { buildServer } from '../src/server.js'

describe('server', () => {
  it('responds 200 on GET /health', async () => {
    const app = buildServer()
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && npx vitest run test/server.test.ts`
Expected: FAIL — `src/server.ts` does not exist / no export `buildServer`.

- [ ] **Step 7: Implement `src/server.ts`**

```typescript
// backend/src/server.ts
import Fastify, { FastifyInstance } from 'fastify'

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true })

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildServer()
  app.listen({ port: 3000, host: '0.0.0.0' })
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && npx vitest run test/server.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/vitest.config.ts backend/src/server.ts backend/test/server.test.ts
git commit -m "chore: scaffold backend with fastify health check"
```

---

### Task 2: Shared types

**Files:**
- Create: `backend/src/types.ts`

**Interfaces:**
- Produces:
  - `interface DeepgramWord { word: string; start: number; end: number; confidence: number }`
  - `interface TranscriptSegment { speakerId: string; start: number; end: number; text: string }`
  - `type JobStatus = 'pending' | 'completed' | 'failed' | 'timeout'`

No test needed — pure type declarations, exercised by later tasks' tests.

- [ ] **Step 1: Create `src/types.ts`**

```typescript
// backend/src/types.ts
export interface DeepgramWord {
  word: string
  start: number
  end: number
  confidence: number
}

export interface TranscriptSegment {
  speakerId: string
  start: number
  end: number
  text: string
}

export type JobStatus = 'pending' | 'completed' | 'failed' | 'timeout'
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/types.ts
git commit -m "feat: add shared pipeline types"
```

---

### Task 3: Merger — words → segments por pista

**Files:**
- Create: `backend/src/services/merger.ts`
- Test: `backend/test/merger.test.ts`

**Interfaces:**
- Consumes: `DeepgramWord`, `TranscriptSegment` from `../src/types.js`
- Produces: `wordsToSegments(words: DeepgramWord[], speakerId: string, pauseThresholdSec = 1.5): TranscriptSegment[]` — usado por Task 4 y por `meetingCompletion.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/merger.test.ts
import { describe, it, expect } from 'vitest'
import { wordsToSegments } from '../src/services/merger.js'
import type { DeepgramWord } from '../src/types.js'

describe('wordsToSegments', () => {
  it('groups consecutive words into one segment when gaps are small', () => {
    const words: DeepgramWord[] = [
      { word: 'hola', start: 0.0, end: 0.3, confidence: 0.99 },
      { word: 'como', start: 0.4, end: 0.7, confidence: 0.98 },
      { word: 'estas', start: 0.8, end: 1.2, confidence: 0.97 }
    ]

    const segments = wordsToSegments(words, 'speaker-1')

    expect(segments).toEqual([
      { speakerId: 'speaker-1', start: 0.0, end: 1.2, text: 'hola como estas' }
    ])
  })

  it('splits into a new segment when the gap exceeds the pause threshold', () => {
    const words: DeepgramWord[] = [
      { word: 'hola', start: 0.0, end: 0.3, confidence: 0.99 },
      { word: 'bueno', start: 3.0, end: 3.4, confidence: 0.95 }
    ]

    const segments = wordsToSegments(words, 'speaker-1')

    expect(segments).toEqual([
      { speakerId: 'speaker-1', start: 0.0, end: 0.3, text: 'hola' },
      { speakerId: 'speaker-1', start: 3.0, end: 3.4, text: 'bueno' }
    ])
  })

  it('returns an empty array for no words', () => {
    expect(wordsToSegments([], 'speaker-1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/merger.test.ts`
Expected: FAIL — `src/services/merger.ts` does not exist.

- [ ] **Step 3: Implement `wordsToSegments`**

```typescript
// backend/src/services/merger.ts
import type { DeepgramWord, TranscriptSegment } from '../types.js'

export function wordsToSegments(
  words: DeepgramWord[],
  speakerId: string,
  pauseThresholdSec = 1.5
): TranscriptSegment[] {
  if (words.length === 0) return []

  const segments: TranscriptSegment[] = []
  let currentWords: DeepgramWord[] = [words[0]]

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]
    const curr = words[i]
    const gap = curr.start - prev.end

    if (gap > pauseThresholdSec) {
      segments.push(buildSegment(currentWords, speakerId))
      currentWords = [curr]
    } else {
      currentWords.push(curr)
    }
  }

  segments.push(buildSegment(currentWords, speakerId))
  return segments
}

function buildSegment(words: DeepgramWord[], speakerId: string): TranscriptSegment {
  return {
    speakerId,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((w) => w.word).join(' ')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/merger.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/merger.ts backend/test/merger.test.ts
git commit -m "feat: group deepgram words into per-track segments"
```

---

### Task 4: Merger — merge multi-pista por timeline global

**Files:**
- Modify: `backend/src/services/merger.ts`
- Modify: `backend/test/merger.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegment` from `../src/types.js`
- Produces: `mergeTracks(tracks: TranscriptSegment[][]): TranscriptSegment[]` — usado por `meetingCompletion.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `backend/test/merger.test.ts`:

```typescript
import { mergeTracks } from '../src/services/merger.js'

describe('mergeTracks', () => {
  it('merges segments from multiple tracks ordered by start time', () => {
    const trackA: TranscriptSegment[] = [
      { speakerId: 'A', start: 0.0, end: 1.0, text: 'hola' },
      { speakerId: 'A', start: 5.0, end: 6.0, text: 'chau' }
    ]
    const trackB: TranscriptSegment[] = [
      { speakerId: 'B', start: 1.5, end: 2.5, text: 'que tal' }
    ]

    const merged = mergeTracks([trackA, trackB])

    expect(merged).toEqual([
      { speakerId: 'A', start: 0.0, end: 1.0, text: 'hola' },
      { speakerId: 'B', start: 1.5, end: 2.5, text: 'que tal' },
      { speakerId: 'A', start: 5.0, end: 6.0, text: 'chau' }
    ])
  })

  it('returns an empty array when there are no tracks', () => {
    expect(mergeTracks([])).toEqual([])
  })
})
```

Add `import type { TranscriptSegment } from '../src/types.js'` at the top of the test file if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/merger.test.ts`
Expected: FAIL — `mergeTracks` is not exported.

- [ ] **Step 3: Implement `mergeTracks`**

Append to `backend/src/services/merger.ts`:

```typescript
export function mergeTracks(tracks: TranscriptSegment[][]): TranscriptSegment[] {
  return tracks.flat().sort((a, b) => a.start - b.start)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/merger.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/merger.ts backend/test/merger.test.ts
git commit -m "feat: merge multi-track segments into global timeline"
```

---

### Task 5: DB schema (Drizzle) + client

**Files:**
- Create: `backend/drizzle.config.ts`
- Create: `backend/src/db/schema.ts`
- Create: `backend/src/db/client.ts`
- Test: `backend/test/db.test.ts` (requiere `DATABASE_URL` apuntando a un Postgres de test — ver Step 6)

**Interfaces:**
- Produces: tablas `meetings`, `participants`, `transcriptionJobs`, `transcriptSegments`; `db` (instancia Drizzle) exportado desde `src/db/client.ts`. Usado por Tasks 6, 7, 8.

- [ ] **Step 1: Create `drizzle.config.ts`**

```typescript
// backend/drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!
  }
})
```

- [ ] **Step 2: Create `src/db/schema.ts`**

```typescript
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
```

- [ ] **Step 3: Create `src/db/client.ts`**

```typescript
// backend/src/db/client.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

const queryClient = postgres(connectionString)
export const db = drizzle(queryClient, { schema })
```

- [ ] **Step 4: Write the failing test**

```typescript
// backend/test/db.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { db } from '../src/db/client.js'
import { meetings } from '../src/db/schema.js'

describe('db schema', () => {
  it('inserts and reads back a meeting', async () => {
    const [inserted] = await db.insert(meetings).values({
      title: 'Test meeting',
      startedAt: new Date('2026-01-01T10:00:00Z')
    }).returning()

    const [found] = await db.select().from(meetings).where(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (m) => undefined as never
    )

    expect(inserted.title).toBe('Test meeting')
  })
})
```

> Nota: este test requiere una base Postgres real disponible en `DATABASE_URL` (ej. levantada con `docker run -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:16` y `DATABASE_URL=postgres://postgres:test@localhost:5432/postgres`), y las migraciones aplicadas (Step 6).

- [ ] **Step 5: Simplify the test query (fix drizzle usage) and run to verify it fails**

Replace the `db.select()` call above — it was pseudocode. Correct version:

```typescript
// backend/test/db.test.ts
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { meetings } from '../src/db/schema.js'

describe('db schema', () => {
  it('inserts and reads back a meeting', async () => {
    const [inserted] = await db.insert(meetings).values({
      title: 'Test meeting',
      startedAt: new Date('2026-01-01T10:00:00Z')
    }).returning()

    const [found] = await db.select().from(meetings).where(eq(meetings.id, inserted.id))

    expect(found.title).toBe('Test meeting')
  })
})
```

Run: `cd backend && DATABASE_URL=postgres://postgres:test@localhost:5432/postgres npx vitest run test/db.test.ts`
Expected: FAIL — table `meetings` does not exist (no migration applied yet).

- [ ] **Step 6: Generate and apply migration**

Run:
```bash
cd backend
npx drizzle-kit generate
DATABASE_URL=postgres://postgres:test@localhost:5432/postgres npx drizzle-kit migrate
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend && DATABASE_URL=postgres://postgres:test@localhost:5432/postgres npx vitest run test/db.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/drizzle.config.ts backend/src/db/schema.ts backend/src/db/client.ts backend/test/db.test.ts backend/drizzle
git commit -m "feat: add drizzle schema for meetings/participants/jobs/segments"
```

---

### Task 6: Deepgram dispatcher

**Files:**
- Create: `backend/src/services/deepgramDispatch.ts`
- Test: `backend/test/deepgramDispatch.test.ts`

**Interfaces:**
- Consumes: `db`, `transcriptionJobs` from `../src/db/*`
- Produces: `dispatchTrackForTranscription(params: { meetingId: string; trackId: string; participantId: string; trackUrl: string; callbackBaseUrl: string }): Promise<void>` — usado por `livekitWebhook.ts` (Task 7).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/deepgramDispatch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dispatchTrackForTranscription } from '../src/services/deepgramDispatch.js'

const insertMock = vi.fn()
const valuesMock = vi.fn(() => ({ returning: () => Promise.resolve([{ id: 'job-1' }]) }))

vi.mock('../src/db/client.js', () => ({
  db: {
    insert: (...args: unknown[]) => {
      insertMock(...args)
      return { values: valuesMock }
    }
  }
}))

describe('dispatchTrackForTranscription', () => {
  beforeEach(() => {
    insertMock.mockClear()
    valuesMock.mockClear()
    process.env.DEEPGRAM_API_KEY = 'test-key'
  })

  it('calls Deepgram listen endpoint with url and callback, then stores the job', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ request_id: 'dg-req-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await dispatchTrackForTranscription({
      meetingId: 'meeting-1',
      trackId: 'track-1',
      participantId: 'participant-1',
      trackUrl: 'https://bucket.s3.amazonaws.com/track-1.ogg',
      callbackBaseUrl: 'https://backend.example.com'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.deepgram.com/v1/listen'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Token test-key' })
      })
    )

    const [, options] = fetchMock.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.url).toBe('https://bucket.s3.amazonaws.com/track-1.ogg')
    expect(body.callback).toContain('https://backend.example.com/webhooks/deepgram')
    expect(body.callback).toContain('meetingId=meeting-1')
    expect(body.callback).toContain('trackId=track-1')

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      meetingId: 'meeting-1',
      trackId: 'track-1',
      participantId: 'participant-1',
      status: 'pending'
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/deepgramDispatch.test.ts`
Expected: FAIL — `src/services/deepgramDispatch.ts` does not exist.

- [ ] **Step 3: Implement `dispatchTrackForTranscription`**

```typescript
// backend/src/services/deepgramDispatch.ts
import { db } from '../db/client.js'
import { transcriptionJobs } from '../db/schema.js'

interface DispatchParams {
  meetingId: string
  trackId: string
  participantId: string
  trackUrl: string
  callbackBaseUrl: string
}

export async function dispatchTrackForTranscription(params: DispatchParams): Promise<void> {
  const { meetingId, trackId, participantId, trackUrl, callbackBaseUrl } = params

  const callbackUrl = `${callbackBaseUrl}/webhooks/deepgram?meetingId=${meetingId}&trackId=${trackId}`

  const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-3', {
    method: 'POST',
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: trackUrl,
      callback: callbackUrl
    })
  })

  if (!response.ok) {
    throw new Error(`Deepgram dispatch failed for track ${trackId}: ${response.status}`)
  }

  const { request_id: deepgramRequestId } = await response.json() as { request_id: string }

  await db.insert(transcriptionJobs).values({
    meetingId,
    trackId,
    participantId,
    deepgramRequestId,
    status: 'pending'
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/deepgramDispatch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/deepgramDispatch.ts backend/test/deepgramDispatch.test.ts
git commit -m "feat: dispatch tracks to deepgram remote transcription with callback"
```

---

### Task 7: LiveKit webhook receiver

**Files:**
- Create: `backend/src/routes/livekitWebhook.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/livekitWebhook.test.ts`

**Interfaces:**
- Consumes: `dispatchTrackForTranscription` from `../services/deepgramDispatch.js`, `WebhookReceiver` from `livekit-server-sdk`
- Produces: `registerLivekitWebhookRoute(app: FastifyInstance): void`, registrado en `buildServer()`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/livekitWebhook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dispatchMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/services/deepgramDispatch.js', () => ({
  dispatchTrackForTranscription: dispatchMock
}))

const receiveMock = vi.fn()
vi.mock('livekit-server-sdk', () => ({
  WebhookReceiver: vi.fn().mockImplementation(() => ({
    receive: receiveMock
  }))
}))

const { buildServer } = await import('../src/server.js')

describe('POST /webhooks/livekit-egress', () => {
  beforeEach(() => {
    dispatchMock.mockClear()
    receiveMock.mockClear()
  })

  it('dispatches a transcription job per completed track', async () => {
    receiveMock.mockReturnValue({
      event: 'egress_ended',
      egressInfo: {
        status: 'EGRESS_COMPLETE',
        roomName: 'meeting-1',
        fileResults: [
          { filename: 'track-1.ogg', location: 'https://bucket.s3.amazonaws.com/track-1.ogg' }
        ]
      }
    })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/livekit-egress',
      headers: { authorization: 'test-signature' },
      payload: '{}'
    })

    expect(response.statusCode).toBe(200)
    expect(dispatchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores events that are not egress_ended', async () => {
    receiveMock.mockReturnValue({ event: 'room_started' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/livekit-egress',
      headers: { authorization: 'test-signature' },
      payload: '{}'
    })

    expect(response.statusCode).toBe(200)
    expect(dispatchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/livekitWebhook.test.ts`
Expected: FAIL — route does not exist / 404.

- [ ] **Step 3: Implement the route**

Note: this task assumes the LiveKit egress payload carries enough metadata to
resolve `participantId` per track (LiveKit's `TrackCompositeEgressRequest` /
per-track egress includes `trackId`; participant mapping comes from room
metadata set at egress-start time). For this task, the mapping function is
stubbed as `resolveParticipantId` and hardcoded — wiring real participant
resolution depends on how egress is started, which belongs to the LiveKit
room-management sub-project.

```typescript
// backend/src/routes/livekitWebhook.ts
import type { FastifyInstance } from 'fastify'
import { WebhookReceiver } from 'livekit-server-sdk'
import { dispatchTrackForTranscription } from '../services/deepgramDispatch.js'

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
)

function resolveParticipantId(trackFilename: string): string {
  return trackFilename.split('.')[0]
}

export function registerLivekitWebhookRoute(app: FastifyInstance): void {
  app.post('/webhooks/livekit-egress', async (request, reply) => {
    const body = JSON.stringify(request.body)
    const authHeader = request.headers.authorization ?? ''

    const event = receiver.receive(body, authHeader)

    if (event.event !== 'egress_ended' || event.egressInfo?.status !== 'EGRESS_COMPLETE') {
      return reply.code(200).send({ received: true })
    }

    const meetingId = event.egressInfo.roomName!
    const callbackBaseUrl = process.env.BACKEND_PUBLIC_URL!

    for (const file of event.egressInfo.fileResults ?? []) {
      await dispatchTrackForTranscription({
        meetingId,
        trackId: file.filename,
        participantId: resolveParticipantId(file.filename),
        trackUrl: file.location,
        callbackBaseUrl
      })
    }

    return reply.code(200).send({ received: true })
  })
}
```

- [ ] **Step 4: Register the route in `server.ts`**

```typescript
// backend/src/server.ts (modify)
import Fastify, { FastifyInstance } from 'fastify'
import { registerLivekitWebhookRoute } from './routes/livekitWebhook.js'

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true })

  app.get('/health', async () => ({ status: 'ok' }))
  registerLivekitWebhookRoute(app)

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildServer()
  app.listen({ port: 3000, host: '0.0.0.0' })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run test/livekitWebhook.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/livekitWebhook.ts backend/src/server.ts backend/test/livekitWebhook.test.ts
git commit -m "feat: receive livekit egress_ended webhook and dispatch tracks"
```

---

### Task 8: Deepgram callback receiver (idempotente)

**Files:**
- Create: `backend/src/routes/deepgramWebhook.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/deepgramWebhook.test.ts`

**Interfaces:**
- Consumes: `db`, `transcriptionJobs` from `../db/*`, `checkMeetingCompletion` from `../services/meetingCompletion.js` (Task 9 — for this task, stub/mock it)
- Produces: `registerDeepgramWebhookRoute(app: FastifyInstance): void`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/deepgramWebhook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findJobMock = vi.fn()
const updateSetMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
const checkCompletionMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { transcriptionJobs: { findFirst: findJobMock } },
    update: () => ({ set: updateSetMock })
  }
}))

vi.mock('../src/services/meetingCompletion.js', () => ({
  checkMeetingCompletion: checkCompletionMock
}))

const { buildServer } = await import('../src/server.js')

describe('POST /webhooks/deepgram', () => {
  beforeEach(() => {
    findJobMock.mockClear()
    updateSetMock.mockClear()
    checkCompletionMock.mockClear()
  })

  it('marks the job completed and stores words on first callback', async () => {
    findJobMock.mockResolvedValue({ id: 'job-1', status: 'pending', meetingId: 'meeting-1' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/deepgram?meetingId=meeting-1&trackId=track-1',
      payload: {
        results: {
          channels: [{ alternatives: [{ words: [{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }] }] }]
        }
      }
    })

    expect(response.statusCode).toBe(200)
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
    expect(checkCompletionMock).toHaveBeenCalledWith('meeting-1')
  })

  it('is idempotent: does nothing if the job is already completed', async () => {
    findJobMock.mockResolvedValue({ id: 'job-1', status: 'completed', meetingId: 'meeting-1' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/deepgram?meetingId=meeting-1&trackId=track-1',
      payload: { results: { channels: [{ alternatives: [{ words: [] }] }] } }
    })

    expect(response.statusCode).toBe(200)
    expect(updateSetMock).not.toHaveBeenCalled()
    expect(checkCompletionMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/deepgramWebhook.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Add `words` JSON column to store raw callback payload**

Modify `backend/src/db/schema.ts` — add a `words` column to `transcriptionJobs`:

```typescript
// add to transcriptionJobs table definition in backend/src/db/schema.ts
  words: text('words'), // JSON-stringified DeepgramWord[]
```

Run:
```bash
cd backend
npx drizzle-kit generate
DATABASE_URL=postgres://postgres:test@localhost:5432/postgres npx drizzle-kit migrate
```

- [ ] **Step 4: Implement the route**

```typescript
// backend/src/routes/deepgramWebhook.ts
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { transcriptionJobs } from '../db/schema.js'
import { checkMeetingCompletion } from '../services/meetingCompletion.js'

interface DeepgramCallbackBody {
  results: {
    channels: Array<{
      alternatives: Array<{
        words: Array<{ word: string; start: number; end: number; confidence: number }>
      }>
    }>
  }
}

interface DeepgramCallbackQuery {
  meetingId: string
  trackId: string
}

export function registerDeepgramWebhookRoute(app: FastifyInstance): void {
  app.post<{ Body: DeepgramCallbackBody; Querystring: DeepgramCallbackQuery }>(
    '/webhooks/deepgram',
    async (request, reply) => {
      const { meetingId, trackId } = request.query

      const job = await db.query.transcriptionJobs.findFirst({
        where: (jobs, { eq: eqFn, and }) => and(eqFn(jobs.meetingId, meetingId), eqFn(jobs.trackId, trackId))
      })

      if (!job || job.status === 'completed') {
        return reply.code(200).send({ received: true })
      }

      const words = request.body.results.channels[0]?.alternatives[0]?.words ?? []

      await db.update(transcriptionJobs)
        .set({ status: 'completed', words: JSON.stringify(words) })
        .where(eq(transcriptionJobs.id, job.id))

      await checkMeetingCompletion(meetingId)

      return reply.code(200).send({ received: true })
    }
  )
}
```

- [ ] **Step 5: Register the route in `server.ts`**

Add to `backend/src/server.ts`:

```typescript
import { registerDeepgramWebhookRoute } from './routes/deepgramWebhook.js'
// ...inside buildServer():
registerDeepgramWebhookRoute(app)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npx vitest run test/deepgramWebhook.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/deepgramWebhook.ts backend/src/server.ts backend/src/db/schema.ts backend/drizzle backend/test/deepgramWebhook.test.ts
git commit -m "feat: receive deepgram callback idempotently and store words"
```

---

### Task 9: Meeting completion check + persist merged segments

**Files:**
- Create: `backend/src/services/meetingCompletion.ts`
- Test: `backend/test/meetingCompletion.test.ts`

**Interfaces:**
- Consumes: `db`, `transcriptionJobs`, `transcriptSegments` from `../db/*`, `wordsToSegments`, `mergeTracks` from `./merger.js`
- Produces: `checkMeetingCompletion(meetingId: string): Promise<void>` — llamado desde `deepgramWebhook.ts` (Task 8) y `timeoutSweeper.ts` (Task 10).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/meetingCompletion.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn()
const insertValuesMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { transcriptionJobs: { findMany: findManyMock } },
    insert: () => ({ values: insertValuesMock })
  }
}))

const { checkMeetingCompletion } = await import('../src/services/meetingCompletion.js')

describe('checkMeetingCompletion', () => {
  beforeEach(() => {
    findManyMock.mockClear()
    insertValuesMock.mockClear()
  })

  it('does nothing if some jobs are still pending', async () => {
    findManyMock.mockResolvedValue([
      { status: 'completed', participantId: 'p1', words: '[]' },
      { status: 'pending', participantId: 'p2', words: null }
    ])

    await checkMeetingCompletion('meeting-1')

    expect(insertValuesMock).not.toHaveBeenCalled()
  })

  it('merges and persists segments once all jobs reach a terminal state', async () => {
    findManyMock.mockResolvedValue([
      {
        status: 'completed',
        participantId: 'p1',
        words: JSON.stringify([{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }])
      },
      { status: 'timeout', participantId: 'p2', words: null }
    ])

    await checkMeetingCompletion('meeting-1')

    expect(insertValuesMock).toHaveBeenCalledWith([
      { meetingId: 'meeting-1', speakerId: 'p1', start: 0, end: 0.3, text: 'hola' }
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/meetingCompletion.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement `checkMeetingCompletion`**

```typescript
// backend/src/services/meetingCompletion.ts
import { db } from '../db/client.js'
import { transcriptSegments } from '../db/schema.js'
import { wordsToSegments, mergeTracks } from './merger.js'
import type { DeepgramWord } from '../types.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'timeout'])

export async function checkMeetingCompletion(meetingId: string): Promise<void> {
  const jobs = await db.query.transcriptionJobs.findMany({
    where: (t, { eq }) => eq(t.meetingId, meetingId)
  })

  const allTerminal = jobs.every((job) => TERMINAL_STATUSES.has(job.status))
  if (!allTerminal) return

  const tracks = jobs
    .filter((job) => job.status === 'completed' && job.words)
    .map((job) => {
      const words = JSON.parse(job.words as string) as DeepgramWord[]
      return wordsToSegments(words, job.participantId)
    })

  const merged = mergeTracks(tracks)
  if (merged.length === 0) return

  await db.insert(transcriptSegments).values(
    merged.map((segment) => ({
      meetingId,
      speakerId: segment.speakerId,
      start: segment.start,
      end: segment.end,
      text: segment.text
    }))
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/meetingCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/meetingCompletion.ts backend/test/meetingCompletion.test.ts
git commit -m "feat: merge and persist segments once all tracks reach terminal state"
```

---

### Task 10: Timeout sweeper

**Files:**
- Create: `backend/src/services/timeoutSweeper.ts`
- Test: `backend/test/timeoutSweeper.test.ts`

**Interfaces:**
- Consumes: `db`, `transcriptionJobs` from `../db/*`, `checkMeetingCompletion` from `./meetingCompletion.js`
- Produces: `sweepTimedOutJobs(now?: Date): Promise<void>` — invocado por un cron/interval externo (fuera de este plan; se documenta cómo cablearlo en el README de `backend/`).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/timeoutSweeper.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn()
const updateSetMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
const checkCompletionMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { transcriptionJobs: { findMany: findManyMock } },
    update: () => ({ set: updateSetMock })
  }
}))

vi.mock('../src/services/meetingCompletion.js', () => ({
  checkMeetingCompletion: checkCompletionMock
}))

const { sweepTimedOutJobs } = await import('../src/services/timeoutSweeper.js')

describe('sweepTimedOutJobs', () => {
  beforeEach(() => {
    findManyMock.mockClear()
    updateSetMock.mockClear()
    checkCompletionMock.mockClear()
  })

  it('marks pending jobs older than 15 minutes as timeout and checks completion', async () => {
    findManyMock.mockResolvedValue([
      { id: 'job-1', meetingId: 'meeting-1', status: 'pending', createdAt: new Date('2026-01-01T10:00:00Z') }
    ])

    const now = new Date('2026-01-01T10:16:00Z')
    await sweepTimedOutJobs(now)

    expect(updateSetMock).toHaveBeenCalledWith({ status: 'timeout' })
    expect(checkCompletionMock).toHaveBeenCalledWith('meeting-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/timeoutSweeper.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement `sweepTimedOutJobs`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/timeoutSweeper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/timeoutSweeper.ts backend/test/timeoutSweeper.test.ts
git commit -m "feat: sweep and finalize timed-out transcription jobs"
```

---

## Self-Review Notes

- **Spec coverage:** webhook receiver ✅ (Task 7), dispatch sin descarga de bytes ✅ (Task 6), callback async idempotente ✅ (Task 8), merger por pausas + multi-pista ✅ (Tasks 3-4), timeout sweeper ✅ (Task 10), persistencia transaccional simplificada a un solo `insert` batch ✅ (Task 9 — nota: no se envolvió en `db.transaction` explícito porque es un único insert; si se agrega el AI processor en el mismo insert más adelante, ahí sí conviene una transacción real).
- **Fuera de alcance confirmado:** clustering acústico no se implementó en ninguna tarea (correcto, según spec).
- **Pendiente explícito para el siguiente sub-proyecto:** `resolveParticipantId` en Task 7 es un stub — la resolución real de `trackId → participantId` depende de cómo se inicia el Egress (sub-proyecto de videollamada/salas), documentado inline en el Step 3 de esa tarea para que no se pierda como deuda oculta.

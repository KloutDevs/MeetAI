# LiveKit Room + Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend endpoints to create a LiveKit room + Postgres `Meeting`, issue join tokens that create `Participant` rows with LiveKit identity = participant UUID, and start per-track audio egress (named `{meetingId}/{participantId}.ogg`) when a participant publishes audio — closing the `resolveParticipantId` stub debt from the transcription pipeline. Plus a minimal React join-room page.

**Architecture:** Two new backend services (`livekitRoom.ts`, extension of `livekitWebhook.ts`) wired to existing Fastify app and Drizzle schema. A separate `frontend/` Vite+React app using `livekit-client`/`@livekit/components-react` to join the room.

**Tech Stack:** Node.js/TypeScript/Fastify/Drizzle (backend, existing), Vite + React + TypeScript (new frontend), `livekit-server-sdk` (RoomServiceClient, EgressClient, AccessToken), `livekit-client` + `@livekit/components-react` (frontend).

**Spec:** `docs/superpowers/specs/2026-09-05-livekit-room-session-design.md`

## Global Constraints

- Egress output filepath for audio tracks MUST be `{meetingId}/{participantId}.ogg` (participantId = the Postgres `Participant.id` UUID) — this is what makes `resolveParticipantId` in the existing `livekitWebhook.ts` (`trackFilename.split('.')[0]`) resolve correctly.
- LiveKit participant `identity` MUST equal the Postgres `Participant.id` UUID, set at token-issuance time.
- Only audio tracks trigger `startTrackEgress` — video tracks must not.
- Recording starts automatically (no manual "start recording" step) — egress dispatch happens on `track_published`, not on a separate user action.

---

## File Structure

```
backend/
  src/
    services/
      livekitRoom.ts          # createMeetingRoom, issueParticipantToken
    routes/
      rooms.ts                # POST /rooms, POST /rooms/:meetingId/token
      livekitWebhook.ts        # MODIFY: add track_published handling
    server.ts                  # MODIFY: register rooms routes
  test/
    livekitRoom.test.ts
    rooms.test.ts
    livekitWebhook.test.ts     # MODIFY: add track_published tests
frontend/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.tsx
    JoinRoom.tsx                # form -> token -> LiveKitRoom + VideoConference
```

---

### Task 1: `livekitRoom.ts` service — createMeetingRoom + issueParticipantToken

**Files:**
- Create: `backend/src/services/livekitRoom.ts`
- Test: `backend/test/livekitRoom.test.ts`

**Interfaces:**
- Consumes: `db`, `meetings`, `participants` from `../db/*`
- Produces:
  - `createMeetingRoom(title: string): Promise<{ meetingId: string; roomName: string }>`
  - `issueParticipantToken(meetingId: string, participantName: string): Promise<{ participantId: string; token: string }>`
  - Used by `rooms.ts` (Task 2).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/livekitRoom.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertValuesMock = vi.fn()
vi.mock('../src/db/client.js', () => ({
  db: {
    insert: () => ({ values: (v: unknown) => { insertValuesMock(v); return { returning: () => Promise.resolve([{ id: 'row-1', ...(v as object) }]) } } })
  }
}))

const createRoomMock = vi.fn().mockResolvedValue({ name: 'room-row-1' })
vi.mock('livekit-server-sdk', async () => {
  const actual = await vi.importActual<typeof import('livekit-server-sdk')>('livekit-server-sdk')
  return {
    ...actual,
    RoomServiceClient: vi.fn().mockImplementation(() => ({ createRoom: createRoomMock }))
  }
})

const { createMeetingRoom, issueParticipantToken } = await import('../src/services/livekitRoom.js')

describe('createMeetingRoom', () => {
  beforeEach(() => {
    insertValuesMock.mockClear()
    createRoomMock.mockClear()
    process.env.LIVEKIT_API_KEY = 'test-key'
    process.env.LIVEKIT_API_SECRET = 'test-secret'
    process.env.LIVEKIT_URL = 'https://test.livekit.cloud'
  })

  it('creates a Meeting row and a LiveKit room named after the meeting id', async () => {
    const result = await createMeetingRoom('Weekly sync')

    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Weekly sync' }))
    expect(createRoomMock).toHaveBeenCalledWith(expect.objectContaining({ name: result.meetingId }))
    expect(result.roomName).toBe(result.meetingId)
  })
})

describe('issueParticipantToken', () => {
  beforeEach(() => {
    insertValuesMock.mockClear()
    process.env.LIVEKIT_API_KEY = 'test-key'
    process.env.LIVEKIT_API_SECRET = 'test-secret'
  })

  it('creates a Participant row and returns a token whose identity is the participant id', async () => {
    const { participantId, token } = await issueParticipantToken('meeting-1', 'Ada')

    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ meetingId: 'meeting-1', name: 'Ada' }))
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3) // JWT shape

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    expect(payload.sub).toBe(participantId)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/livekitRoom.test.ts`
Expected: FAIL — `src/services/livekitRoom.ts` does not exist.

- [ ] **Step 3: Implement `livekitRoom.ts`**

```typescript
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

  await roomServiceClient().createRoom({ name: meeting.id })

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/livekitRoom.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/livekitRoom.ts backend/test/livekitRoom.test.ts
git commit -m "feat: create livekit rooms and issue participant tokens with uuid identity"
```

---

### Task 2: `rooms.ts` routes

**Files:**
- Create: `backend/src/routes/rooms.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/rooms.test.ts`

**Interfaces:**
- Consumes: `createMeetingRoom`, `issueParticipantToken` from `../services/livekitRoom.js`
- Produces: `registerRoomsRoute(app: FastifyInstance): void`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/test/rooms.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMeetingRoomMock = vi.fn()
const issueParticipantTokenMock = vi.fn()
vi.mock('../src/services/livekitRoom.js', () => ({
  createMeetingRoom: (...args: unknown[]) => createMeetingRoomMock(...args),
  issueParticipantToken: (...args: unknown[]) => issueParticipantTokenMock(...args)
}))

const { buildServer } = await import('../src/server.js')

describe('POST /rooms', () => {
  beforeEach(() => {
    createMeetingRoomMock.mockClear()
    issueParticipantTokenMock.mockClear()
  })

  it('creates a meeting room and returns its id', async () => {
    createMeetingRoomMock.mockResolvedValue({ meetingId: 'meeting-1', roomName: 'meeting-1' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/rooms',
      payload: { title: 'Weekly sync' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ meetingId: 'meeting-1', roomName: 'meeting-1' })
    expect(createMeetingRoomMock).toHaveBeenCalledWith('Weekly sync')
  })
})

describe('POST /rooms/:meetingId/token', () => {
  beforeEach(() => {
    createMeetingRoomMock.mockClear()
    issueParticipantTokenMock.mockClear()
  })

  it('issues a participant token for the given meeting', async () => {
    issueParticipantTokenMock.mockResolvedValue({ participantId: 'p1', token: 'jwt-token' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/meeting-1/token',
      payload: { participantName: 'Ada' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ participantId: 'p1', token: 'jwt-token' })
    expect(issueParticipantTokenMock).toHaveBeenCalledWith('meeting-1', 'Ada')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/rooms.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement the route**

```typescript
// backend/src/routes/rooms.ts
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
```

- [ ] **Step 4: Register the route in `server.ts`**

Add to `backend/src/server.ts`:

```typescript
import { registerRoomsRoute } from './routes/rooms.js'
// inside buildServer(), alongside the other register* calls:
registerRoomsRoute(app)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run test/rooms.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/rooms.ts backend/src/server.ts backend/test/rooms.test.ts
git commit -m "feat: add rooms routes for meeting creation and participant tokens"
```

---

### Task 3: Extend `livekitWebhook.ts` — start per-track audio egress on `track_published`

**Files:**
- Modify: `backend/src/routes/livekitWebhook.ts`
- Modify: `backend/test/livekitWebhook.test.ts`

**Interfaces:**
- Consumes: `EgressClient` from `livekit-server-sdk`
- Produces: no new exports — extends the existing route handler's event switch.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/livekitWebhook.test.ts`:

```typescript
const startTrackEgressMock = vi.fn().mockResolvedValue({ egressId: 'egress-1' })
vi.mock('livekit-server-sdk', async () => {
  const actual = await vi.importActual<typeof import('livekit-server-sdk')>('livekit-server-sdk')
  return {
    ...actual,
    WebhookReceiver: vi.fn().mockImplementation(() => ({ receive: receiveMock })),
    EgressClient: vi.fn().mockImplementation(() => ({ startTrackEgress: startTrackEgressMock }))
  }
})

describe('POST /webhooks/livekit-egress — track_published', () => {
  beforeEach(() => {
    startTrackEgressMock.mockClear()
    receiveMock.mockClear()
  })

  it('starts track egress for a published audio track, named after the participant id', async () => {
    receiveMock.mockReturnValue({
      event: 'track_published',
      room: { name: 'meeting-1' },
      participant: { identity: 'participant-1' },
      track: { sid: 'TR_abc', type: 'audio' }
    })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/livekit-egress',
      headers: { authorization: 'test-signature' },
      payload: '{}'
    })

    expect(response.statusCode).toBe(200)
    expect(startTrackEgressMock).toHaveBeenCalledWith(
      'meeting-1',
      expect.objectContaining({ filepath: 'meeting-1/participant-1.ogg' }),
      'TR_abc'
    )
  })

  it('does not start egress for a published video track', async () => {
    receiveMock.mockReturnValue({
      event: 'track_published',
      room: { name: 'meeting-1' },
      participant: { identity: 'participant-1' },
      track: { sid: 'TR_video', type: 'video' }
    })

    const app = buildServer()
    await app.inject({
      method: 'POST',
      url: '/webhooks/livekit-egress',
      headers: { authorization: 'test-signature' },
      payload: '{}'
    })

    expect(startTrackEgressMock).not.toHaveBeenCalled()
  })
})
```

Note: the exact `startTrackEgress` call signature (`roomName`, output config, trackId) matches the `livekit-server-sdk` v2 `EgressClient.startTrackEgress(roomName, output, trackId)` shape — verify this against the installed SDK version and adjust the assertion if the real signature differs (the implementer should read the type definitions in `node_modules/livekit-server-sdk` before writing the assertion and implementation).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/livekitWebhook.test.ts`
Expected: FAIL — no `track_published` handling exists.

- [ ] **Step 3: Implement the extension**

Modify `backend/src/routes/livekitWebhook.ts`, adding an `EgressClient` instance and a branch for `track_published`:

```typescript
// backend/src/routes/livekitWebhook.ts (add near the top, alongside the WebhookReceiver setup)
import { EgressClient, TrackType } from 'livekit-server-sdk'

const egressClient = new EgressClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
)

// inside registerLivekitWebhookRoute's handler, after decoding `event`, before the egress_ended branch:
if (event.event === 'track_published') {
  if (event.track?.type === TrackType.AUDIO) {
    const roomName = event.room!.name
    const participantId = event.participant!.identity
    await egressClient.startTrackEgress(
      roomName,
      { filepath: `${roomName}/${participantId}.ogg` },
      event.track.sid
    )
  }
  return reply.code(200).send({ received: true })
}
```

The implementer should verify `TrackType.AUDIO`'s actual enum value against the installed SDK (it may be the numeric protobuf enum or a string, mirroring the `EgressStatus` situation already handled in this file) and adjust the comparison accordingly, consistent with how Task 7 handled the `EgressStatus` string/enum mismatch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/livekitWebhook.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/livekitWebhook.ts backend/test/livekitWebhook.test.ts
git commit -m "feat: start per-track audio egress named after participant id on track_published"
```

---

### Task 4: Minimal frontend join-room page

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/JoinRoom.tsx`

**Interfaces:**
- Consumes: backend `POST /rooms` and `POST /rooms/:meetingId/token` (Task 2)
- Produces: a runnable Vite dev app (`npm run dev` in `frontend/`)

This task has no automated tests (a live video call cannot be meaningfully unit-tested) — it is verified manually per the spec's "Test manual de integración" section. Do not invent a test framework for this task.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "meetai-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "livekit-client": "^2.7.0",
    "@livekit/components-react": "^2.6.0",
    "@livekit/components-styles": "^1.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()]
})
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>MeetAI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `frontend/src/main.tsx`**

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@livekit/components-styles'
import { JoinRoom } from './JoinRoom.js'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JoinRoom />
  </React.StrictMode>
)
```

- [ ] **Step 6: Create `frontend/src/JoinRoom.tsx`**

```typescript
import { useState } from 'react'
import { LiveKitRoom, VideoConference } from '@livekit/components-react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'
const LIVEKIT_SERVER_URL = import.meta.env.VITE_LIVEKIT_URL as string

export function JoinRoom() {
  const [meetingId, setMeetingId] = useState('')
  const [name, setName] = useState('')
  const [token, setToken] = useState<string | null>(null)

  async function createMeeting() {
    const response = await fetch(`${BACKEND_URL}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'MeetAI Session' })
    })
    const { meetingId: newMeetingId } = await response.json()
    setMeetingId(newMeetingId)
  }

  async function join() {
    const response = await fetch(`${BACKEND_URL}/rooms/${meetingId}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantName: name })
    })
    const { token: participantToken } = await response.json()
    setToken(participantToken)
  }

  if (token) {
    return (
      <LiveKitRoom
        serverUrl={LIVEKIT_SERVER_URL}
        token={token}
        connect
        video
        audio
        data-lk-theme="default"
        style={{ height: '100vh' }}
      >
        <VideoConference />
      </LiveKitRoom>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>MeetAI</h1>
      <button onClick={createMeeting}>Crear reunión</button>
      {meetingId && <p>Meeting ID: {meetingId}</p>}
      <input placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={join} disabled={!meetingId || !name}>Unirse</button>
    </div>
  )
}
```

- [ ] **Step 7: Install dependencies and verify it builds**

Run:
```bash
cd frontend
npm install
npx tsc -b --noEmit
```
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: add minimal join-room frontend using livekit-client"
```

---

## Self-Review Notes

- **Spec coverage:** room + token creation with UUID identity ✅ (Task 1-2), per-track audio egress named after participant id ✅ (Task 3), minimal join UI ✅ (Task 4), auto-recording (no manual start step) ✅ (egress triggers on `track_published`, not a separate endpoint).
- **Debt closure confirmed:** `resolveParticipantId`'s `trackFilename.split('.')[0]` now receives real participant UUIDs because Task 3's egress filepath is `{meetingId}/{participantId}.ogg`.
- **Known SDK-shape risk flagged inline:** Task 3's brief explicitly warns the implementer to verify `EgressClient.startTrackEgress`'s real parameter order and `TrackType.AUDIO`'s real enum representation against the installed `livekit-server-sdk` version before writing the implementation and its test assertions — mirroring the `EgressStatus` string-vs-enum issue already resolved in Task 7 of the previous sub-project. This is flagged, not left as a silent assumption.
- **Fuera de alcance confirmed:** no AI summary work, no post-call UI tabs, in any task.

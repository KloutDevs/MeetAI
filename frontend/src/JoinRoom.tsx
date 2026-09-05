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

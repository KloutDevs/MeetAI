import { useState } from 'react'
import { LiveKitRoom, VideoConference } from '@livekit/components-react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'
const LIVEKIT_SERVER_URL = import.meta.env.VITE_LIVEKIT_URL as string

function meetingIdFromUrl(): string {
  return new URLSearchParams(window.location.search).get('meetingId') ?? ''
}

function inviteLinkFor(meetingId: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('meetingId', meetingId)
  return url.toString()
}

export function JoinRoom() {
  const [meetingId, setMeetingId] = useState(meetingIdFromUrl)
  const [name, setName] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function createMeeting() {
    setError(null)
    try {
      const response = await fetch(`${BACKEND_URL}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'MeetAI Session' })
      })
      if (!response.ok) {
        setError(`No se pudo crear la reunión (status ${response.status})`)
        return
      }
      const { meetingId: newMeetingId } = await response.json()
      setMeetingId(newMeetingId)
    } catch (err) {
      setError('No se pudo conectar con el servidor para crear la reunión')
    }
  }

  async function join() {
    setError(null)
    try {
      const response = await fetch(`${BACKEND_URL}/rooms/${meetingId}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantName: name })
      })
      if (!response.ok) {
        setError(`No se pudo unir a la reunión (status ${response.status})`)
        return
      }
      const { token: participantToken } = await response.json()
      setToken(participantToken)
    } catch (err) {
      setError('No se pudo conectar con el servidor para unirse a la reunión')
    }
  }

  if (!LIVEKIT_SERVER_URL) {
    return (
      <div style={{ padding: 24 }}>
        <h1>MeetAI</h1>
        <p style={{ color: 'red' }}>Falta configurar VITE_LIVEKIT_URL en .env</p>
      </div>
    )
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
        onDisconnected={() => setToken(null)}
      >
        <VideoConference />
      </LiveKitRoom>
    )
  }

  const reviewLink = meetingId ? `${window.location.origin}${window.location.pathname}?meeting=${meetingId}` : null

  return (
    <div style={{ padding: 24 }}>
      <h1>MeetAI</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button onClick={createMeeting}>Crear reunión</button>

      {meetingId && (
        <div style={{ margin: '12px 0' }}>
          <p>Link para invitar a la reunión:</p>
          <input readOnly value={inviteLinkFor(meetingId)} style={{ width: '100%' }} onFocus={(e) => e.target.select()} />
          <button
            onClick={() => {
              navigator.clipboard.writeText(inviteLinkFor(meetingId))
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? 'Copiado' : 'Copiar link'}
          </button>
        </div>
      )}

      <input placeholder="ID de la reunión" value={meetingId} onChange={(e) => setMeetingId(e.target.value)} />
      <input placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={join} disabled={!meetingId || !name}>Unirse</button>

      {reviewLink && (
        <p>
          Cuando termine la reunión, el resumen de IA va a estar disponible en:{' '}
          <a href={reviewLink}>{reviewLink}</a>
        </p>
      )}
    </div>
  )
}

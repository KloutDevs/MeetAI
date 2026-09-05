import { useState } from 'react'
import type { MeetingData } from '../MeetingReview.js'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Esperando a Deepgram',
  completed: 'Transcripción lista',
  failed: 'Deepgram falló',
  timeout: 'Sin respuesta (timeout)'
}

const SUMMARY_STATUS_LABEL: Record<string, string> = {
  pending: 'Generando resumen con IA...',
  completed: 'Resumen generado',
  failed: 'La IA no pudo generar el resumen'
}

export function PipelineTab({
  data,
  backendUrl,
  meetingId,
  onChanged
}: {
  data: MeetingData
  backendUrl: string
  meetingId: string
  onChanged: () => void
}) {
  const nameById = new Map(data.participants.map((p) => [p.id, p.name]))
  const allJobsTerminal = data.transcriptionJobs.every((job) => job.status !== 'pending')
  const [retrying, setRetrying] = useState(false)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [retryFailures, setRetryFailures] = useState<Array<{ participantId: string; error: string }>>([])

  async function retryTranscription() {
    setRetrying(true)
    setRetryMessage(null)
    setRetryFailures([])
    try {
      const response = await fetch(`${backendUrl}/meetings/${meetingId}/retry-transcription`, { method: 'POST' })
      if (!response.ok) {
        setRetryMessage(`No se pudo reenviar (status ${response.status})`)
        return
      }
      const { retried, failed } = await response.json() as {
        retried: string[]
        failed: Array<{ participantId: string; error: string }>
      }
      if (retried.length === 0 && failed.length === 0) {
        setRetryMessage('No había nada pendiente de reenviar.')
      } else {
        setRetryMessage(`Reenviadas ${retried.length} pista(s) a Deepgram.${failed.length > 0 ? ` ${failed.length} fallaron.` : ''}`)
      }
      setRetryFailures(failed)
      onChanged()
    } catch {
      setRetryMessage('No se pudo conectar con el servidor para reenviar.')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div>
      <h2>Transcripción por pista (Deepgram)</h2>
      {data.transcriptionJobs.length === 0 && <p>Todavía no se despachó ninguna pista a Deepgram.</p>}
      <button onClick={retryTranscription} disabled={retrying}>
        {retrying ? 'Reenviando...' : 'Reenviar audio a Deepgram'}
      </button>
      {retryMessage && <p>{retryMessage}</p>}
      {retryFailures.length > 0 && (
        <ul style={{ color: '#b00' }}>
          {retryFailures.map((f) => (
            <li key={f.participantId}>{nameById.get(f.participantId) ?? f.participantId}: {f.error}</li>
          ))}
        </ul>
      )}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Participante</th>
            <th style={{ textAlign: 'left' }}>Enviado a Deepgram</th>
            <th style={{ textAlign: 'left' }}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {data.transcriptionJobs.map((job) => (
            <tr key={job.trackId}>
              <td>{nameById.get(job.participantId) ?? job.participantId}</td>
              <td>{new Date(job.dispatchedAt).toLocaleString()}</td>
              <td>{STATUS_LABEL[job.status] ?? job.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Procesamiento de IA (DeepSeek)</h2>
      {!allJobsTerminal && <p>Todavía faltan pistas por transcribir — la IA arranca recién cuando todas terminan.</p>}
      {allJobsTerminal && !data.summary && <p>Todas las pistas terminaron, esperando a que la IA arranque a procesar.</p>}
      {data.summary && <p>{SUMMARY_STATUS_LABEL[data.summary.status] ?? data.summary.status}</p>}

      {data.summary?.status === 'completed' && (
        <div>
          <p>La IA devolvió:</p>
          <ul>
            <li>Contexto: {data.summary.context ? 'sí' : 'vacío'}</li>
            <li>Puntos clave: {data.summary.keyPoints ? 'sí' : 'vacío'}</li>
            <li>Capítulos: {data.chapters.length}</li>
            <li>Highlights: {data.highlights.length}</li>
            <li>Tareas propuestas: {data.proposedTasks.length}</li>
          </ul>
        </div>
      )}

      <p style={{ color: '#888' }}>Esta pestaña se actualiza sola cada 5 segundos.</p>
    </div>
  )
}

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

  const [summaryRetrying, setSummaryRetrying] = useState(false)
  const [summaryRetryMessage, setSummaryRetryMessage] = useState<string | null>(null)

  async function retryTranscription(force: boolean) {
    setRetrying(true)
    setRetryMessage(null)
    setRetryFailures([])
    try {
      const response = await fetch(`${backendUrl}/meetings/${meetingId}/retry-transcription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      })
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

  async function retrySummary() {
    setSummaryRetrying(true)
    setSummaryRetryMessage(null)
    try {
      const response = await fetch(`${backendUrl}/meetings/${meetingId}/retry-summary`, { method: 'POST' })
      if (response.status === 400) {
        const body = await response.json() as { message?: string }
        setSummaryRetryMessage(body.message ?? 'Todavía no hay transcripción disponible.')
        return
      }
      if (!response.ok) {
        setSummaryRetryMessage(`No se pudo reenviar (status ${response.status})`)
        return
      }
      const { status } = await response.json() as { status: string }
      setSummaryRetryMessage(status === 'completed' ? 'Resumen generado con éxito.' : 'La IA no pudo generar el resumen (revisá los logs del backend).')
      onChanged()
    } catch {
      setSummaryRetryMessage('No se pudo conectar con el servidor para reenviar.')
    } finally {
      setSummaryRetrying(false)
    }
  }

  return (
    <div>
      <h2 className="section-title">Procesamiento</h2>
      <p className="section-lead">Estado técnico de la transcripción y el análisis de la reunión.</p>
      {data.transcriptionJobs.length === 0 && <div className="empty-state">Todavía no se despachó ninguna pista a Deepgram.</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="secondary-button" onClick={() => retryTranscription(false)} disabled={retrying}>
          {retrying ? 'Reenviando...' : 'Reenviar pendientes/vacíos a Deepgram'}
        </button>
        <button className="secondary-button" onClick={() => retryTranscription(true)} disabled={retrying}>
          {retrying ? 'Reenviando...' : 'Forzar reenvío completo (borra y vuelve a transcribir todo)'}
        </button>
      </div>
      {retryMessage && <p>{retryMessage}</p>}
      {retryFailures.length > 0 && (
        <ul className="error-text">
          {retryFailures.map((f) => (
            <li key={f.participantId}>{nameById.get(f.participantId) ?? f.participantId}: {f.error}</li>
          ))}
        </ul>
      )}
      <div className="pipeline-grid" style={{ marginTop: 18 }}>
          {data.transcriptionJobs.map((job) => (
            <article className="pipeline-step" key={job.trackId}>
              <span className="status-pill">{STATUS_LABEL[job.status] ?? job.status}</span>
              <h3 className="list-card-title" style={{ marginTop: 12 }}>{nameById.get(job.participantId) ?? job.participantId}</h3>
              <p>{new Date(job.dispatchedAt).toLocaleString()}</p>
            </article>
          ))}
      </div>

      <h2 className="subheading">Procesamiento de IA</h2>
      {!allJobsTerminal && <p>Todavía faltan pistas por transcribir — la IA arranca recién cuando todas terminan.</p>}
      {allJobsTerminal && !data.summary && <p>Todas las pistas terminaron, esperando a que la IA arranque a procesar.</p>}
      {data.summary && <p>{SUMMARY_STATUS_LABEL[data.summary.status] ?? data.summary.status}</p>}

      {allJobsTerminal && (
        <>
          <button className="secondary-button" onClick={retrySummary} disabled={summaryRetrying}>
            {summaryRetrying ? 'Reenviando...' : 'Reenviar a Groq'}
          </button>
          {summaryRetryMessage && <p>{summaryRetryMessage}</p>}
        </>
      )}

      {data.summary?.status === 'completed' && (
        <div className="metrics">
          <div className="metric"><span className="metric-value">{data.chapters.length}</span><span className="metric-label">Capítulos</span></div>
          <div className="metric"><span className="metric-value">{data.highlights.length}</span><span className="metric-label">Highlights</span></div>
          <div className="metric"><span className="metric-value">{data.proposedTasks.length}</span><span className="metric-label">Tareas</span></div>
        </div>
      )}

      <p className="list-card-meta">Esta vista se actualiza automáticamente cada 5 segundos.</p>
    </div>
  )
}

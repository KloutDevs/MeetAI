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

export function PipelineTab({ data }: { data: MeetingData }) {
  const nameById = new Map(data.participants.map((p) => [p.id, p.name]))
  const allJobsTerminal = data.transcriptionJobs.every((job) => job.status !== 'pending')

  return (
    <div>
      <h2>Transcripción por pista (Deepgram)</h2>
      {data.transcriptionJobs.length === 0 && <p>Todavía no se despachó ninguna pista a Deepgram.</p>}
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

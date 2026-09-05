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

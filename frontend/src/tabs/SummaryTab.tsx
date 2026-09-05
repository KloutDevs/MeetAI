import type { MeetingData } from '../MeetingReview.js'

export function SummaryTab({ data }: { data: MeetingData }) {
  if (!data.summary) return <div className="empty-state">El resumen se está preparando. Volvé en unos minutos.</div>
  if (data.summary.status === 'failed') return <div className="empty-state">No se pudo generar el resumen de esta reunión.</div>

  return (
    <div>
      <h2 className="section-title">Contexto</h2>
      <p className="body-copy">{data.summary.context}</p>
      <div className="ai-callout"><span className="ai-sparkle">✦</span><span>{shorten(data.summary.context, 180)}</span></div>
      <h2 className="subheading">Lo más importante</h2>
      <p className="body-copy">{data.summary.keyPoints}</p>
      <div className="ai-callout"><span className="ai-sparkle">✦</span><span>{shorten(data.summary.keyPoints, 180)}</span></div>
    </div>
  )
}

function shorten(value: string | null, limit: number): string {
  if (!value) return 'No hay contenido suficiente para destacar.'
  const sentence = value.split(/(?<=[.!?])\s/)[0]
  return sentence.length <= limit ? sentence : `${sentence.slice(0, limit).trim()}…`
}

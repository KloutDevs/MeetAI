// frontend/src/tabs/InsightsTab.tsx
import type { MeetingData } from '../MeetingReview.js'
import { formatTime, speakerColor } from '../meetingUi.js'

export function InsightsTab({ data }: { data: MeetingData }) {
  const totalDuration = data.transcriptSegments.reduce((max, s) => Math.max(max, s.end), 0)

  const timeBySpeaker = new Map<string, number>()
  for (const segment of data.transcriptSegments) {
    timeBySpeaker.set(segment.speakerId, (timeBySpeaker.get(segment.speakerId) ?? 0) + (segment.end - segment.start))
  }

  const nameById = new Map(data.participants.map((p) => [p.id, p.name]))

  return (
    <div>
      <h2 className="section-title">Insights</h2>
      <p className="section-lead">Una lectura rápida de la dinámica de la conversación.</p>
      <div className="metrics">
        <div className="metric"><span className="metric-value">{formatTime(totalDuration)}</span><span className="metric-label">Duración hablada</span></div>
        <div className="metric"><span className="metric-value">{data.participants.length}</span><span className="metric-label">Participantes</span></div>
        <div className="metric"><span className="metric-value">{data.highlights.length}</span><span className="metric-label">Highlights</span></div>
      </div>
      <h3 className="subheading">Participación</h3>
      <div className="stack-list">
        {Array.from(timeBySpeaker.entries()).map(([speakerId, seconds]) => (
          <div className="speaker-card" key={speakerId}>
            <div className="speaker-head"><span>{nameById.get(speakerId) ?? speakerId}</span><span className="speaker-percent">{Math.floor(seconds)}s · {totalDuration > 0 ? Math.round((seconds / totalDuration) * 100) : 0}%</span></div>
            <div className="speaker-bar" style={{ marginTop: 10 }}><span className="speaker-segment" style={{ left: 0, width: `${totalDuration > 0 ? (seconds / totalDuration) * 100 : 0}%`, background: speakerColor(speakerId) }} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

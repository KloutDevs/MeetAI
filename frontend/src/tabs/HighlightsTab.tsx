import type { MeetingData } from '../MeetingReview.js'
import { formatTime } from '../meetingUi.js'

export function HighlightsTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  if (data.highlights.length === 0) return <div className="empty-state">Todavía no se detectaron momentos destacados.</div>

  return (
    <div className="stack-list">
      {data.highlights.map((highlight, i) => (
        <article className="list-card" key={i}>
          <div className="list-card-header">
            <div className="list-card-copy"><p className="list-card-title">{highlight.type}</p></div>
            <button className="timestamp" onClick={() => onSeek(highlight.timestamp)}>{formatTime(highlight.timestamp)}</button>
          </div>
          <p className="quote">“{highlight.quote}”</p>
        </article>
      ))}
    </div>
  )
}

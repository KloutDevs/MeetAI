import type { MeetingData } from '../MeetingReview.js'
import { formatTime } from '../meetingUi.js'

export function ChaptersTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  if (data.chapters.length === 0) return <div className="empty-state">Todavía no se generaron capítulos.</div>

  return (
    <div className="stack-list">
      {data.chapters.map((chapter, i) => (
        <article className="list-card" key={i}>
          <div className="list-card-header">
            <button className="seek-button" onClick={() => onSeek(chapter.start)} aria-label={`Reproducir ${chapter.title}`}>▷</button>
            <div className="list-card-copy"><p className="list-card-title">{chapter.title}</p><p className="list-card-meta">{formatTime(chapter.start)} — {formatTime(chapter.end)}</p></div>
          </div>
        </article>
      ))}
    </div>
  )
}

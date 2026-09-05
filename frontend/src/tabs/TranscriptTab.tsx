import type { MeetingData } from '../MeetingReview.js'
import { formatTime, speakerColor } from '../meetingUi.js'

export function TranscriptTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  const nameById = new Map(data.participants.map((p) => [p.id, p.name]))

  return (
    <div>
      <h2 className="section-title">Transcripción</h2>
      <p className="section-lead">{data.transcriptSegments.length} intervenciones sincronizadas con la grabación.</p>
      {data.transcriptSegments
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((segment, i) => (
          <article className="transcript-card" key={i}>
            <button className="timestamp" onClick={() => onSeek(segment.start)}>{formatTime(segment.start)}</button>
            <div><span className="speaker-label" style={{ color: speakerColor(segment.speakerId) }}>{nameById.get(segment.speakerId) ?? segment.speakerId}</span><p className="transcript-text">{segment.text}</p></div>
          </article>
        ))}
    </div>
  )
}

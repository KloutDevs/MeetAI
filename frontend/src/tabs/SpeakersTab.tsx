import type { MeetingData } from '../MeetingReview.js'
import { speakerColor } from '../meetingUi.js'

export function SpeakersTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  const totalDuration = data.transcriptSegments.reduce((max, s) => Math.max(max, s.end), 0)

  const timeBySpeaker = new Map<string, number>()
  for (const segment of data.transcriptSegments) {
    timeBySpeaker.set(segment.speakerId, (timeBySpeaker.get(segment.speakerId) ?? 0) + (segment.end - segment.start))
  }

  return (
    <div className="stack-list">
      {data.participants.map((participant) => {
        const spokenSeconds = timeBySpeaker.get(participant.id) ?? 0
        const percentage = totalDuration > 0 ? Math.round((spokenSeconds / totalDuration) * 100) : 0
        const segments = data.transcriptSegments.filter((s) => s.speakerId === participant.id)

        return (
          <div key={participant.id} className="speaker-card">
            <div className="speaker-head"><span>{participant.name}</span><span className="speaker-percent">{percentage}%</span></div>
            <div className="speaker-track-row">
              <button className="seek-button" onClick={() => onSeek(segments[0]?.start ?? 0)} aria-label={`Reproducir intervenciones de ${participant.name}`}>▷</button>
              <div className="speaker-bar">
                {segments.map((segment, i) => (
                  <button
                    key={i}
                    className="speaker-segment"
                    onClick={() => onSeek(segment.start)}
                    aria-label={`Ir a ${Math.floor(segment.start)} segundos`}
                    style={{
                      left: `${totalDuration ? (segment.start / totalDuration) * 100 : 0}%`,
                      width: `${totalDuration ? Math.max(1, ((segment.end - segment.start) / totalDuration) * 100) : 0}%`,
                      background: speakerColor(participant.id),
                      border: 0
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

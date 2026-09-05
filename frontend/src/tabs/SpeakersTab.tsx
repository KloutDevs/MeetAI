import type { MeetingData } from '../MeetingReview.js'

export function SpeakersTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  const totalDuration = data.transcriptSegments.reduce((max, s) => Math.max(max, s.end), 0)

  const timeBySpeaker = new Map<string, number>()
  for (const segment of data.transcriptSegments) {
    timeBySpeaker.set(segment.speakerId, (timeBySpeaker.get(segment.speakerId) ?? 0) + (segment.end - segment.start))
  }

  return (
    <div>
      {data.participants.map((participant) => {
        const spokenSeconds = timeBySpeaker.get(participant.id) ?? 0
        const percentage = totalDuration > 0 ? Math.round((spokenSeconds / totalDuration) * 100) : 0
        const segments = data.transcriptSegments.filter((s) => s.speakerId === participant.id)

        return (
          <div key={participant.id} style={{ marginBottom: 16 }}>
            <strong>{participant.name}</strong> — {percentage}% del tiempo hablado
            <div>
              {segments.map((segment, i) => (
                <button key={i} onClick={() => onSeek(segment.start)} style={{ marginRight: 4 }}>
                  ▶ {Math.floor(segment.start)}s
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

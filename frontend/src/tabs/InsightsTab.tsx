// frontend/src/tabs/InsightsTab.tsx
import type { MeetingData } from '../MeetingReview.js'

export function InsightsTab({ data }: { data: MeetingData }) {
  const totalDuration = data.transcriptSegments.reduce((max, s) => Math.max(max, s.end), 0)

  const timeBySpeaker = new Map<string, number>()
  for (const segment of data.transcriptSegments) {
    timeBySpeaker.set(segment.speakerId, (timeBySpeaker.get(segment.speakerId) ?? 0) + (segment.end - segment.start))
  }

  const nameById = new Map(data.participants.map((p) => [p.id, p.name]))

  return (
    <div>
      <p>Duración total: {Math.floor(totalDuration)}s</p>
      <h3>Participación</h3>
      <ul>
        {Array.from(timeBySpeaker.entries()).map(([speakerId, seconds]) => (
          <li key={speakerId}>
            {nameById.get(speakerId) ?? speakerId}: {Math.floor(seconds)}s ({totalDuration > 0 ? Math.round((seconds / totalDuration) * 100) : 0}%)
          </li>
        ))}
      </ul>
    </div>
  )
}

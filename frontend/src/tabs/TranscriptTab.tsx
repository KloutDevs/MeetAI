import type { MeetingData } from '../MeetingReview.js'

export function TranscriptTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  const nameById = new Map(data.participants.map((p) => [p.id, p.name]))

  return (
    <div>
      {data.transcriptSegments
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((segment, i) => (
          <p key={i}>
            <button onClick={() => onSeek(segment.start)}>{Math.floor(segment.start)}s</button>{' '}
            <strong>{nameById.get(segment.speakerId) ?? segment.speakerId}:</strong> {segment.text}
          </p>
        ))}
    </div>
  )
}

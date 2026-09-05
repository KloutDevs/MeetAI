import type { MeetingData } from '../MeetingReview.js'

export function HighlightsTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  if (data.highlights.length === 0) return <p>Sin highlights detectados.</p>

  return (
    <ul>
      {data.highlights.map((highlight, i) => (
        <li key={i}>
          <button onClick={() => onSeek(highlight.timestamp)}>{Math.floor(highlight.timestamp)}s</button>{' '}
          <em>[{highlight.type}]</em> "{highlight.quote}"
        </li>
      ))}
    </ul>
  )
}

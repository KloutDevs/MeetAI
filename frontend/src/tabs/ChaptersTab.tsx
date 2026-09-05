import type { MeetingData } from '../MeetingReview.js'

export function ChaptersTab({ data, onSeek }: { data: MeetingData; onSeek: (timestamp: number) => void }) {
  if (data.chapters.length === 0) return <p>Sin capítulos generados.</p>

  return (
    <ul>
      {data.chapters.map((chapter, i) => (
        <li key={i}>
          <button onClick={() => onSeek(chapter.start)}>{chapter.title}</button>{' '}
          ({Math.floor(chapter.start)}s – {Math.floor(chapter.end)}s)
        </li>
      ))}
    </ul>
  )
}

import { useEffect, useRef, useState } from 'react'
import { SpeakersTab } from './tabs/SpeakersTab.js'
import { TranscriptTab } from './tabs/TranscriptTab.js'
import { ChaptersTab } from './tabs/ChaptersTab.js'
import { HighlightsTab } from './tabs/HighlightsTab.js'
import { SummaryTab } from './tabs/SummaryTab.js'
import { ApprovalsTab } from './tabs/ApprovalsTab.js'
import { InsightsTab } from './tabs/InsightsTab.js'
import { PipelineTab } from './tabs/PipelineTab.js'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

export interface MeetingData {
  meeting: { id: string; title: string }
  participants: Array<{ id: string; name: string }>
  tracks: Array<{ participantId: string; url: string }>
  transcriptSegments: Array<{ speakerId: string; start: number; end: number; text: string }>
  chapters: Array<{ title: string; start: number; end: number }>
  highlights: Array<{ type: string; timestamp: number; quote: string }>
  summary: { context: string; keyPoints: string; status: string } | null
  transcriptionJobs: Array<{
    trackId: string
    participantId: string
    status: string
    dispatchedAt: string
  }>
  proposedTasks: Array<{
    id: string
    description: string
    status: string
    assignee: string | null
    sourceSpeakerId: string | null
    sourceTimestamp: number | null
    sourceQuote: string | null
  }>
}

const TABS = ['Pipeline', 'Speakers', 'Chapters', 'Highlights', 'Summary', 'Transcript', 'Approvals', 'Insights'] as const
type Tab = typeof TABS[number]

export function MeetingReview({ meetingId }: { meetingId: string }) {
  const [data, setData] = useState<MeetingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('Pipeline')
  const audioRef = useRef<HTMLAudioElement>(null)

  function loadData() {
    fetch(`${BACKEND_URL}/meetings/${meetingId}/full`)
      .then((response) => {
        if (!response.ok) throw new Error(`Backend returned ${response.status}`)
        return response.json()
      })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [meetingId])

  function seekTo(timestamp: number) {
    if (audioRef.current) {
      audioRef.current.currentTime = timestamp
      audioRef.current.play()
    }
  }

  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>
  if (!data) return <p>Cargando...</p>

  const firstTrack = data.tracks[0]

  return (
    <div style={{ padding: 24 }}>
      <h1>{data.meeting.title}</h1>

      {firstTrack && (
        <audio ref={audioRef} controls src={firstTrack.url} style={{ width: '100%' }} />
      )}

      <nav style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        {TABS.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} disabled={activeTab === tab}>
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === 'Pipeline' && <PipelineTab data={data} backendUrl={BACKEND_URL} meetingId={meetingId} onChanged={loadData} />}
      {activeTab === 'Speakers' && <SpeakersTab data={data} onSeek={seekTo} />}
      {activeTab === 'Chapters' && <ChaptersTab data={data} onSeek={seekTo} />}
      {activeTab === 'Highlights' && <HighlightsTab data={data} onSeek={seekTo} />}
      {activeTab === 'Summary' && <SummaryTab data={data} />}
      {activeTab === 'Transcript' && <TranscriptTab data={data} onSeek={seekTo} />}
      {activeTab === 'Approvals' && <ApprovalsTab data={data} backendUrl={BACKEND_URL} onChanged={loadData} />}
      {activeTab === 'Insights' && <InsightsTab data={data} />}
    </div>
  )
}

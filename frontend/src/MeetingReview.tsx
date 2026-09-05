import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode, RefObject } from 'react'
import { SpeakersTab } from './tabs/SpeakersTab.js'
import { TranscriptTab } from './tabs/TranscriptTab.js'
import { ChaptersTab } from './tabs/ChaptersTab.js'
import { HighlightsTab } from './tabs/HighlightsTab.js'
import { SummaryTab } from './tabs/SummaryTab.js'
import { ApprovalsTab } from './tabs/ApprovalsTab.js'
import { InsightsTab } from './tabs/InsightsTab.js'
import { PipelineTab } from './tabs/PipelineTab.js'
import { formatTime, initials, speakerColor } from './meetingUi.js'
import './meeting-review.css'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

export interface MeetingData {
  meeting: { id: string; title: string; startedAt: string; endedAt: string | null; recordingUrl: string | null }
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

const RAIL_TABS = ['Chapters', 'Highlights', 'Speakers'] as const
const CONTENT_TABS = ['Summary', 'Approvals', 'Notas', 'Transcript', 'Insights', 'Pipeline'] as const
type RailTab = typeof RAIL_TABS[number]
type ContentTab = typeof CONTENT_TABS[number]

function Icon({ name }: { name: 'play' | 'pause' | 'back' | 'forward' | 'volume' | 'expand' | 'more' | 'folder' | 'copy' | 'share' | 'sparkle' | 'chevron' }) {
  const paths: Record<typeof name, ReactNode> = {
    play: <path d="m9 7 8 5-8 5Z" />,
    pause: <><path d="M9 7v10M15 7v10" /></>,
    back: <><path d="m11 8-5 4 5 4Z" /><path d="M17 7v10" /></>,
    forward: <><path d="m13 8 5 4-5 4Z" /><path d="M7 7v10" /></>,
    volume: <><path d="M6 10v4h3l4 3V7l-4 3Z" /><path d="M16 9a4 4 0 0 1 0 6" /></>,
    expand: <><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" /></>,
    more: <><circle cx="12" cy="6" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="18" r="1" fill="currentColor" /></>,
    folder: <path d="M4 7h6l2 2h8v9H4Z" />,
    copy: <><rect x="8" y="8" width="10" height="11" rx="2" /><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></>,
    share: <><path d="M12 16V4m0 0L8 8m4-4 4 4" /><path d="M5 13v6h14v-6" /></>,
    sparkle: <path d="m12 3 1.2 4.2L17 9l-3.8 1.8L12 15l-1.2-4.2L7 9l3.8-1.8ZM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" />,
    chevron: <path d="m9 7 5 5-5 5" />
  }
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export function MeetingReview({ meetingId }: { meetingId: string }) {
  const [data, setData] = useState<MeetingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [railTab, setRailTab] = useState<RailTab>('Highlights')
  const [activeTab, setActiveTab] = useState<ContentTab>('Summary')
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null)

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
    if (mediaRef.current) {
      mediaRef.current.currentTime = timestamp
      void mediaRef.current.play()
    }
  }

  const markers = useMemo(() => {
    const segments = data?.transcriptSegments ?? []
    return segments
      .slice()
      .sort((a, b) => a.start - b.start)
      .filter((segment, index, all) => index === 0 || all[index - 1].speakerId !== segment.speakerId)
  }, [data?.transcriptSegments])

  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>
  if (!data) return <p>Cargando...</p>

  const firstTrack = data.tracks.find((track) => track.url)
  const mediaUrl = data.meeting.recordingUrl ?? firstTrack?.url ?? null
  const totalDuration = duration || data.transcriptSegments.reduce((max, segment) => Math.max(max, segment.end), 0)
  const visibleQuote = data.highlights.find((highlight) => Math.abs(highlight.timestamp - currentTime) <= 5)
    ?? data.transcriptSegments.find((segment) => currentTime >= segment.start && currentTime <= segment.end && segment.text.length > 55)
  const meetingDate = new Date(data.meeting.startedAt)

  function togglePlayback() {
    const media = mediaRef.current
    if (!media) return
    if (media.paused) void media.play()
    else media.pause()
  }

  function seekFromPointer(event: MouseEvent<HTMLDivElement>) {
    if (!mediaRef.current || totalDuration <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    seekTo(((event.clientX - rect.left) / rect.width) * totalDuration)
  }

  function updateSelectionToolbar() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setToolbar(null)
      return
    }
    const range = selection.getRangeAt(0)
    const container = document.querySelector('.tab-content')
    if (!container?.contains(range.commonAncestorContainer)) return
    const rect = range.getBoundingClientRect()
    setToolbar({ x: rect.left + rect.width / 2, y: rect.top })
  }

  return (
    <div className="meeting-review">
      <div className="topbar"><div className="breadcrumbs"><span>Team</span><Icon name="chevron" /><span>Groups</span><Icon name="chevron" /><strong>UX/UI Design</strong></div></div>
      <div className="review-grid">
        <aside className="media-panel">
          <div className="media-stage" ref={stageRef}>
            {mediaUrl && data.meeting.recordingUrl ? (
              <video ref={mediaRef as RefObject<HTMLVideoElement>} src={mediaUrl} playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} />
            ) : mediaUrl ? (
              <><div className="audio-fallback"><div><span className="audio-fallback-mark">M</span>Esta reunión solo tiene audio</div></div><audio ref={mediaRef as RefObject<HTMLAudioElement>} src={mediaUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} /></>
            ) : <div className="audio-fallback">La grabación estará disponible cuando finalice el procesamiento.</div>}
            <div className="media-gradient" />
            {visibleQuote && <div className="quote-bubble">{'quote' in visibleQuote ? visibleQuote.quote : visibleQuote.text}</div>}
            <div className="player-controls">
              <div className="timeline" onClick={seekFromPointer} aria-label="Línea de tiempo">
                <div className="timeline-track" />
                <div className="timeline-fill" style={{ width: `${totalDuration ? (currentTime / totalDuration) * 100 : 0}%` }} />
                {markers.map((segment, index) => <span key={`${segment.start}-${index}`} className="speaker-dot" title={data.participants.find((p) => p.id === segment.speakerId)?.name} style={{ left: `${totalDuration ? (segment.start / totalDuration) * 100 : 0}%`, background: speakerColor(segment.speakerId) }} />)}
              </div>
              <div className="control-row">
                <button className="icon-button" onClick={() => seekTo(Math.max(0, currentTime - 10))} aria-label="Retroceder 10 segundos"><Icon name="back" /></button>
                <button className="icon-button" onClick={togglePlayback} aria-label={playing ? 'Pausar' : 'Reproducir'}><Icon name={playing ? 'pause' : 'play'} /></button>
                <button className="icon-button" onClick={() => seekTo(Math.min(totalDuration, currentTime + 10))} aria-label="Avanzar 10 segundos"><Icon name="forward" /></button>
                <span className="player-time">{formatTime(currentTime)} / {formatTime(totalDuration)}</span>
                <Icon name="volume" /><input className="volume" aria-label="Volumen" type="range" min="0" max="1" step=".05" value={volume} onChange={(event) => { const value = Number(event.target.value); setVolume(value); if (mediaRef.current) mediaRef.current.volume = value }} />
                <button className="icon-button" onClick={() => void stageRef.current?.requestFullscreen()} aria-label="Pantalla completa"><Icon name="expand" /></button>
                <button className="icon-button" aria-label="Más opciones"><Icon name="more" /></button>
              </div>
            </div>
          </div>
          <nav className="rail-tabs" aria-label="Explorar grabación">{RAIL_TABS.map((tab) => <button key={tab} className={`tab-button ${railTab === tab ? 'active' : ''}`} onClick={() => setRailTab(tab)}>{tab}</button>)}</nav>
          <div className="rail-content">
            {railTab === 'Speakers' && <SpeakersTab data={data} onSeek={seekTo} />}
            {railTab === 'Chapters' && <ChaptersTab data={data} onSeek={seekTo} />}
            {railTab === 'Highlights' && <HighlightsTab data={data} onSeek={seekTo} />}
          </div>
        </aside>

        <main className="main-column">
          <header className="meeting-header">
            <div className="header-row">
              <div>
                <p className="eyebrow">Memoria de reunión</p>
                <h1 className="meeting-title">{data.meeting.title}</h1>
                <div className="meeting-meta">
                  <div className="avatars">{data.participants.slice(0, 5).map((participant) => <span className="avatar" key={participant.id} title={participant.name} style={{ background: speakerColor(participant.id) }}>{initials(participant.name)}</span>)}</div>
                  {data.participants.length > 5 && <span>+{data.participants.length - 5}</span>}
                  <span className="meta-divider" />
                  <span>{meetingDate.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}, {meetingDate.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="meet-badge">▣ Quickaction meet</span>
                </div>
              </div>
              <div className="header-actions">
                <button className="icon-button" aria-label="Archivar"><Icon name="folder" /></button>
                <button className="icon-button" onClick={() => void navigator.clipboard?.writeText(window.location.href)} aria-label="Copiar enlace"><Icon name="copy" /></button>
                <button className="icon-button" aria-label="Compartir"><Icon name="share" /></button>
                <button className="icon-button sparkle" onClick={() => setActiveTab('Summary')} aria-label="Abrir resumen de IA"><Icon name="sparkle" /></button>
              </div>
            </div>
          </header>
          <section className="content-panel">
            <div className="content-nav">
              <nav className="content-tabs" aria-label="Contenido de la reunión">{CONTENT_TABS.map((tab) => <button key={tab} className={`tab-button ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>
              <button className="enhanced-button" onClick={() => setActiveTab('Summary')}>✦ Enhanced notes</button>
            </div>
            <div className="tab-content" onMouseUp={updateSelectionToolbar}>
              {activeTab === 'Summary' && <SummaryTab data={data} />}
              {activeTab === 'Notas' && <ApprovalsTab data={data} backendUrl={BACKEND_URL} onChanged={loadData} />}
              {activeTab === 'Approvals' && <ApprovalsTab data={data} backendUrl={BACKEND_URL} onChanged={loadData} />}
              {activeTab === 'Transcript' && <TranscriptTab data={data} onSeek={seekTo} />}
              {activeTab === 'Insights' && <InsightsTab data={data} />}
              {activeTab === 'Pipeline' && <PipelineTab data={data} backendUrl={BACKEND_URL} meetingId={meetingId} onChanged={loadData} />}
            </div>
          </section>
        </main>
      </div>
      {toolbar && <div className="floating-toolbar" style={{ left: toolbar.x, top: toolbar.y }}>
        <button className="icon-button ai-tool" aria-label="Mejorar con IA">✦</button><button className="icon-button" aria-label="Comentar">◇</button><button className="icon-button" aria-label="Editar">⌁</button><button className="icon-button" aria-label="Título 1">H₁</button><button className="icon-button" aria-label="Negrita"><strong>B</strong></button>
      </div>}
    </div>
  )
}

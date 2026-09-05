const SPEAKER_COLORS = ['#f4a85f', '#65bde4', '#ee8888', '#9b8be8', '#8ccc64', '#e8c451', '#55b9a8']

export function speakerColor(participantId: string): string {
  let hash = 0
  for (let i = 0; i < participantId.length; i += 1) {
    hash = ((hash << 5) - hash + participantId.charCodeAt(i)) | 0
  }
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length]
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

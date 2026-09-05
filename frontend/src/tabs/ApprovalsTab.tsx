// frontend/src/tabs/ApprovalsTab.tsx
import { useState } from 'react'
import type { MeetingData } from '../MeetingReview.js'

export function ApprovalsTab({
  data,
  backendUrl,
  onChanged
}: {
  data: MeetingData
  backendUrl: string
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const pending = data.proposedTasks.filter((t) => t.status === 'pendiente')

  async function approve(id: string) {
    setError(null)
    const response = await fetch(`${backendUrl}/proposed-tasks/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!response.ok) {
      setError(`No se pudo aprobar la tarea (${response.status})`)
      return
    }
    onChanged()
  }

  async function reject(id: string) {
    setError(null)
    const response = await fetch(`${backendUrl}/proposed-tasks/${id}/reject`, { method: 'POST' })
    if (!response.ok) {
      setError(`No se pudo rechazar la tarea (${response.status})`)
      return
    }
    onChanged()
  }

  if (pending.length === 0) return <p>No hay tareas pendientes de aprobación.</p>

  return (
    <div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {pending.map((task) => (
        <div key={task.id} style={{ marginBottom: 12, border: '1px solid #ccc', padding: 8 }}>
          <p>{task.description}</p>
          {task.sourceQuote && <p><em>"{task.sourceQuote}"</em></p>}
          <button onClick={() => approve(task.id)}>Aprobar</button>
          <button onClick={() => reject(task.id)}>Rechazar</button>
        </div>
      ))}
    </div>
  )
}

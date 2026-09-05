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

  if (pending.length === 0) return <div className="empty-state">No hay tareas pendientes de aprobación.</div>

  return (
    <div>
      <h2 className="section-title">Tareas propuestas</h2>
      <p className="section-lead">Revisá las acciones detectadas por IA antes de agregarlas al flujo de trabajo.</p>
      {error && <p className="error-text">{error}</p>}
      <div className="stack-list">
      {pending.map((task) => (
        <article key={task.id} className="list-card">
          <div className="list-card-header"><span className="status-pill">Pendiente</span>{task.assignee && <span className="list-card-meta">{task.assignee}</span>}</div>
          <p className="list-card-title" style={{ marginTop: 12 }}>{task.description}</p>
          {task.sourceQuote && <p className="quote">“{task.sourceQuote}”</p>}
          <div className="actions"><button className="primary-button" onClick={() => approve(task.id)}>Aprobar tarea</button><button className="danger-button" onClick={() => reject(task.id)}>Rechazar</button></div>
        </article>
      ))}
      </div>
    </div>
  )
}

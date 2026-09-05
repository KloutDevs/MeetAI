// backend/test/proposedTasks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirstMock = vi.fn()
const insertValuesMock = vi.fn(() => ({ returning: () => Promise.resolve([{ id: 'task-1' }]) }))
const updateSetMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { proposedTasks: { findFirst: findFirstMock } },
    insert: () => ({ values: insertValuesMock }),
    update: () => ({ set: updateSetMock })
  }
}))

const { buildServer } = await import('../src/server.js')

describe('POST /proposed-tasks/:id/approve', () => {
  beforeEach(() => {
    findFirstMock.mockClear()
    insertValuesMock.mockClear()
    updateSetMock.mockClear()
  })

  it('creates a real Task and marks the proposed task as aprobada', async () => {
    findFirstMock.mockResolvedValue({ id: 'pt-1', description: 'Enviar informe', status: 'pendiente' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/proposed-tasks/pt-1/approve',
      payload: { assignee: 'Ada' }
    })

    expect(response.statusCode).toBe(200)
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      proposedTaskId: 'pt-1',
      description: 'Enviar informe',
      assignee: 'Ada'
    }))
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'aprobada' }))
  })

  it('returns 404 when the proposed task does not exist', async () => {
    findFirstMock.mockResolvedValue(undefined)

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/proposed-tasks/missing/approve', payload: {} })

    expect(response.statusCode).toBe(404)
    expect(insertValuesMock).not.toHaveBeenCalled()
  })

  it('returns 409 and does not insert a second Task when already aprobada', async () => {
    findFirstMock.mockResolvedValue({ id: 'pt-1', description: 'Enviar informe', status: 'aprobada' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/proposed-tasks/pt-1/approve',
      payload: { assignee: 'Ada' }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'already_processed', status: 'aprobada' })
    expect(insertValuesMock).not.toHaveBeenCalled()
    expect(updateSetMock).not.toHaveBeenCalled()
  })
})

describe('POST /proposed-tasks/:id/reject', () => {
  beforeEach(() => {
    findFirstMock.mockClear()
    insertValuesMock.mockClear()
    updateSetMock.mockClear()
  })

  it('marks the proposed task as rechazada without creating a Task', async () => {
    findFirstMock.mockResolvedValue({ id: 'pt-1', description: 'Enviar informe', status: 'pendiente' })

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/proposed-tasks/pt-1/reject', payload: {} })

    expect(response.statusCode).toBe(200)
    expect(insertValuesMock).not.toHaveBeenCalled()
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'rechazada' }))
  })

  it('returns 409 and does not change status when already aprobada', async () => {
    findFirstMock.mockResolvedValue({ id: 'pt-1', description: 'Enviar informe', status: 'aprobada' })

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/proposed-tasks/pt-1/reject', payload: {} })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'already_processed', status: 'aprobada' })
    expect(updateSetMock).not.toHaveBeenCalled()
  })
})

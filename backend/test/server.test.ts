import { describe, it, expect } from 'vitest'
import { buildServer } from '../src/server.js'

describe('server', () => {
  it('responds 200 on GET /health', async () => {
    const app = buildServer()
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})

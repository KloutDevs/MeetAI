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

describe('CORS', () => {
  it('responds to a preflight OPTIONS request with Access-Control-Allow-Origin', async () => {
    const app = buildServer()
    await app.ready()
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/rooms',
      headers: {
        origin: 'https://meetai-front-production.up.railway.app',
        'access-control-request-method': 'POST'
      }
    })

    expect(response.headers['access-control-allow-origin']).toBeDefined()
  })
})

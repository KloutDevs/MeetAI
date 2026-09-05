import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

  describe('FRONTEND_ORIGIN sanitization', () => {
    const originalEnv = process.env.FRONTEND_ORIGIN

    beforeEach(() => {
      // Reproduces a real Railway UI gotcha: pasting FRONTEND_ORIGIN="https://foo/"
      // literally into the variable value stores the quotes as part of the string.
      process.env.FRONTEND_ORIGIN = '"https://meetai-front-production.up.railway.app/"'
    })

    afterEach(() => {
      process.env.FRONTEND_ORIGIN = originalEnv
    })

    it('strips surrounding quotes and trailing slash before matching the real Origin header', async () => {
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

      expect(response.headers['access-control-allow-origin']).toBe('https://meetai-front-production.up.railway.app')
    })
  })
})

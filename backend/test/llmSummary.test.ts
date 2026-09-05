import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertValuesMock = vi.fn().mockResolvedValue(undefined)
const dbInsertMock = vi.fn(() => ({ values: insertValuesMock }))
vi.mock('../src/db/client.js', () => ({
  db: { insert: () => dbInsertMock() }
}))

const { generateMeetingSummary } = await import('../src/services/llmSummary.js')

const VALID_RESPONSE = {
  summary: { context: 'Contexto de prueba', keyPoints: 'Puntos clave' },
  chapters: [{ title: 'Intro', start: 0, end: 30 }],
  highlights: [{ type: 'question', timestamp: 12, quote: '¿cuándo entregamos?' }],
  proposedTasks: [{ description: 'Enviar el informe', sourceSpeakerId: 'p1', sourceTimestamp: 45, sourceQuote: 'hay que enviar el informe' }]
}

function llmResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] })
  }
}

function llmErrorResponse(status: number, bodyText: string) {
  return {
    ok: false,
    status,
    text: async () => bodyText
  }
}

describe('generateMeetingSummary', () => {
  beforeEach(() => {
    dbInsertMock.mockClear()
    insertValuesMock.mockClear()
    process.env.GROQ_API_KEY = 'test-key'
  })

  it('parses a valid LLM response and persists summary, chapters, highlights, proposedTasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(llmResponse(JSON.stringify(VALID_RESPONSE)))
    vi.stubGlobal('fetch', fetchMock)

    await generateMeetingSummary('meeting-1', [{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    )
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      meetingId: 'meeting-1',
      context: 'Contexto de prueba',
      status: 'completed'
    }))
  })

  it('retries once with the validation error embedded when the first response is invalid JSON shape, then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(llmResponse('{"not": "the right shape"}'))
      .mockResolvedValueOnce(llmResponse(JSON.stringify(VALID_RESPONSE)))
    vi.stubGlobal('fetch', fetchMock)

    await generateMeetingSummary('meeting-1', [{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCallBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)
    const secondCallPrompt = JSON.stringify(secondCallBody)
    expect(secondCallPrompt).toContain('summary')
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('persists a failed summary after two invalid responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(llmResponse('{"not": "the right shape"}'))
      .mockResolvedValueOnce(llmResponse('{"still": "wrong"}'))
    vi.stubGlobal('fetch', fetchMock)

    await generateMeetingSummary('meeting-1', [{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('logs the real underlying error when persisting a failed summary (e.g. insufficient API balance)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(llmErrorResponse(400, 'Insufficient Balance'))
    vi.stubGlobal('fetch', fetchMock)

    await generateMeetingSummary('meeting-1', [{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('meeting-1'))
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Insufficient Balance'))
    consoleErrorSpy.mockRestore()
  })

  it('retries once when the first response is an HTTP error, then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(llmErrorResponse(401, 'Unauthorized'))
      .mockResolvedValueOnce(llmResponse(JSON.stringify(VALID_RESPONSE)))
    vi.stubGlobal('fetch', fetchMock)

    await generateMeetingSummary('meeting-1', [{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('persists a failed summary after two HTTP errors without throwing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(llmErrorResponse(401, 'Unauthorized'))
      .mockResolvedValueOnce(llmErrorResponse(429, 'Rate limited'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateMeetingSummary('meeting-1', [{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
})

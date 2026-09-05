import { z } from 'zod'
import { db } from '../db/client.js'
import { summaries, chapters, highlights, proposedTasks } from '../db/schema.js'
import { formatTranscriptForPrompt } from './transcriptFormatter.js'
import type { TranscriptSegment } from '../types.js'

const LLMResponseSchema = z.object({
  summary: z.object({ context: z.string(), keyPoints: z.string() }),
  chapters: z.array(z.object({ title: z.string(), start: z.number(), end: z.number() })),
  highlights: z.array(z.object({ type: z.string(), timestamp: z.number(), quote: z.string() })),
  proposedTasks: z.array(z.object({
    description: z.string(),
    sourceSpeakerId: z.string(),
    sourceTimestamp: z.number(),
    sourceQuote: z.string()
  }))
})

type LLMResponse = z.infer<typeof LLMResponseSchema>

function buildPrompt(transcript: string, validationError?: string): string {
  const errorNote = validationError
    ? `\n\nTu respuesta anterior no cumplió el formato esperado: ${validationError}. Corrígela.`
    : ''

  return `Analiza esta transcripción de una reunión y devolvé un JSON con esta forma exacta:
{
  "summary": { "context": string, "keyPoints": string },
  "chapters": [{ "title": string, "start": number, "end": number }],
  "highlights": [{ "type": string, "timestamp": number, "quote": string }],
  "proposedTasks": [{ "description": string, "sourceSpeakerId": string, "sourceTimestamp": number, "sourceQuote": string }]
}

Transcripción:
${transcript}${errorNote}`
}

async function callDeepSeek(prompt: string): Promise<unknown> {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
  })

  const body = await response.json() as { choices: Array<{ message: { content: string } }> }
  return JSON.parse(body.choices[0].message.content)
}

export async function generateMeetingSummary(meetingId: string, segments: TranscriptSegment[]): Promise<void> {
  const transcript = formatTranscriptForPrompt(segments)

  let parsed: LLMResponse | null = null
  let lastError: string | undefined

  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const raw = await callDeepSeek(buildPrompt(transcript, lastError))
    const result = LLMResponseSchema.safeParse(raw)
    if (result.success) {
      parsed = result.data
    } else {
      lastError = result.error.message
    }
  }

  if (!parsed) {
    await db.insert(summaries).values({ meetingId, status: 'failed' })
    return
  }

  await db.insert(summaries).values({
    meetingId,
    context: parsed.summary.context,
    keyPoints: parsed.summary.keyPoints,
    status: 'completed'
  })

  if (parsed.chapters.length > 0) {
    await db.insert(chapters).values(parsed.chapters.map((c) => ({ meetingId, ...c })))
  }

  if (parsed.highlights.length > 0) {
    await db.insert(highlights).values(parsed.highlights.map((h) => ({ meetingId, ...h })))
  }

  if (parsed.proposedTasks.length > 0) {
    await db.insert(proposedTasks).values(parsed.proposedTasks.map((t) => ({ meetingId, ...t })))
  }
}

// backend/test/db.test.ts
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { meetings } from '../src/db/schema.js'

describe('db schema', () => {
  it('inserts and reads back a meeting', async () => {
    const [inserted] = await db.insert(meetings).values({
      title: 'Test meeting',
      startedAt: new Date('2026-01-01T10:00:00Z')
    }).returning()

    const [found] = await db.select().from(meetings).where(eq(meetings.id, inserted.id))

    expect(found.title).toBe('Test meeting')
  })
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://user:pass@localhost:5432/test',
      // EgressClient (unlike WebhookReceiver) validates and parses its host
      // URL eagerly in its constructor, which runs at livekitWebhook.ts
      // module-load time — so any test importing src/server.ts, even ones
      // that never touch the webhook route, needs a well-formed value here.
      LIVEKIT_URL: process.env.LIVEKIT_URL ?? 'wss://localhost:7880',
      LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? 'test-api-key',
      LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? 'test-api-secret'
    }
  }
})

import { createAuth } from '../auth/kb-auth.js';

// The reader is public; the sync API is KB's. Only the gated list needs
// auth, so a new public path needs nothing here — and a new private one must
// be added, which tests/api.test.mjs pins. /api/telemetry stays open: strangers
// POST page views; its GET decides for itself with authenticate() (404, not 401).
export const auth = createAuth({
  kv: 'ANTIFEED_KV',
  app: { name: 'antifeed' },
  gate: [/^\/api\/(flags|inbox|pair)$/],
});

export const onRequest = auth.middleware;

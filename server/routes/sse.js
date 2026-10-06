/**
 * /api/events — Server-Sent Events for real-time sync across devices.
 * When any client saves data, all other connected clients receive a
 * `data-changed` event and can re-fetch the affected key.
 *
 * Frontend usage (in sql-storage.js):
 *   const es = new EventSource('/api/events?token=<jwt>');
 *   es.addEventListener('data-changed', e => { ... });
 */
const express     = require('express');
const jwt         = require('jsonwebtoken');

const router = express.Router();

// Connected clients: Map<userId, Set<res>>
const clients = new Map();

/**
 * Broadcast a change event to all clients EXCEPT the sender.
 * Called by store.js and audit.js after any write.
 */
function broadcastChange(type, payload, senderUserId) {
  const msg = `event: data-changed\ndata: ${JSON.stringify({ type, ...payload, ts: Date.now() })}\n\n`;
  clients.forEach((resSet, userId) => {
    if (userId === senderUserId) return; // don't echo back to sender
    resSet.forEach(res => {
      try { res.write(msg); } catch (_) { /* dead connection */ }
    });
  });
}

// ── GET /api/events?token=<jwt> ───────────────────────────────────────────────
router.get('/', (req, res) => {
  // Auth via query param (EventSource doesn't support custom headers)
  const token = req.query.token;
  if (!token) return res.status(401).end();

  let userId;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    userId = payload.sub;
  } catch {
    return res.status(401).end();
  }

  // Set SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering on Render
  res.flushHeaders();

  // Register client
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);

  // Send heartbeat every 25s to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { cleanup(); }
  }, 25000);

  // Send immediate connected confirmation
  res.write(`event: connected\ndata: {"userId":"${userId}"}\n\n`);

  function cleanup() {
    clearInterval(heartbeat);
    if (clients.has(userId)) {
      clients.get(userId).delete(res);
      if (clients.get(userId).size === 0) clients.delete(userId);
    }
  }

  req.on('close',   cleanup);
  req.on('error',   cleanup);
  res.on('close',   cleanup);
  res.on('finish',  cleanup);
});

module.exports = router;
module.exports.broadcastChange = broadcastChange;

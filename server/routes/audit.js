/**
 * /api/audit — server-side audit log with proper pagination and filtering.
 * Replaces the old dit_activity_log_v1 localStorage blob.
 *
 * POST /api/audit            → append one entry (called by each module)
 * GET  /api/audit            → paginated list (reports page)
 *   ?module=clothing         → filter by module
 *   ?page=0&limit=50         → pagination
 *   ?q=search                → text search across action/detail/user
 */
const express     = require('express');
const { z }       = require('zod');
const AuditLog    = require('../models/AuditLog');
const requireAuth = require('../middleware/auth');
const { broadcastChange } = require('./sse');

const router = express.Router();
router.use(requireAuth);

const entrySchema = z.object({
  module:   z.string().min(1).max(60),
  action:   z.string().min(1).max(200),
  detail:   z.string().max(1000).optional(),
  office:   z.string().max(120).optional(),
  itemName: z.string().max(200).optional(),
  quantity: z.any().optional(),
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return res.status(400).json({ error: msg });
    }
    req.body = result.data;
    next();
  };
}

// ── POST /api/audit ───────────────────────────────────────────────────────────
router.post('/', validate(entrySchema), async (req, res) => {
  try {
    const entry = await AuditLog.create({
      ...req.body,
      user:   req.user.fullName || req.user.username || req.user.email,
      userId: req.user.username || req.user.email,
      date:   new Date(),
    });
    // Notify other connected clients via SSE
    broadcastChange('audit', { module: entry.module });
    res.status(201).json(entry);
  } catch (err) {
    console.error('Audit POST error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/audit ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const page   = Math.max(0, parseInt(req.query.page)  || 0);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const module = req.query.module;
    const q      = req.query.q;

    const filter = {};
    if (module) filter.module = module;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ action: rx }, { detail: rx }, { user: rx }, { itemName: rx }];
    }

    const [entries, total] = await Promise.all([
      AuditLog.find(filter).sort({ date: -1 }).skip(page * limit).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ entries, total, page, limit });
  } catch (err) {
    console.error('Audit GET error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

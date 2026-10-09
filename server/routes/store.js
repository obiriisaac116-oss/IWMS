const express     = require('express');
const Store       = require('../models/Store');
const requireAuth = require('../middleware/auth');
const { broadcastChange } = require('./sse');

const router = express.Router();
router.use(requireAuth);

const isProd = process.env.NODE_ENV === 'production';

// ── Zod removed — inline validation ──────────────────────────────────────────
const putSchema = { validate: (body) => body && body.value !== undefined };
function validate(schema) {
  return (req, res, next) => {
    if (!req.body || req.body.value === undefined)
      return res.status(400).json({ error: '`value` is required in request body' });
    next();
  };
}

// ── Key scoping ───────────────────────────────────────────────────────────────
const SHARED_KEYS = new Set([
  'dit_stores_data_v33', 'dit_stores_data_v32',
  'dit_activity_log_v1',
  'military_clothing_db_v6', 'military_clothing_config_v3',
  'military_saved_forms_v3', 'military_clothing_receipts_v1',
  'military_clothing_issues_v1',
  'dit_jobs_data', 'ditJobCounter',
  'dit_personnel_data',
  'dit_pay_stores_activity_v1',
  'safeKeepingItems', 'safeKeepingLoans', 'safeKeepingPersonnel',
  'dit_departments_v1', 'dit_stores_users',
]);

function scopedKey(req, key) {
  if (SHARED_KEYS.has(key) || key.startsWith('safeKeeping')) return `org::${key}`;
  return `user::${req.user._id}::${key}`;
}

// ── GET /api/store ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const userPfx = `user::${req.user._id}::`;
    const docs = await Store.find({
      $or: [
        { key: { $regex: '^org::' } },
        { key: { $regex: `^${userPfx.replace('::', '::').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } },
      ],
    }).lean();
    const result = docs.map(d => ({
      key:       d.key.replace(/^org::/, '').replace(`user::${req.user._id}::`, ''),
      value:     d.value,
      updatedAt: d.updatedAt,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

// ── GET /api/store/:key ───────────────────────────────────────────────────────
router.get('/:key', async (req, res) => {
  try {
    const sk  = scopedKey(req, req.params.key);
    const doc = await Store.findOne({ key: sk }).lean();
    if (!doc) return res.status(404).json({ value: null });
    res.json({ key: req.params.key, value: doc.value, updatedAt: doc.updatedAt });
  } catch (err) {
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

// ── PUT /api/store/:key  (upsert + conflict check) ───────────────────────────
router.put('/:key', validate(putSchema), async (req, res) => {
  try {
    const sk = scopedKey(req, req.params.key);
    const { value, updatedAt: clientTs } = req.body;

    // ── Conflict resolution ───────────────────────────────────────────────
    if (clientTs) {
      const existing = await Store.findOne({ key: sk }).lean();
      if (existing && existing.updatedAt) {
        const serverTs = new Date(existing.updatedAt).getTime();
        const clientTime = new Date(clientTs).getTime();
        if (serverTs > clientTime + 1000) {
          // Server has a newer version — return 409 with server value
          return res.status(409).json({
            error:     'Conflict: server has a newer version',
            serverValue: existing.value,
            serverUpdatedAt: existing.updatedAt,
          });
        }
      }
    }

    const doc = await Store.findOneAndUpdate(
      { key: sk },
      { $set: { value, updatedAt: new Date() } },
      { upsert: true, new: true }
    );

    // Notify other devices via SSE
    broadcastChange('store', { key: req.params.key }, req.user._id.toString());

    res.json({ key: req.params.key, value: doc.value, updatedAt: doc.updatedAt });
  } catch (err) {
    console.error('Store PUT error:', err);
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

// ── DELETE /api/store/:key ────────────────────────────────────────────────────
router.delete('/:key', async (req, res) => {
  try {
    const sk = scopedKey(req, req.params.key);
    await Store.findOneAndDelete({ key: sk });
    broadcastChange('store-delete', { key: req.params.key }, req.user._id.toString());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

module.exports = router;

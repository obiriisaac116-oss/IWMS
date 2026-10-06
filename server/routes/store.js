/**
 * Generic key-value store routes — mirrors the localStorage API exactly.
 * Every page calls memoryStore.getItem(key) / memoryStore.setItem(key, value).
 * sql-storage.js will proxy those calls to these endpoints.
 *
 * GET  /api/store/:key          → { key, value }
 * PUT  /api/store/:key          → { key, value }   (upsert)
 * DELETE /api/store/:key        → { success: true }
 * GET  /api/store               → [{ key, value }, ...]  (all keys for this user)
 */
const express     = require('express');
const Store       = require('../models/Store');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// All store routes require authentication
router.use(requireAuth);

// Helper: scope key per-user so different users don't overwrite each other's data.
// Admins share a global namespace for shared keys; user-specific keys are namespaced.
const SHARED_KEYS = new Set([
  'dit_stores_data_v33',
  'dit_stores_data_v32',
  'dit_activity_log_v1',
  'military_clothing_db_v6',
  'military_clothing_config_v3',
  'military_saved_forms_v3',
  'military_clothing_receipts_v1',
  'military_clothing_issues_v1',
  'dit_jobs_data',
  'ditJobCounter',
  'dit_personnel_data',
  'dit_pay_stores_activity_v1',
  'safeKeepingItems',
  'safeKeepingLoans',
  'safeKeepingPersonnel',
  'dit_departments_v1',
  'dit_stores_users',
]);

function scopedKey(req, key) {
  // Shared / org-wide data — single copy for all users
  if (SHARED_KEYS.has(key) || key.startsWith('safeKeeping')) return `org::${key}`;
  // User preferences (theme, col visibility, etc.) — per user
  return `user::${req.user._id}::${key}`;
}

// ── GET /api/store  (all keys accessible to this user) ───────────────────────
router.get('/', async (req, res) => {
  try {
    const prefix = `org::`;
    const userPfx = `user::${req.user._id}::`;
    const docs = await Store.find({
      $or: [
        { key: { $regex: `^${prefix}` } },
        { key: { $regex: `^${userPfx}` } },
      ],
    }).lean();
    // Strip internal scope prefix before returning
    const result = docs.map(d => ({
      key: d.key.replace(/^org::/, '').replace(`user::${req.user._id}::`, ''),
      value: d.value,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/store/:key ───────────────────────────────────────────────────────
router.get('/:key', async (req, res) => {
  try {
    const sk  = scopedKey(req, req.params.key);
    const doc = await Store.findOne({ key: sk }).lean();
    if (!doc) return res.status(404).json({ value: null });
    res.json({ key: req.params.key, value: doc.value });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/store/:key  (upsert) ─────────────────────────────────────────────
router.put('/:key', async (req, res) => {
  try {
    const sk = scopedKey(req, req.params.key);
    const { value } = req.body;
    if (value === undefined)
      return res.status(400).json({ error: '`value` is required in request body' });

    const doc = await Store.findOneAndUpdate(
      { key: sk },
      { $set: { value } },
      { upsert: true, new: true }
    );
    res.json({ key: req.params.key, value: doc.value });
  } catch (err) {
    console.error('Store PUT error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/store/:key ────────────────────────────────────────────────────
router.delete('/:key', async (req, res) => {
  try {
    const sk = scopedKey(req, req.params.key);
    await Store.findOneAndDelete({ key: sk });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

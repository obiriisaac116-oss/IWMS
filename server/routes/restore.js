/**
 * /api/restore — one-shot data restore endpoints (admin only)
 *
 * POST /api/restore/clothing
 *   Body: the clothing-inventory-backup JSON file contents
 *   Writes clothingItems → military_clothing_config_v3
 *          personnel    → military_clothing_db_v6
 *          receiveRecords → military_clothing_receipts_v1
 *          issueRecords   → military_clothing_issues_v1
 *          savedForms     → military_saved_forms_v3
 *   All written as org-scoped store keys so every user sees the data.
 */
const express     = require('express');
const { z }       = require('zod');
const Store       = require('../models/Store');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const isProd = process.env.NODE_ENV === 'production';

/* ── Admin guard ─────────────────────────────────────────────────────────── */
function requireAdmin(req, res, next) {
  const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

/* ── Upsert helper — writes to the org-scoped namespace ─────────────────── */
async function upsertOrgKey(key, value) {
  const sk = `org::${key}`;
  await Store.findOneAndUpdate(
    { key: sk },
    { $set: { value, updatedAt: new Date() } },
    { upsert: true, new: true }
  );
}

/* ── POST /api/restore/clothing ─────────────────────────────────────────── */
router.post('/clothing', requireAdmin, async (req, res) => {
  try {
    const data = req.body;

    /* Validate it is a clothing backup */
    if (!data || data.format !== 'clothing-inventory-backup') {
      return res.status(400).json({ error: 'Not a valid clothing-inventory-backup file' });
    }
    if (!data.clothingItems || typeof data.clothingItems !== 'object') {
      return res.status(400).json({ error: 'Backup is missing clothingItems' });
    }
    if (!data.personnel || !Array.isArray(data.personnel.records)) {
      return res.status(400).json({ error: 'Backup is missing personnel.records' });
    }

    const personnelCount = data.personnel.records.length;
    const itemCount      = Object.keys(data.clothingItems).length;

    /* Write all keys in parallel */
    await Promise.all([
      upsertOrgKey('military_clothing_config_v3', data.clothingItems),
      upsertOrgKey('military_clothing_db_v6', {
        records:       data.personnel.records,
        nextOfficer:   data.personnel.nextOfficer  || 1,
        nextSoldier:   data.personnel.nextSoldier  || 1,
      }),
      upsertOrgKey('military_clothing_receipts_v1',
        Array.isArray(data.receiveRecords) ? data.receiveRecords : []),
      upsertOrgKey('military_clothing_issues_v1',
        Array.isArray(data.issueRecords)   ? data.issueRecords   : []),
      upsertOrgKey('military_saved_forms_v3',
        Array.isArray(data.savedForms)     ? data.savedForms     : []),
    ]);

    console.log(`Clothing restore: ${personnelCount} personnel, ${itemCount} clothing items`);

    res.json({
      success:        true,
      personnelCount,
      itemCount,
      restoredAt:     new Date().toISOString(),
    });

  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

module.exports = router;

/**
 * Checks what's actually in MongoDB and re-seeds if needed.
 * Run: cd server && node scripts/check-and-fix-clothing.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

const storeSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });
const Store = mongoose.model('Store', storeSchema);

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected.\n');

  // List ALL org:: keys
  const all = await Store.find({ key: /^org::/ }).select('key updatedAt').lean();
  console.log('All org:: keys in MongoDB:');
  all.forEach(d => console.log(' ', d.key, '—', d.updatedAt));
  console.log('');

  // Check clothing config specifically
  const config = await Store.findOne({ key: 'org::military_clothing_config_v3' }).lean();
  if (!config) {
    console.log('military_clothing_config_v3: NOT FOUND');
  } else {
    const v = config.value;
    if (!v || (typeof v === 'object' && Object.keys(v).length === 0)) {
      console.log('military_clothing_config_v3: EMPTY OBJECT — needs re-seed');
    } else {
      const keys = Object.keys(v);
      console.log('military_clothing_config_v3:', keys.length, 'items —', keys.slice(0, 4).join(', '));
    }
  }

  // Check clothing db
  const db = await Store.findOne({ key: 'org::military_clothing_db_v6' }).lean();
  if (!db) {
    console.log('military_clothing_db_v6: NOT FOUND');
  } else {
    const v = db.value;
    const n = v && v.records ? v.records.length : 0;
    if (n === 0) {
      console.log('military_clothing_db_v6: 0 records — needs re-seed');
    } else {
      console.log('military_clothing_db_v6:', n, 'personnel records — first:', v.records[0].svcNo || v.records[0].name);
    }
  }

  // If empty, re-seed from backup file
  const needsReseed = !config || !db ||
    (config.value && Object.keys(config.value).length === 0) ||
    (db.value && (!db.value.records || db.value.records.length === 0));

  if (needsReseed) {
    console.log('\nRe-seeding from backup file...');
    const backupPath = path.join(__dirname, '../../clothing_backup_2026-10-05.json');
    if (!fs.existsSync(backupPath)) {
      console.error('Backup file not found at:', backupPath);
      process.exit(1);
    }
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    if (backup.format !== 'clothing-inventory-backup') {
      console.error('Not a valid clothing backup');
      process.exit(1);
    }

    async function upsert(key, value) {
      await Store.findOneAndUpdate(
        { key: 'org::' + key },
        { $set: { value, updatedAt: new Date() } },
        { upsert: true, new: true }
      );
      const v = value;
      if (Array.isArray(v)) console.log('  Wrote org::' + key + ' —', v.length, 'entries');
      else if (v && v.records) console.log('  Wrote org::' + key + ' —', v.records.length, 'records');
      else console.log('  Wrote org::' + key + ' —', Object.keys(v || {}).length, 'keys');
    }

    await upsert('military_clothing_config_v3', backup.clothingItems);
    await upsert('military_clothing_db_v6', {
      records:     backup.personnel.records,
      nextOfficer: backup.personnel.nextOfficer || 1,
      nextSoldier: backup.personnel.nextSoldier || 1,
    });
    await upsert('military_clothing_receipts_v1', Array.isArray(backup.receiveRecords) ? backup.receiveRecords : []);
    await upsert('military_clothing_issues_v1',   Array.isArray(backup.issueRecords)   ? backup.issueRecords   : []);
    await upsert('military_saved_forms_v3',        Array.isArray(backup.savedForms)    ? backup.savedForms     : []);

    // Reset seed marker so it will re-run on next server start too
    await Store.deleteOne({ key: 'org::_clothing_seed_done' });

    console.log('\nDone! Clothing data re-seeded successfully.');
    console.log('Personnel:', backup.personnel.records.length);
    console.log('Items:', Object.keys(backup.clothingItems).length);
  } else {
    console.log('\nData looks good — no re-seed needed.');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error('ERROR:', err.message); process.exit(1); });

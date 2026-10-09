/**
 * restore-clothing-direct.js
 * Connects directly to MongoDB Atlas and writes the clothing backup.
 * Run: node scripts/restore-clothing-direct.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

const BACKUP_FILE = path.join(__dirname, '../../clothing_backup_2026-10-05.json');

// Inline Store model (avoids import issues)
const storeSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });
const Store = mongoose.model('Store', storeSchema);

async function upsert(key, value) {
  const sk = 'org::' + key;
  await Store.findOneAndUpdate(
    { key: sk },
    { $set: { value, updatedAt: new Date() } },
    { upsert: true, new: true }
  );
  console.log('  ✓ Wrote', sk);
}

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  console.log('Connected.\n');

  console.log('Reading backup file...');
  const raw    = fs.readFileSync(BACKUP_FILE, 'utf8');
  const backup = JSON.parse(raw);

  if (backup.format !== 'clothing-inventory-backup') {
    console.error('Not a valid clothing backup file.');
    process.exit(1);
  }

  const pCount = backup.personnel && backup.personnel.records
    ? backup.personnel.records.length : 0;
  const iCount = backup.clothingItems
    ? Object.keys(backup.clothingItems).length : 0;

  console.log('Backup contains:');
  console.log(' ', pCount, 'personnel records');
  console.log(' ', iCount, 'clothing items');
  console.log('');

  console.log('Writing to MongoDB...');
  await upsert('military_clothing_config_v3', backup.clothingItems);
  await upsert('military_clothing_db_v6', {
    records:      backup.personnel.records,
    nextOfficer:  backup.personnel.nextOfficer  || 1,
    nextSoldier:  backup.personnel.nextSoldier  || 1,
  });
  await upsert('military_clothing_receipts_v1',
    Array.isArray(backup.receiveRecords) ? backup.receiveRecords : []);
  await upsert('military_clothing_issues_v1',
    Array.isArray(backup.issueRecords)   ? backup.issueRecords   : []);
  await upsert('military_saved_forms_v3',
    Array.isArray(backup.savedForms)     ? backup.savedForms     : []);

  console.log('');
  console.log('All done!');
  console.log(' Personnel restored:', pCount);
  console.log(' Clothing items restored:', iCount);
  console.log('');
  console.log('Open clothing.html on your Render URL to see the data.');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});

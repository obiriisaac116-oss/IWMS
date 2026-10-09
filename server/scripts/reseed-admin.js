/**
 * reseed-admin.js — run once to fix the admin password hash
 * Usage: cd server && node scripts/reseed-admin.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User     = require('../models/User');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected');

  // Remove stale admin (wrong hash from the Web Crypto experiment)
  const deleted = await User.deleteOne({ email: 'admin@dit.local' });
  console.log('Deleted old admin:', deleted.deletedCount, 'document(s)');

  // Re-create with plain password — pre-save hook bcrypt-hashes it
  const admin = await User.create({
    fullName:     'Admin',
    username:     'admin',
    email:        'admin@dit.local',
    passwordHash: 'Password@123',
    role:         'Admin',
    modules: {
      clothing:    { view: true, add: true, edit: true, delete: true },
      inventories: { view: true, add: true, edit: true, delete: true },
      payStores:   { view: true, add: true, edit: true, delete: true },
      jobscard:    { view: true, add: true, edit: true, delete: true },
      personnel:   { view: true, add: true, edit: true, delete: true },
    },
  });
  console.log('Admin re-created:', admin.email, '| id:', admin._id);
  await mongoose.disconnect();
  console.log('Done. Login with admin@dit.local / Password@123');
}

run().catch(err => { console.error(err); process.exit(1); });

require('dotenv').config();
const express      = require('express');
const mongoose     = require('mongoose');
const cors         = require('cors');
const path         = require('path');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const helmet       = require('helmet');

const authRoutes    = require('./routes/auth');
const storeRoutes   = require('./routes/store');
const sseRoutes     = require('./routes/sse');
const auditRoutes   = require('./routes/audit');
const restoreRoutes = require('./routes/restore');

const app  = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Trust Render's proxy so rate-limiting uses the real client IP ─────────────
// Without this, every request appears to come from Render's internal IP and
// the 10-attempt login limit would apply to ALL users at once.
app.set('trust proxy', 1);

// ── Helmet — sets 11 security headers in one call ────────────────────────────
app.use(helmet({
  // Allow CDN resources (fonts, FontAwesome, Tailwind) used by the frontend
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com', 'https://cdn.sheetjs.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
      workerSrc:   ["'self'", 'blob:'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  // Allow the app to be embedded in same-origin iframes (e.g. print previews)
  frameguard: { action: 'sameorigin' },
  // Don't send referrer to external sites
  referrerPolicy: { policy: 'same-origin' },
  // HSTS — only in production (Render always uses HTTPS)
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Always allow the Render service's own origin
const SELF_ORIGIN = 'https://iwms-p1ru.onrender.com';
if (!allowedOrigins.includes(SELF_ORIGIN)) allowedOrigins.push(SELF_ORIGIN);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing + cookies ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb', strict: false }));
app.use(express.text({ type: 'application/json', limit: '10mb' })); // fallback if Content-Type is mangled
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Global rate limit (all routes) ───────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,                  // generous general limit
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

// ── Strict rate limit on login ────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});
app.use('/api/auth/login', loginLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/store',   storeRoutes);
app.use('/api/events',  sseRoutes);
app.use('/api/audit',   auditRoutes);
app.use('/api/restore', restoreRoutes);

// ── Serve frontend static files ───────────────────────────────────────────────
const frontendDir = path.join(__dirname, '..');
app.use(express.static(frontendDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// ── Global error handler — hide stack traces in production ───────────────────
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = isProd ? 'An unexpected error occurred.' : (err.message || 'Server error');
  if (!isProd) console.error(err);
  res.status(status).json({ error: message });
});

// ── MongoDB + start ───────────────────────────────────────────────────────────
async function start() {
  if (!process.env.MONGODB_URI) {
    console.error('FATAL: MONGODB_URI is not set.');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET is not set.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
    });
    console.log('MongoDB connected');

    // ── MongoDB indexes ───────────────────────────────────────────────────
    const Store   = require('./models/Store');
    const User    = require('./models/User');
    const AuditLog = require('./models/AuditLog');

    await Store.collection.createIndex({ key: 1 }, { unique: true, background: true });
    await User.collection.createIndex({ email: 1 }, { unique: true, background: true });
    await User.collection.createIndex({ username: 1 }, { unique: true, background: true });
    await AuditLog.collection.createIndex({ date: -1 }, { background: true });
    await AuditLog.collection.createIndex({ module: 1, date: -1 }, { background: true });
    console.log('Indexes ensured');

    // ── Seed / fix default admin ──────────────────────────────────────────
    // Always verify the admin password works. If not (stale hash from
    // the Web Crypto experiment), delete and recreate with fresh bcrypt hash.
    const existingAdmin = await User.findOne({ email: 'admin@dit.local' });
    if (!existingAdmin) {
      await User.create({
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
      console.log('Admin seeded  →  email: admin@dit.local  |  password: Password@123');
    } else {
      // Verify the stored hash still works — fix it if not
      const ok = await existingAdmin.verifyPassword('Password@123');
      if (!ok) {
        await User.deleteOne({ email: 'admin@dit.local' });
        await User.create({
          fullName:     existingAdmin.fullName || 'Admin',
          username:     existingAdmin.username || 'admin',
          email:        'admin@dit.local',
          passwordHash: 'Password@123',   // pre-save hook re-hashes
          role:         existingAdmin.role || 'Admin',
          modules:      existingAdmin.modules || {
            clothing:    { view: true, add: true, edit: true, delete: true },
            inventories: { view: true, add: true, edit: true, delete: true },
            payStores:   { view: true, add: true, edit: true, delete: true },
            jobscard:    { view: true, add: true, edit: true, delete: true },
            personnel:   { view: true, add: true, edit: true, delete: true },
          },
        });
        console.log('Admin password hash was stale — recreated with fresh bcrypt hash');
      } else {
        console.log('Admin account OK');
      }
    }

    // ── One-time clothing backup seed ────────────────────────────────────────
    // Loads clothing-seed.json on first deploy, writes it to MongoDB, then
    // marks done so it never runs again. Safe to re-deploy — idempotent.
    try {
      const seedFile = require('path').join(__dirname, 'scripts/clothing-seed.json');
      const fs       = require('fs');
      if (fs.existsSync(seedFile)) {
        const seedDone = await Store.findOne({ key: 'org::_clothing_seed_done' });
        if (!seedDone) {
          const backup = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
          if (backup.format === 'clothing-inventory-backup') {
            async function upsertOrg(key, value) {
              await Store.findOneAndUpdate(
                { key: 'org::' + key },
                { $set: { value, updatedAt: new Date() } },
                { upsert: true, new: true }
              );
            }
            await upsertOrg('military_clothing_config_v3', backup.clothingItems);
            await upsertOrg('military_clothing_db_v6', {
              records:     backup.personnel.records,
              nextOfficer: backup.personnel.nextOfficer || 1,
              nextSoldier: backup.personnel.nextSoldier || 1,
            });
            await upsertOrg('military_clothing_receipts_v1',
              Array.isArray(backup.receiveRecords) ? backup.receiveRecords : []);
            await upsertOrg('military_clothing_issues_v1',
              Array.isArray(backup.issueRecords) ? backup.issueRecords : []);
            await upsertOrg('military_saved_forms_v3',
              Array.isArray(backup.savedForms) ? backup.savedForms : []);
            // Mark as done so this never runs again
            await Store.create({ key: 'org::_clothing_seed_done', value: new Date().toISOString() });
            const pCount = backup.personnel.records.length;
            const iCount = Object.keys(backup.clothingItems).length;
            console.log(`Clothing seed done: ${pCount} personnel, ${iCount} items`);
          }
        } else {
          console.log('Clothing seed: already done, skipping.');
        }
      }
    } catch (seedErr) {
      console.error('Clothing seed error (non-fatal):', seedErr.message);
    }

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }
}

start();

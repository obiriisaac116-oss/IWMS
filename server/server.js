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
      upgradeInsecureRequests: isProd ? [] : null,
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

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing + cookies ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
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

    // ── Seed / reseed default admin ───────────────────────────────────────
    // Delete any stale admin that may have been seeded with the wrong hash,
    // then re-create so the bcrypt pre-save hook runs cleanly.
    const existingAdmin = await User.findOne({ email: 'admin@dit.local' });
    if (!existingAdmin) {
      await User.create({
        fullName:     'Admin',
        username:     'admin',
        email:        'admin@dit.local',
        passwordHash: 'Password@123',   // pre-save hook bcrypt-hashes this
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
    }

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }
}

start();

require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const path      = require('path');

const authRoutes  = require('./routes/auth');
const storeRoutes = require('./routes/store');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin)
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',  authRoutes);
app.use('/api/store', storeRoutes);

// ── Serve frontend static files (when deployed as one Render service) ─────────
// The frontend HTML files live one level up from /server
const frontendDir = path.join(__dirname, '..');
app.use(express.static(frontendDir));
// SPA fallback — any unknown route serves index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// ── MongoDB + start ───────────────────────────────────────────────────────────
async function start() {
  if (!process.env.MONGODB_URI) {
    console.error('FATAL: MONGODB_URI is not set. Add it to Render environment variables.');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET is not set. Add it to Render environment variables.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');

    // Seed default admin user if the users collection is empty
    const User = require('./models/User');
    const count = await User.countDocuments();
    if (count === 0) {
      await User.create({
        fullName:     'Admin',
        username:     'admin',
        email:        'admin@dit.local',
        passwordHash: 'Password@123',   // pre-save hook hashes this
        role:         'Admin',
        modules: {
          clothing:    { view: true, add: true, edit: true, delete: true },
          inventories: { view: true, add: true, edit: true, delete: true },
          payStores:   { view: true, add: true, edit: true, delete: true },
          jobscard:    { view: true, add: true, edit: true, delete: true },
          personnel:   { view: true, add: true, edit: true, delete: true },
        },
      });
      console.log('Default admin seeded  →  username: admin  password: Password@123');
      console.log('IMPORTANT: Change the default admin password after first login!');
    }

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }
}

start();

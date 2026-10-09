const express = require('express');
const jwt     = require('jsonwebtoken');
const { z }   = require('zod');
const User    = require('../models/User');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';

// ── Token helpers ─────────────────────────────────────────────────────────────
function signAccessToken(userId) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set');
  return jwt.sign({ sub: userId, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '15m' });
}
function signRefreshToken(userId) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set');
  return jwt.sign({ sub: userId, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '30d' });
}
function setRefreshCookie(res, token) {
  res.cookie('dit_refresh', token, {
    httpOnly: true,
    secure:   isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
    path:     '/api/auth/refresh',
  });
}

// ── Zod schemas ───────────────────────────────────────────────────────────────
const loginSchema = z.object({
  identifier: z.string().min(1).max(254),
  password:   z.string().min(1).max(128),
});
const createUserSchema = z.object({
  fullName:   z.string().max(120).optional(),
  username:   z.string().min(2).max(60).regex(/^[a-zA-Z0-9._@-]+$/),
  email:      z.string().email().max(254),
  password:   z.string().min(8).max(128),
  role:       z.enum(['Admin', 'Administrator', 'User']).optional(),
  modules:    z.record(z.any()).optional(),
  departmentPrivileges: z.record(z.any()).optional(),
  department: z.string().max(120).optional(),
});
const updateUserSchema = z.object({
  fullName:   z.string().max(120).optional(),
  username:   z.string().min(2).max(60).optional(),
  email:      z.string().email().max(254).optional(),
  password:   z.string().min(8).max(128).optional(),
  role:       z.enum(['Admin', 'Administrator', 'User']).optional(),
  modules:    z.record(z.any()).optional(),
  departmentPrivileges: z.record(z.any()).optional(),
  department: z.string().max(120).optional(),
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

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const id = identifier.toLowerCase().trim();
    const user = await User.findOne({ $or: [{ email: id }, { username: id }] });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken  = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);

    res.json({ token: accessToken, user: user.toSafeObject() });
  } catch (err) {
    console.error('Login error:', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies && req.cookies.dit_refresh;
    if (!token) return res.status(401).json({ error: 'No refresh token' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    if (payload.type !== 'refresh') return res.status(401).json({ error: 'Not a refresh token' });

    const user = await User.findById(payload.sub).select('-passwordHash');
    if (!user) return res.status(401).json({ error: 'User not found' });

    const newAccess  = signAccessToken(user._id);
    const newRefresh = signRefreshToken(user._id);
    setRefreshCookie(res, newRefresh);

    res.json({ token: newAccess, user: user.toSafeObject ? user.toSafeObject() : user });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (_req, res) => {
  res.clearCookie('dit_refresh', { path: '/api/auth/refresh' });
  res.json({ success: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toSafeObject ? req.user.toSafeObject() : req.user });
});

// ── GET /api/auth/users  (admin only) ────────────────────────────────────────
router.get('/users', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const users = await User.find().select('-passwordHash').lean();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

// ── POST /api/auth/users  (admin: create user) ───────────────────────────────
router.post('/users', requireAuth, validate(createUserSchema), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const { fullName, username, email, password, role, modules, departmentPrivileges, department } = req.body;
    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] });
    if (exists) return res.status(409).json({ error: 'A user with that email or username already exists' });

    const user = new User({ fullName, username, email, passwordHash: password, role, modules, departmentPrivileges, department });
    await user.save();
    res.status(201).json(user.toSafeObject());
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

// ── PUT /api/auth/users/:id  (admin: edit user) ──────────────────────────────
router.put('/users/:id', requireAuth, validate(updateUserSchema), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
    const isSelf  = req.user._id.toString() === req.params.id;
    if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Forbidden' });

    const { fullName, username, email, password, role, modules, departmentPrivileges, department } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (fullName   !== undefined) user.fullName   = fullName;
    if (username   !== undefined) user.username   = username;
    if (email      !== undefined) user.email      = email;
    if (department !== undefined) user.department = department;
    if (isAdmin) {
      if (role                 !== undefined) user.role                 = role;
      if (modules              !== undefined) user.modules              = modules;
      if (departmentPrivileges !== undefined) user.departmentPrivileges = departmentPrivileges;
    }
    if (password) user.passwordHash = password;

    await user.save();
    res.json(user.toSafeObject());
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

// ── DELETE /api/auth/users/:id  (admin only) ─────────────────────────────────
router.delete('/users/:id', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
    if (req.user._id.toString() === req.params.id)
      return res.status(400).json({ error: 'Cannot delete your own account' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: isProd ? 'Server error' : err.message });
  }
});

module.exports = router;

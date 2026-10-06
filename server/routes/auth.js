const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const requireAuth = require('../middleware/auth');

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '12h' });
}

// ── POST /api/auth/login ───────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password)
      return res.status(400).json({ error: 'Username/email and password are required' });

    const id = identifier.toLowerCase().trim();
    const user = await User.findOne({ $or: [{ email: id }, { username: id }] });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user._id);
    res.json({ token, user: user.toSafeObject() });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toSafeObject ? req.user.toSafeObject() : req.user });
});

// ── GET /api/auth/users  (admin only) ─────────────────────────────────────────
router.get('/users', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const users = await User.find().select('-passwordHash').lean();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/users  (admin: create user) ────────────────────────────────
router.post('/users', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const { fullName, username, email, password, role, modules, departmentPrivileges, department } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'username, email and password are required' });

    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] });
    if (exists) return res.status(409).json({ error: 'A user with that email or username already exists' });

    const user = new User({ fullName, username, email, passwordHash: password, role, modules, departmentPrivileges, department });
    await user.save();
    res.status(201).json(user.toSafeObject());
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/auth/users/:id  (admin: edit user) ───────────────────────────────
router.put('/users/:id', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
    const isSelf  = req.user._id.toString() === req.params.id;
    if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Forbidden' });

    const { fullName, username, email, password, role, modules, departmentPrivileges, department } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (fullName  !== undefined) user.fullName  = fullName;
    if (username  !== undefined) user.username  = username;
    if (email     !== undefined) user.email     = email;
    if (department !== undefined) user.department = department;
    // Only admins can change roles / privileges
    if (isAdmin) {
      if (role                 !== undefined) user.role                 = role;
      if (modules              !== undefined) user.modules              = modules;
      if (departmentPrivileges !== undefined) user.departmentPrivileges = departmentPrivileges;
    }
    if (password) user.passwordHash = password; // pre-save hook re-hashes

    await user.save();
    res.json(user.toSafeObject());
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/auth/users/:id  (admin only) ──────────────────────────────────
router.delete('/users/:id', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin' || req.user.role === 'Administrator';
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
    if (req.user._id.toString() === req.params.id)
      return res.status(400).json({ error: 'Cannot delete your own account' });

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

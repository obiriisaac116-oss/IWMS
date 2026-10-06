const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  fullName:             { type: String, default: '' },
  username:             { type: String, required: true, unique: true, lowercase: true, trim: true },
  email:                { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash:         { type: String, required: true },
  role:                 { type: String, enum: ['Admin', 'Administrator', 'User'], default: 'User' },
  modules:              { type: mongoose.Schema.Types.Mixed, default: {} },
  departmentPrivileges: { type: mongoose.Schema.Types.Mixed, default: {} },
  department:           { type: String, default: '' },
}, { timestamps: true });

// Hash password before saving
// Passwords arrive either as plain text (seed) or SHA-256 hex (from Web Crypto).
// Either way bcrypt-hash them at the server level.
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

// Compare: try both direct bcrypt compare (plain/seed) and SHA-256 pre-hashed
userSchema.methods.verifyPassword = async function (incoming) {
  // Direct bcrypt compare (covers plain text seeds + old accounts)
  const direct = await bcrypt.compare(incoming, this.passwordHash);
  if (direct) return true;
  // Also try SHA-256 hex of the incoming value (Web Crypto client path)
  try {
    const { createHash } = require('crypto');
    const hashed = createHash('sha256').update(incoming).digest('hex');
    return bcrypt.compare(hashed, this.passwordHash);
  } catch (_) { return false; }
};

// Never expose hash in API responses
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);

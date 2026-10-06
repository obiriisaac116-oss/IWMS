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
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

// Compare plain password to hash
userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

// Never expose hash in API responses
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);

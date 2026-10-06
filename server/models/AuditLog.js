const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  module:   { type: String, required: true, index: true },
  action:   { type: String, required: true },
  detail:   { type: String, default: '' },
  office:   { type: String, default: '' },
  itemName: { type: String, default: '' },
  user:     { type: String, default: 'Unknown user' },
  userId:   { type: String, default: '' },
  date:     { type: Date,   default: Date.now, index: true },
  quantity: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: false });

// Compound index for the reports page filter queries
auditSchema.index({ module: 1, date: -1 });

module.exports = mongoose.model('AuditLog', auditSchema);

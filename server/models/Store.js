/**
 * Generic key-value store that mirrors the existing localStorage model.
 * Each document is one "namespace" key (e.g. 'dit_stores_data_v33') with
 * a free-form JSON payload. This lets the frontend swap localStorage for
 * the API with minimal changes.
 */
const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true, index: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);

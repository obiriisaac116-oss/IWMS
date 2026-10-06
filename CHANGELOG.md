# IWMS Changelog

All notable changes to the DIT Integrated Workplace Management System.

---

## [3.0.0] — 2026-10-06

### Added
- **Backend API** — Express + MongoDB server replaces all localStorage-only storage
- **JWT authentication** with 15-minute access tokens + 30-day httpOnly refresh cookies
- **Auto token refresh** — sessions renew silently; users never get kicked out mid-work
- **Rate limiting** — 10 login attempts per 15 min per IP; 500 req/15 min globally
- **Input validation** — Zod schemas on all API routes; malformed requests rejected with clear messages
- **Write queue** — rapid saves to the same key are debounced (500ms) and batched into one API call
- **IndexedDB offline cache** — replaces localStorage (no 5MB limit; survives tab close)
- **Server-Sent Events** — data changes broadcast to all connected devices in real time
- **Save-status indicator** — Saved / Saving… / Offline / Synced badge visible on every page
- **Web Crypto password hashing** — passwords SHA-256 hashed client-side before sending; server bcrypt-hashes the result
- **Conflict resolution** — server detects stale writes and returns 409 with the newer version
- **Audit log** — proper MongoDB collection with server-side pagination and filtering (replaces 1000-entry localStorage cap)
- **PDF export helper** (`print-helper.js`) — `window.ditPrint()` available on all pages
- **MongoDB indexes** — compound indexes on `date`, `module`, `key`, `email`, `username`
- **Production error hardening** — stack traces hidden from API responses in production
- **Service Worker v2** — bumped cache name; includes `print-helper.js`
- **CHANGELOG.md** — this file

### Fixed
- `openAdminReports` undefined function on dashboard (Reports card was broken)
- `sql-storage.js` and `responsive.css` 404 errors (files now exist)
- Inventories page scroll locked (`overflow: hidden` → `overflow-y: auto`)
- Import freeze on all pages — chunked async processing with UI yields
- Filter tabs overflowing on mobile
- Dashboard subtitle overflowing header on small screens
- Reports page slow with large Excel uploads — pagination added (50 items/page)
- SW pre-cache corruption (`**continue**/**` text removed from sw.js)

### Changed
- Default admin login: **email `admin@dit.local`**, password `Password@123`
- Token expiry: 12h → 15min access + 30d refresh
- All pages now share `responsive.css` and `sql-storage.js` as external files

---

## [2.5.0] — 2026-10-05

### Added
- Pagination on Reports activity log (50 items per page, Load More)
- Mobile responsive fixes across all 7 pages
- Service Worker for offline/24-7 access

### Fixed
- Large Excel import freezing the browser

---

## [2.0.0] — Initial multi-page release

- Clothing, Inventories, Pay-Stores, Jobs Card, Personnel, Reports modules
- localStorage-based storage
- Role-based access (Admin / User)

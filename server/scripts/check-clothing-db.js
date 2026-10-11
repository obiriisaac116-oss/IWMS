const https = require('https');

function req(method, path, body, token) {
  return new Promise((resolve) => {
    const b = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: 'iwms-p1ru.onrender.com', path, method, timeout: 25000,
      headers: {
        ...(b ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } : {}),
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }); }
        catch (_) { resolve({ s: res.statusCode, r: d.slice(0, 150) }); }
      });
    });
    r.on('error', e => resolve({ err: e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ err: 'timeout' }); });
    if (b) r.write(b);
    r.end();
  });
}

async function main() {
  const lr = await req('POST', '/api/auth/login', { identifier: 'admin@dit.local', password: 'Password@123' });
  const token = lr.b && lr.b.token;
  if (!token) { console.error('Login failed:', lr); return; }
  console.log('Logged in OK\n');

  const checks = [
    '_clothing_seed_done',
    'military_clothing_config_v3',
    'military_clothing_db_v6',
    'military_clothing_receipts_v1',
  ];

  for (const k of checks) {
    const r = await req('GET', '/api/store/' + encodeURIComponent(k), null, token);
    if (r.err) { console.log(k + ': ERROR -', r.err); continue; }
    if (r.s === 404 || !r.b || r.b.value === null || r.b.value === undefined) {
      console.log(k + ': *** NOT IN DB ***'); continue;
    }
    const v = r.b.value;
    if (k === 'military_clothing_config_v3') {
      const items = v ? Object.keys(v) : [];
      console.log(k + ': ' + items.length + ' clothing items — ' + items.slice(0, 4).join(', '));
    } else if (k === 'military_clothing_db_v6') {
      const n = v && v.records ? v.records.length : 0;
      console.log(k + ': ' + n + ' personnel records');
      if (n > 0) console.log('  First record:', JSON.stringify(v.records[0]).slice(0, 100));
    } else if (k === '_clothing_seed_done') {
      console.log(k + ': seed ran at', v);
    } else {
      const arr = Array.isArray(v) ? v : [];
      console.log(k + ': ' + arr.length + ' entries');
    }
  }
}

main().catch(e => console.error('Fatal:', e.message));

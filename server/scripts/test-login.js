const https = require('https');

function post(path, body, token) {
  return new Promise((resolve) => {
    const b = JSON.stringify(body);
    const req = https.request({
      hostname: 'iwms-p1ru.onrender.com',
      path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(b),
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      },
      timeout: 20000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const csp = res.headers['content-security-policy'];
        try { resolve({ status: res.statusCode, csp: csp || 'NONE', body: JSON.parse(d) }); }
        catch (_) { resolve({ status: res.statusCode, csp: csp || 'NONE', raw: d.slice(0, 200) }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(b);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'iwms-p1ru.onrender.com', path, method: 'GET', timeout: 20000,
      headers: { ...(token ? { 'Authorization': 'Bearer ' + token } : {}) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const csp = res.headers['content-security-policy'];
        try { resolve({ status: res.statusCode, csp: csp || 'NONE', body: JSON.parse(d) }); }
        catch (_) { resolve({ status: res.statusCode, csp: csp || 'NONE' }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

async function main() {
  console.log('=== FULL END-TO-END LOGIN TEST ===\n');

  const h = await get('/api/health');
  console.log('1. Health:', h.status === 200 ? 'OK' : 'FAIL', '| CSP:', h.csp);

  const lr = await post('/api/auth/login', { identifier: 'admin@dit.local', password: 'Password@123' });
  console.log('2. Login (correct):', lr.status === 200 ? 'OK' : 'FAIL ' + lr.status, '| CSP:', lr.csp);
  if (lr.body && lr.body.token) {
    console.log('   Token:     ', lr.body.token.slice(0, 25) + '...');
    console.log('   User email:', lr.body.user.email);
    console.log('   User role: ', lr.body.user.role);
  } else {
    console.log('   ERROR:', JSON.stringify(lr.body || lr.raw || lr.error));
  }

  const lr2 = await post('/api/auth/login', { identifier: 'admin@dit.local', password: 'wrongpassword' });
  console.log('3. Login (wrong pass):', lr2.status === 401 ? 'OK - got 401' : 'UNEXPECTED ' + lr2.status);
  console.log('   Error msg:', lr2.body && lr2.body.error);

  const lr3 = await post('/api/auth/login', { identifier: 'nobody@x.com', password: 'x' });
  console.log('4. Login (wrong email):', lr3.status === 401 ? 'OK - got 401' : 'UNEXPECTED ' + lr3.status);
  console.log('   Error msg:', lr3.body && lr3.body.error);

  const noauth = await get('/api/audit');
  console.log('5. Audit (no token):', noauth.status === 401 ? 'OK - blocked' : 'FAIL ' + noauth.status);

  const token = lr.body && lr.body.token;
  if (token) {
    const withauth = await get('/api/audit?limit=1', token);
    console.log('6. Audit (with token):', withauth.status === 200 ? 'OK' : 'FAIL ' + withauth.status);
    if (withauth.body) console.log('   Total entries:', withauth.body.total);
  }

  console.log('\n=== ALL CHECKS DONE ===');
  console.log('CSP header on login response:', lr.csp);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

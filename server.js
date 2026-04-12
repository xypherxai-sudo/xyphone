const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// VAPID Keys für Web Push Notifications
// ⚠️  Generiere echte Keys mit: node generate-vapid-keys.js
// ──────────────────────────────────────────────
const VAPID_PUBLIC_KEY  = 'BE3ekOOX5E9cEULJ4y3b2vNrZ-MiwoF3r3X0MRQvszwVkAMfcjgqu_itip7CWpw7UVLzFf4b4tuaBqDADrQ-1Lk';
const VAPID_PRIVATE_KEY = '1nUNSkqS1EYD3as_JxeSgV4Xl6ugSlNj7WX5HoDC5ts';
const VAPID_EMAIL       = 'mailto:admin@xypher.app';

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const PORT = 3131;

// ──────────────────────────────────────────────
// Xypher Dashboard – Supabase & Auth Config
// ──────────────────────────────────────────────
const SUPABASE_URL = 'https://llrnusfadlazswgudxjt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxscm51c2ZhZGxhenN3Z3VkeGp0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTE1NjY1MywiZXhwIjoyMDkwNzMyNjUzfQ.LkBEymbvVeok8qt2Fj_DCogZzp6jhdE0RFYs1L4mv2k';
const JWT_SECRET = 'xypher-secret-2026';
const ADMIN_KEY = 'xypher-admin-2026';

// Lazy-load optional packages (installed separately)
let jwt, bcrypt, supabaseClient, webPush;
function getWebPush() {
  if (!webPush) {
    webPush = require('web-push');
    webPush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }
  return webPush;
}
function getJwt() {
  if (!jwt) jwt = require('jsonwebtoken');
  return jwt;
}
function getBcrypt() {
  if (!bcrypt) bcrypt = require('bcryptjs');
  return bcrypt;
}
function getSupabase() {
  if (!supabaseClient) {
    const { createClient } = require('@supabase/supabase-js');
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

function requireAdminKey(req, res) {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    sendJSON(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

function verifyToken(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  try {
    return getJwt().verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
const CALENDAR_CONFIG_FILE = path.join(__dirname, 'calendar-config.json');
const BOOKINGS_FILE = path.join(__dirname, 'bookings.json');

// ──────────────────────────────────────────────
// Hilfsfunktionen
// ──────────────────────────────────────────────

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function getDayName(dateStr) {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const d = new Date(dateStr + 'T12:00:00Z');
  return days[d.getUTCDay()];
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(url, headers = {}, payload = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ──────────────────────────────────────────────
// Kalender-Logik
// ──────────────────────────────────────────────

function getDemoSlots(date) {
  const config = readJSON(CALENDAR_CONFIG_FILE) || {};
  const dayName = getDayName(date);
  const allSlots = (config.open_hours && config.open_hours[dayName]) || [];

  // Bereits gebuchte Slots rausfiltern
  const bookings = readJSON(BOOKINGS_FILE) || [];
  const bookedTimes = bookings
    .filter(b => b.date === date)
    .map(b => b.time);

  return allSlots.filter(s => !bookedTimes.includes(s));
}

async function getRealSlots(date, apiKey, eventTypeId) {
  try {
    const config = readJSON(CALENDAR_CONFIG_FILE) || {};
    const tz = config.timezone || 'Europe/Berlin';
    const startTime = `${date}T00:00:00`;
    const endTime   = `${date}T23:59:59`;

    const url = `https://api.cal.com/v2/slots/available?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&eventTypeId=${eventTypeId}&timeZone=${encodeURIComponent(tz)}`;
    const resp = await httpsGet(url, {
      'Authorization': `Bearer ${apiKey}`,
      'cal-api-version': '2024-09-04'
    });

    const data = JSON.parse(resp.body);
    // Cal.com v2 gibt slots als Objekt zurück: { slots: { "2024-01-01": [{time: "...", ...}] } }
    const daySlots = (data.data && data.data.slots && data.data.slots[date]) || [];
    return daySlots.map(s => {
      const t = new Date(s.time);
      return t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    });
  } catch (e) {
    console.error('Cal.com slots error:', e.message);
    return getDemoSlots(date); // Fallback
  }
}

async function bookDemo(data) {
  const bookings = readJSON(BOOKINGS_FILE) || [];
  const id = 'demo-' + Date.now();
  const booking = {
    id,
    name: data.name,
    phone: data.phone,
    email: data.email || '',
    date: data.date,
    time: data.time,
    service: data.service,
    created_at: new Date().toISOString()
  };
  bookings.push(booking);
  writeJSON(BOOKINGS_FILE, bookings);
  return {
    success: true,
    booking_id: id,
    message: `Termin bestätigt für ${data.date} um ${data.time} Uhr`
  };
}

async function bookReal(data) {
  try {
    const payload = {
      eventTypeId: parseInt(data.event_type_id),
      start: `${data.date}T${data.time}:00`,
      attendee: {
        name: data.name,
        email: data.email || `${data.phone.replace(/\s/g,'')}@noemail.invalid`,
        timeZone: 'Europe/Berlin',
        language: 'de'
      },
      metadata: {
        phone: data.phone,
        service: data.service
      }
    };

    const resp = await httpsPost(
      'https://api.cal.com/v2/bookings',
      {
        'Authorization': `Bearer ${data.calcom_api_key}`,
        'cal-api-version': '2024-08-13'
      },
      payload
    );

    const result = JSON.parse(resp.body);
    if (resp.status >= 200 && resp.status < 300 && result.data) {
      const uid = result.data.uid || result.data.id || 'calcom-' + Date.now();
      return {
        success: true,
        booking_id: String(uid),
        message: `Termin bestätigt für ${data.date} um ${data.time} Uhr`
      };
    } else {
      throw new Error(result.message || 'Cal.com Buchung fehlgeschlagen');
    }
  } catch (e) {
    console.error('Cal.com booking error:', e.message);
    // Fallback: Demo-Buchung speichern
    return await bookDemo(data);
  }
}

// ──────────────────────────────────────────────
// HTTP Server
// ──────────────────────────────────────────────

http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // ── POST /api/auth/login ──
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await parseBody(req);
    const { username, password } = body;
    if (!username || !password) return sendJSON(res, 400, { error: 'username and password required' });
    try {
      const sb = getSupabase();
      const { data, error } = await sb.from('clients').select('*').eq('username', username).single();
      if (error || !data) return sendJSON(res, 401, { error: 'Invalid credentials' });
      const valid = await getBcrypt().compare(password, data.password_hash);
      if (!valid) return sendJSON(res, 401, { error: 'Invalid credentials' });
      const token = getJwt().sign(
        { client_id: data.id, username: data.username, business_name: data.business_name },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      return sendJSON(res, 200, { token, business_name: data.business_name });
    } catch (e) {
      console.error('Login error:', e.message);
      return sendJSON(res, 500, { error: 'Internal error' });
    }
  }

  // ── GET /api/calls ──
  if (req.method === 'GET' && pathname === '/api/calls') {
    const payload = verifyToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('calls')
        .select('*')
        .eq('client_id', payload.client_id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return sendJSON(res, 200, { calls: data || [] });
    } catch (e) {
      console.error('Get calls error:', e.message);
      return sendJSON(res, 500, { error: 'Internal error' });
    }
  }

  // ── POST /api/push/subscribe ──
  if (req.method === 'POST' && pathname === '/api/push/subscribe') {
    const payload = verifyToken(req);
    if (!payload) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await parseBody(req);
    const { subscription } = body;
    if (!subscription || !subscription.endpoint) {
      return sendJSON(res, 400, { error: 'subscription.endpoint erforderlich' });
    }
    try {
      const sb = getSupabase();
      // Upsert: replace existing subscription for same endpoint
      await sb.from('push_subscriptions').delete().eq('client_id', payload.client_id).eq('endpoint', subscription.endpoint);
      const { error } = await sb.from('push_subscriptions').insert([{
        client_id: payload.client_id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys?.p256dh || null,
        auth: subscription.keys?.auth || null
      }]);
      if (error) throw error;
      return sendJSON(res, 200, { success: true });
    } catch (e) {
      console.error('Push subscribe error:', e.message);
      return sendJSON(res, 500, { error: 'Internal error' });
    }
  }

  // ── POST /api/calls/webhook ──
  if (req.method === 'POST' && pathname === '/api/calls/webhook') {
    const body = await parseBody(req);
    try {
      const sb = getSupabase();
      // Map Bland.ai webhook fields to our schema
      const clientId = body.client_id || body.metadata?.client_id || null;
      const callRecord = {
        client_id: clientId,
        caller_number: body.from || body.caller || body.phone_number || null,
        call_type: body.call_type || body.metadata?.call_type || 'inquiry',
        summary: body.summary || body.variables?.summary || null,
        transcript: body.concatenated_transcript || body.transcript || null,
        duration_seconds: body.call_length ? Math.round(body.call_length) : null,
        details: body
      };
      const { error } = await sb.from('calls').insert([callRecord]);
      if (error) throw error;

      // ── Push Notification an den Client senden ──
      if (clientId) {
        try {
          const { data: subs } = await sb
            .from('push_subscriptions')
            .select('*')
            .eq('client_id', clientId);

          if (subs && subs.length > 0) {
            const wp = getWebPush();
            const callerNumber = callRecord.caller_number || 'Unbekannte Nummer';
            const notifPayload = JSON.stringify({
              title: 'Neuer Anruf 📞',
              body: callRecord.summary
                ? callRecord.summary.slice(0, 120)
                : `Anruf von ${callerNumber}`
            });

            await Promise.allSettled(
              subs.map(sub => {
                const pushSub = {
                  endpoint: sub.endpoint,
                  keys: { p256dh: sub.p256dh, auth: sub.auth }
                };
                return wp.sendNotification(pushSub, notifPayload).catch(err => {
                  console.warn('[Push] Senden fehlgeschlagen:', err.statusCode, sub.endpoint.slice(0, 60));
                  // Remove invalid subscriptions (410 = Gone)
                  if (err.statusCode === 410) {
                    return sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
                  }
                });
              })
            );
          }
        } catch (pushErr) {
          console.warn('[Push] Notification error:', pushErr.message);
          // Don't fail the webhook because of push errors
        }
      }

      return sendJSON(res, 200, { success: true });
    } catch (e) {
      console.error('Webhook error:', e.message);
      return sendJSON(res, 500, { error: 'Internal error' });
    }
  }

  // ── POST /api/admin/customers ──
  if (req.method === 'POST' && pathname === '/api/admin/customers') {
    if (!requireAdminKey(req, res)) return;
    const body = await parseBody(req);
    const { username, password, business_name, business_type } = body;
    if (!username || !password || !business_name) {
      return sendJSON(res, 400, { error: 'username, password, business_name required' });
    }
    try {
      const password_hash = await getBcrypt().hash(password, 12);
      const sb = getSupabase();
      const { data, error } = await sb.from('clients').insert([{
        username, password_hash, business_name, business_type: business_type || 'Sonstiges'
      }]).select().single();
      if (error) throw error;
      return sendJSON(res, 201, { success: true, client: { id: data.id, username, business_name } });
    } catch (e) {
      console.error('Create customer error:', e.message);
      if (e.code === '23505') return sendJSON(res, 409, { error: 'Username already exists' });
      return sendJSON(res, 500, { error: 'Internal error' });
    }
  }

  // ── GET /api/admin/customers ──
  if (req.method === 'GET' && pathname === '/api/admin/customers') {
    if (!requireAdminKey(req, res)) return;
    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('clients')
        .select('id, username, business_name, business_type, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return sendJSON(res, 200, { customers: data || [] });
    } catch (e) {
      console.error('List customers error:', e.message);
      return sendJSON(res, 500, { error: 'Internal error' });
    }
  }

  // ── DELETE /api/admin/customers/:id ──
  if (req.method === 'DELETE' && pathname.startsWith('/api/admin/customers/')) {
    if (!requireAdminKey(req, res)) return;
    const clientId = pathname.split('/').pop();
    try {
      const sb = getSupabase();
      const { error } = await sb.from('clients').delete().eq('id', clientId);
      if (error) throw error;
      return sendJSON(res, 200, { success: true });
    } catch (e) {
      console.error('Delete customer error:', e.message);
      return sendJSON(res, 500, { error: 'Internal error' });
    }
  }

  // ── GET /api/calendar/slots ──
  if (req.method === 'GET' && pathname === '/api/calendar/slots') {
    const date = urlObj.searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return sendJSON(res, 400, { error: 'Parameter "date" im Format YYYY-MM-DD erforderlich' });
    }
    const apiKey = urlObj.searchParams.get('calcom_api_key') || '';
    const eventTypeId = urlObj.searchParams.get('event_type_id') || '';

    let slots;
    if (apiKey && eventTypeId) {
      slots = await getRealSlots(date, apiKey, eventTypeId);
    } else {
      slots = getDemoSlots(date);
    }
    return sendJSON(res, 200, { slots, date, mode: (apiKey ? 'live' : 'demo') });
  }

  // ── POST /api/calendar/book ──
  if (req.method === 'POST' && pathname === '/api/calendar/book') {
    const body = await parseBody(req);
    const { name, phone, date, time, service, calcom_api_key, event_type_id } = body;

    if (!name || !phone || !date || !time || !service) {
      return sendJSON(res, 400, { error: 'Fehlende Felder: name, phone, date, time, service sind Pflicht' });
    }

    let result;
    if (calcom_api_key && event_type_id) {
      result = await bookReal(body);
    } else {
      result = await bookDemo(body);
    }
    return sendJSON(res, 200, result);
  }

  // ── GET /api/calendar/config ──
  if (req.method === 'GET' && pathname === '/api/calendar/config') {
    const config = readJSON(CALENDAR_CONFIG_FILE) || {};
    return sendJSON(res, 200, {
      mode: config.calcom_api_key ? 'live' : 'demo',
      business_name: config.business_name || 'Unbekannt',
      timezone: config.timezone || 'Europe/Berlin',
      has_api_key: !!(config.calcom_api_key),
      has_event_type: !!(config.event_type_id),
      calcom_configured: !!(config.calcom_api_key && config.event_type_id)
    });
  }

  // ── Statische Dateien ──
  if (req.method === 'GET') {
    let file = pathname === '/' ? '/index.html' : pathname;
    const fp = path.join(__dirname, file);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp);
      const ct = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' }[ext] || 'text/plain';
      res.writeHead(200, {'Content-Type': ct});
      fs.createReadStream(fp).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // ── POST /api (Anthropic Proxy) ──
  if (req.method === 'POST' && pathname === '/api') {
    const body = await parseBody(req);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      }
    };
    const proxy = https.request(options, r => {
      let data = '';
      r.on('data', d => data += d);
      r.on('end', () => {
        res.writeHead(r.statusCode, {'Content-Type':'application/json'});
        res.end(data);
      });
    });
    proxy.on('error', e => { res.writeHead(500); res.end(JSON.stringify({error:e.message})); });
    const bodyStr = JSON.stringify(body);
    proxy.write(bodyStr);
    proxy.end();
    return;
  }

  res.writeHead(404); res.end();
}).listen(PORT, () => {
  console.log(`\n✅ Xypher läuft auf http://localhost:${PORT}`);
  console.log(`📅 Kalender-API: http://localhost:${PORT}/api/calendar/config`);
  console.log(`   Slots:        GET  /api/calendar/slots?date=YYYY-MM-DD`);
  console.log(`   Buchen:       POST /api/calendar/book\n`);
  require('child_process').exec(`open http://localhost:${PORT}`);
});

// ─────────────────────────────────────────────────────────────
// Xypher Service Worker — PWA + Push Notifications
// ─────────────────────────────────────────────────────────────

const CACHE_NAME = 'xypher-v1';
const STATIC_ASSETS = [
  '/login.html',
  '/dashboard.html',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// ── Install: cache static assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Einige Assets konnten nicht gecacht werden:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache, fallback to network ──
self.addEventListener('fetch', event => {
  // Only handle GET requests for same-origin
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache new static file responses
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML pages
        if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/login.html');
        }
      });
    })
  );
});

// ── Push: show notification ──
self.addEventListener('push', event => {
  let data = { title: 'Neuer Anruf 📞', body: 'Ein neuer Anruf ist eingegangen.' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || 'Neuer Anruf eingegangen.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'xypher-call',
    renotify: true,
    requireInteraction: false,
    data: { url: '/dashboard.html' },
    actions: [
      { action: 'open', title: 'Dashboard öffnen' },
      { action: 'close', title: 'Schließen' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Neuer Anruf 📞', options)
  );
});

// ── Notification click: focus or open dashboard ──
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'close') return;

  const targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Try to find an existing dashboard window
      for (const client of windowClients) {
        if (client.url.includes('dashboard') && 'focus' in client) {
          return client.focus();
        }
      }
      // No existing window — open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

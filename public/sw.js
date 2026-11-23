// NOTE: All Aboard's service worker. It keeps a copy of the app so bot games
// open offline, and shows Web Push notices from the game server.
// Network first for everything, so an online visit always gets the latest
// build; the cache is only the offline fallback. The game API is never cached.

const CACHE = 'all-aboard-v1'
const SHELL = '/'

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.add(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys.filter(key => key !== CACHE).map(key => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

const isCacheable = url =>
  url.origin === self.location.origin &&
  !url.pathname.startsWith('/api/') &&
  !url.pathname.startsWith('/@') &&
  !url.pathname.startsWith('/node_modules/.vite/')

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || !isCacheable(url)) {
    return
  }
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) {
          return cached
        }
        if (request.mode === 'navigate') {
          const shell = await caches.match(SHELL)
          if (shell) {
            return shell
          }
        }
        return Response.error()
      }),
  )
})

self.addEventListener('push', event => {
  const notice = (() => {
    try {
      return event.data ? event.data.json() : null
    } catch {
      return null
    }
  })()
  if (!notice) {
    return
  }
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: notice.url },
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(
    event.notification.data?.url ?? '/',
    self.location.origin,
  ).href
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(windows => {
        const open = windows.find(client => client.url === target) ?? windows[0]
        if (open) {
          return open
            .focus()
            .then(client =>
              client.url === target ? client : client.navigate(target),
            )
        }
        return self.clients.openWindow(target)
      }),
  )
})

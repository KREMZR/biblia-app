/*
 * sw.js — Service worker: stores the whole app and the whole Bible on the
 * device at install time, so everything works without internet.
 *
 * Strategy: cache-first for everything (the content never changes between
 * versions). When CONFIG.version changes, a new cache is built and the old
 * one deleted.
 */
/* global BIBLIA_CONFIG, BibliaBooks */
importScripts('js/config.js', 'js/books.js');

var T = BIBLIA_CONFIG.translation;
var CACHE = 'biblia-' + BIBLIA_CONFIG.version + '-' + T;

var APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/config.js',
  'js/books.js',
  'js/parser.js',
  'js/app.js',
  'fonts/atkinson-hyperlegible-latin-400-normal.woff2',
  'fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  'fonts/literata-latin-400-normal.woff2',
  'fonts/literata-latin-700-normal.woff2',
  'icons/icon.svg',
  'icons/icon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

var BIBLE = ['data/' + T + '/meta.json'].concat(
  BibliaBooks.list.map(function (b) { return 'data/' + T + '/' + b.id + '.json'; })
);

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // App shell must succeed; book files are added one by one so a single
      // network hiccup doesn't throw the whole install away.
      return cache.addAll(APP_SHELL).then(function () {
        return Promise.all(BIBLE.map(function (url) {
          return cache.add(url).catch(function () { /* fetched later on demand */ });
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('biblia-') === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // Keep a copy of anything else we fetch from our own site.
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // Offline and not cached: page navigations fall back to the app.
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});

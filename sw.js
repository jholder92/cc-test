// Offline shell + plan cache. The cache name is derived from meta.version inside
// valencia-plan.json itself, so editing the plan and bumping that version is the
// only thing needed to invalidate old caches — this file does not need touching.

const CACHE_PREFIX = "valencia-";
const PLAN_URL = "./valencia-plan.json";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

async function currentCacheName() {
  try {
    const res = await fetch(PLAN_URL, { cache: "no-store" });
    const data = await res.json();
    const version = (data.meta && data.meta.version) || "unversioned";
    return { name: CACHE_PREFIX + version, planResponse: res.clone() };
  } catch {
    return { name: CACHE_PREFIX + "unversioned", planResponse: null };
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const { name, planResponse } = await currentCacheName();
      const cache = await caches.open(name);
      await cache.addAll(SHELL_FILES);
      if (planResponse) await cache.put(PLAN_URL, planResponse);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const { name: keep } = await currentCacheName();
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith(CACHE_PREFIX) && n !== keep)
          .map((n) => caches.delete(n))
      );
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const isPlan = req.url.endsWith("valencia-plan.json");

  if (isPlan) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req, { cache: "no-store" });
    const { name } = await currentCacheName();
    const cache = await caches.open(name);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw new Error("offline and no cached plan");
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    const { name } = await currentCacheName();
    const cache = await caches.open(name);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    if (req.mode === "navigate") {
      const fallback = await caches.match("./index.html");
      if (fallback) return fallback;
    }
    throw new Error("offline and not cached");
  }
}

export function serviceWorkerSource(version, precache) {
  return `const CACHE=${JSON.stringify(`ludo-${version}`)};const ASSETS=${JSON.stringify(precache)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ludo-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/socket.io/'))return;
 if(request.mode==='navigate'){const fallback=async()=>await caches.match(url.pathname)||await caches.match('/');event.respondWith(fetch(request).then(response=>response.ok?response:fallback()).catch(fallback));return;}
 if(ASSETS.includes(url.pathname)||url.pathname.startsWith('/assets/'))event.respondWith(caches.match(request,{ignoreSearch:ASSETS.includes(url.pathname)}).then(hit=>hit||fetch(request).then(response=>{if(response.ok){const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;})));
});
`;
}

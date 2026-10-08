const CACHE='contractordesk-shell-client-layout-v7';
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/'])));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('contractordesk-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.search||url.pathname.startsWith('/api/')||url.pathname.startsWith('/__/')||request.headers.get('authorization'))return;
  const shell=request.mode==='navigate'&&url.pathname==='/';
  const asset=/\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)&&url.pathname!=='/service-worker.js';
  if(!shell&&!asset)return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(shell?'/':request,copy)));}
    return response;
  }).catch(async()=>{
    const cached=await caches.match(shell?'/':request);
    if(cached)return cached;
    throw new Error('No offline app shell or public asset is available');
  }));
});
self.addEventListener('message',event=>{
  if(event.data==='skipWaiting')event.waitUntil(self.skipWaiting());
});

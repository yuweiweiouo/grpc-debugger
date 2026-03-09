(()=>{function D(e){let t=e.request?.postData?.mimeType||"",s=e.response?.content?.mimeType||"";return t.includes("grpc-web")||t.includes("application/grpc")||s.includes("grpc-web")||s.includes("application/grpc")}function v(e){try{let t=new URL(e),s=t.pathname.split("/").filter(Boolean);return s.length>=2?"/"+s.join("/"):t.pathname}catch{return e}}function w(e){let t={};for(let s of e||[])t[s.name.toLowerCase()]=s.value;return t}function S(e){let t=e["grpc-status"],s=e["grpc-message"];return{code:t?parseInt(t,10):null,message:s?decodeURIComponent(s):null}}var h=[],p=null,m=!1,o=new Map;function R(e){try{return new URL(e).pathname.replace(/\/$/,"")}catch{return typeof e=="string"?e.split("?")[0].split("#")[0].replace(/\/$/,""):e}}chrome.runtime.onMessage.addListener(e=>{if(e.type==="__GRPCWEB_DEVTOOLS__"&&e.action==="capturedRequestBody"){let t=e.path||R(e.url),s="ghost-"+Math.random().toString(36).substring(2,9),n=e.requestHash||"no-hash";console.log(`[gRPC Debugger v2.24] \u{1F47B} Ghost Intercepted: ${t} [ID: ${s}]`),o.has(t)||o.set(t,[]);let r={id:s,requestHash:n,bodyBase64:e.bodyBase64,timestamp:e.timestamp||Date.now(),url:e.url};o.get(t).push(r);let a=Date.now();for(let[u,d]of o.entries()){let i=d.filter(_=>a-_.timestamp<U);i.length===0?o.delete(u):o.set(u,i)}}});var G=300,b=30,y=100,U=6e4;function T(){chrome.devtools.inspectedWindow.eval(`
    (function() {
      if (window.__GRPC_DEBUGGER_LISTENER_INJECTED__) return;
      window.__GRPC_DEBUGGER_LISTENER_INJECTED__ = true;
      window.__GRPC_CALLS_QUEUE__ = [];
      
      window.addEventListener('message', function(event) {
        if (event.source !== window) return;
        var msg = event.data;
        if (msg && msg.type === '__GRPCWEB_DEVTOOLS__' && msg.action === 'gRPCNetworkCall') {
          window.__GRPC_CALLS_QUEUE__.push({
            method: msg.method || '',
            methodType: msg.methodType || 'unary',
            request: msg.request || null,
            response: msg.response || null,
            error: msg.error || null,
            timestamp: Date.now()
          });
        }
      });
    })();
  `)}T();chrome.devtools.network.onNavigated.addListener(()=>{T()});function P(){chrome.devtools.inspectedWindow.eval(`(function() {
      var q = window.__GRPC_CALLS_QUEUE__;
      if (!q || q.length === 0) return '[]';
      window.__GRPC_CALLS_QUEUE__ = [];
      return JSON.stringify(q);
    })()`,(e,t)=>{if(!(t||!e))try{let s=JSON.parse(e);for(let n of s){let r=n.method?.startsWith("/")?n.method:`/${n.method||""}`,a=r.split("/"),u=a.pop()||a.pop(),d={id:`interceptor-${n.timestamp||Date.now()}-${Math.random().toString(36).slice(2,7)}`,method:r,endpoint:u,methodType:n.methodType||"unary",request:n.request,response:n.error?{_error:n.error.message||String(n.error),_code:n.error.code}:n.response,error:n.error||null,status:"finished",startTime:(n.timestamp||Date.now())/1e3,_source:"interceptor"};p?.dispatchGrpcEvent?p.dispatchGrpcEvent(d):h.push(d)}}catch{}})}setInterval(P,G);function I(e){let t=v(e.request.url),s=t.split("/"),n=s.pop()||s.pop(),r=w(e.response.headers),a=S(r);e.getContent(async(u,d)=>{let i=R(e.request.url),_=new Date(e.startedDateTime).getTime(),c=null,g=0;for(;g<b;){let l=o.get(i);if(l&&l.length>0){c=l.shift(),l.length===0&&o.delete(i);break}if(!e.request.postData)break;await new Promise(L=>setTimeout(L,y)),g++}let C=c?.bodyBase64||e.request.postData?.text||null,q=!!c?.bodyBase64;c?console.log(`[gRPC Debugger v2.24] \u2705 Ghost Matched (FIFO): ${i} [ID: ${c.id}]`):e.request.postData?.text&&console.warn(`[gRPC Debugger v2.24] \u274C Ghost Missed: ${i}`);let f={id:c?.id||e.startedDateTime+"_"+e.request.url,method:t,endpoint:n,methodType:"unary",url:e.request.url,startTime:_/1e3,duration:e.time,size:e.response.bodySize,httpStatus:e.response.status,requestHeaders:w(e.request.headers),responseHeaders:r,grpcStatus:a.code,grpcMessage:a.message,requestRaw:C,requestBase64Encoded:q,responseRaw:u,responseBase64Encoded:d==="base64",status:"finished",_isUpdate:!!c};m&&p?.dispatchGrpcEvent?p.dispatchGrpcEvent(f):h.push(f)})}function E(){if(p?.dispatchGrpcEvent)for(;h.length>0;){let e=h.shift();p.dispatchGrpcEvent(e)}}chrome.devtools.panels.create("gRPC Debugger","launchericon-48-48.png","index.html",e=>{e.onShown.addListener(t=>{p=t,m?E():(m=!0,setTimeout(E,100))}),e.onHidden.addListener(()=>{})});chrome.devtools.network.onRequestFinished.addListener(e=>{D(e)&&I(e)});})();

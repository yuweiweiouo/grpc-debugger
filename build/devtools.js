(()=>{var m="__GRPC_DEBUGGER_EMPTY__";function w(e){if(!e||e===m)return[];let t=JSON.parse(e);return Array.isArray(t)?t:[]}function T({hadCalls:e,currentDelayMs:t,baseDelayMs:n=300,maxDelayMs:r=2400}){if(e)return n;let s=Math.max(t||n,n)*2;return Math.min(s,r)}function y(e){let t=e.request?.postData?.mimeType||"",n=e.response?.content?.mimeType||"";return t.includes("grpc-web")||t.includes("application/grpc")||n.includes("grpc-web")||n.includes("application/grpc")}function A(e){try{let t=new URL(e),n=t.pathname.split("/").filter(Boolean);return n.length>=2?"/"+n.join("/"):t.pathname}catch{return e}}function R(e){let t={};for(let n of e||[])t[n.name.toLowerCase()]=n.value;return t}function I(e){let t=e["grpc-status"],n=e["grpc-message"];return{code:t?parseInt(t,10):null,message:n?decodeURIComponent(n):null}}var _=[],l=null,E=!1,f=300,a=new Map;function S(e){try{return new URL(e).pathname.replace(/\/$/,"")}catch{return typeof e=="string"?e.split("?")[0].split("#")[0].replace(/\/$/,""):e}}chrome.runtime.onMessage.addListener(e=>{if(e.type==="__GRPCWEB_DEVTOOLS__"&&e.action==="capturedRequestBody"){let t=e.path||S(e.url),n="ghost-"+Math.random().toString(36).substring(2,9),r=e.requestHash||"no-hash";console.log(`[gRPC Debugger v2.24] \u{1F47B} Ghost Intercepted: ${t} [ID: ${n}]`),a.has(t)||a.set(t,[]);let s={id:n,requestHash:r,bodyBase64:e.bodyBase64,timestamp:e.timestamp||Date.now(),url:e.url};a.get(t).push(s);let i=Date.now();for(let[c,u]of a.entries()){let o=u.filter(h=>i-h.timestamp<B);o.length===0?a.delete(c):a.set(c,o)}}});var U=30,O=100,B=6e4;function P(e=f){setTimeout(b,e)}function D(){chrome.devtools.inspectedWindow.eval(`
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
  `)}D();chrome.devtools.network.onNavigated.addListener(()=>{D()});function b(){chrome.devtools.inspectedWindow.eval(`(function() {
       var q = window.__GRPC_CALLS_QUEUE__;
       if (!q || q.length === 0) return '${m}';
       window.__GRPC_CALLS_QUEUE__ = [];
       return JSON.stringify(q);
     })()`,(e,t)=>{let n=!1;try{let r=t?[]:w(e);n=r.length>0;for(let s of r){let i=s.method?.startsWith("/")?s.method:`/${s.method||""}`,c=i.split("/"),u=c.pop()||c.pop(),o={id:`interceptor-${s.timestamp||Date.now()}-${Math.random().toString(36).slice(2,7)}`,method:i,endpoint:u,methodType:s.methodType||"unary",request:s.request,response:s.error?{_error:s.error.message||String(s.error),_code:s.error.code}:s.response,error:s.error||null,status:"finished",startTime:(s.timestamp||Date.now())/1e3,_source:"interceptor"};l?.dispatchGrpcEvent?l.dispatchGrpcEvent(o):_.push(o)}}catch{}finally{f=T({hadCalls:n,currentDelayMs:f}),P()}})}P();function N(e){let t=A(e.request.url),n=t.split("/"),r=n.pop()||n.pop(),s=R(e.response.headers),i=I(s);e.getContent(async(c,u)=>{let o=S(e.request.url),h=new Date(e.startedDateTime).getTime(),p=null,g=0;for(;g<U;){let d=a.get(o);if(d&&d.length>0){p=d.shift(),d.length===0&&a.delete(o);break}if(!e.request.postData)break;await new Promise(M=>setTimeout(M,O)),g++}let q=p?.bodyBase64||e.request.postData?.text||null,G=!!p?.bodyBase64;p?console.log(`[gRPC Debugger v2.24] \u2705 Ghost Matched (FIFO): ${o} [ID: ${p.id}]`):e.request.postData?.text&&console.warn(`[gRPC Debugger v2.24] \u274C Ghost Missed: ${o}`);let L={id:p?.id||e.startedDateTime+"_"+e.request.url,method:t,endpoint:r,methodType:"unary",url:e.request.url,startTime:h/1e3,duration:e.time,size:e.response.bodySize,httpStatus:e.response.status,requestHeaders:R(e.request.headers),responseHeaders:s,grpcStatus:i.code,grpcMessage:i.message,requestRaw:q,requestBase64Encoded:G,responseRaw:c,responseBase64Encoded:u==="base64",status:"finished",_isUpdate:!!p};E&&l?.dispatchGrpcEvent?l.dispatchGrpcEvent(L):_.push(L)})}function C(){if(l?.dispatchGrpcEvent)for(;_.length>0;){let e=_.shift();l.dispatchGrpcEvent(e)}}chrome.devtools.panels.create("gRPC Debugger","launchericon-48-48.png","index.html",e=>{e.onShown.addListener(t=>{l=t,E?C():(E=!0,setTimeout(C,100))}),e.onHidden.addListener(()=>{})});chrome.devtools.network.onRequestFinished.addListener(e=>{y(e)&&N(e)});})();

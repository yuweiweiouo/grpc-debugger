(()=>{var E="__GRPC_DEBUGGER_EMPTY__";function w(e){if(!e||e===E)return[];let t=JSON.parse(e);return Array.isArray(t)?t:[]}function R({hadCalls:e,currentDelayMs:t,baseDelayMs:n=300,maxDelayMs:r=2400}){if(e)return n;let o=Math.max(t||n,n)*2;return Math.min(o,r)}var T="__GRPCWEB_CALL_QUEUE_MANAGED__";function v(e){let t=e.request?.postData?.mimeType||"",n=e.response?.content?.mimeType||"";return t.includes("grpc-web")||t.includes("application/grpc")||n.includes("grpc-web")||n.includes("application/grpc")}function y(e){try{let t=new URL(e),n=t.pathname.split("/").filter(Boolean);return n.length>=2?"/"+n.join("/"):t.pathname}catch{return e}}function C(e){let t={};for(let n of e||[])t[n.name.toLowerCase()]=n.value;return t}function I(e){let t=e["grpc-status"],n=e["grpc-message"];return{code:t?parseInt(t,10):null,message:n?decodeURIComponent(n):null}}var _=[],p=null,m=!1,f=300,a=new Map;function G(e){try{return new URL(e).pathname.replace(/\/$/,"")}catch{return typeof e=="string"?e.split("?")[0].split("#")[0].replace(/\/$/,""):e}}chrome.runtime.onMessage.addListener(e=>{if(e.type==="__GRPCWEB_DEVTOOLS__"&&e.action==="capturedRequestBody"){let t=e.path||G(e.url),n="ghost-"+Math.random().toString(36).substring(2,9),r=e.requestHash||"no-hash";console.log(`[gRPC Debugger v2.24] \u{1F47B} Ghost Intercepted: ${t} [ID: ${n}]`),a.has(t)||a.set(t,[]);let o={id:n,requestHash:r,bodyBase64:e.bodyBase64,timestamp:e.timestamp||Date.now(),url:e.url};a.get(t).push(o);let i=Date.now();for(let[c,u]of a.entries()){let s=u.filter(h=>i-h.timestamp<O);s.length===0?a.delete(c):a.set(c,s)}}});var N=30,B=100,O=6e4;function P(e=f){setTimeout(b,e)}function S(){chrome.devtools.inspectedWindow.eval(`
    (function() {
      if (window.__GRPC_DEBUGGER_LISTENER_INJECTED__) return;
      if (window['${T}']) {
        window.__GRPC_DEBUGGER_LISTENER_INJECTED__ = true;
        return;
      }
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
  `)}S();chrome.devtools.network.onNavigated.addListener(()=>{S()});function b(){chrome.devtools.inspectedWindow.eval(`(function() {
       var q = window.__GRPC_CALLS_QUEUE__;
       if (!q || q.length === 0) return '${E}';
       window.__GRPC_CALLS_QUEUE__ = [];
       return JSON.stringify(q);
     })()`,(e,t)=>{let n=!1;try{let r=t?[]:w(e);n=r.length>0;for(let o of r){let i=o.method?.startsWith("/")?o.method:`/${o.method||""}`,c=i.split("/"),u=c.pop()||c.pop(),s={id:`interceptor-${o.timestamp||Date.now()}-${Math.random().toString(36).slice(2,7)}`,method:i,endpoint:u,methodType:o.methodType||"unary",request:o.request,response:o.error?{_error:o.error.message||String(o.error),_code:o.error.code}:o.response,error:o.error||null,status:"finished",startTime:(o.timestamp||Date.now())/1e3,_source:"interceptor"};p?.dispatchGrpcEvent?p.dispatchGrpcEvent(s):_.push(s)}}catch{}finally{f=R({hadCalls:n,currentDelayMs:f}),P()}})}P();function x(e){let t=y(e.request.url),n=t.split("/"),r=n.pop()||n.pop(),o=C(e.response.headers),i=I(o);e.getContent(async(c,u)=>{let s=G(e.request.url),h=new Date(e.startedDateTime).getTime(),l=null,g=0;for(;g<N;){let d=a.get(s);if(d&&d.length>0){l=d.shift(),d.length===0&&a.delete(s);break}if(!e.request.postData)break;await new Promise(U=>setTimeout(U,B)),g++}let A=l?.bodyBase64||e.request.postData?.text||null,M=!!l?.bodyBase64;l?console.log(`[gRPC Debugger v2.24] \u2705 Ghost Matched (FIFO): ${s} [ID: ${l.id}]`):e.request.postData?.text&&console.warn(`[gRPC Debugger v2.24] \u274C Ghost Missed: ${s}`);let L={id:l?.id||e.startedDateTime+"_"+e.request.url,method:t,endpoint:r,methodType:"unary",url:e.request.url,startTime:h/1e3,duration:e.time,size:e.response.bodySize,httpStatus:e.response.status,requestHeaders:C(e.request.headers),responseHeaders:o,grpcStatus:i.code,grpcMessage:i.message,requestRaw:A,requestBase64Encoded:M,responseRaw:c,responseBase64Encoded:u==="base64",status:"finished",_isUpdate:!!l};m&&p?.dispatchGrpcEvent?p.dispatchGrpcEvent(L):_.push(L)})}function D(){if(p?.dispatchGrpcEvent)for(;_.length>0;){let e=_.shift();p.dispatchGrpcEvent(e)}}chrome.devtools.panels.create("gRPC Debugger","launchericon-48-48.png","index.html",e=>{e.onShown.addListener(t=>{p=t,m?D():(m=!0,setTimeout(D,100))}),e.onHidden.addListener(()=>{})});chrome.devtools.network.onRequestFinished.addListener(e=>{v(e)&&x(e)});})();

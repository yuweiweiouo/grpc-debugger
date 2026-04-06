(()=>{var s="__GRPC_DEBUGGER_EMPTY__";function u(e){if(!e||e===s)return[];let t=JSON.parse(e);return Array.isArray(t)?t:[]}function E({hadCalls:e,currentDelayMs:t,baseDelayMs:l=60,maxDelayMs:c=600}){if(e)return l;let i=Math.max(t||l,l)*2;return Math.min(i,c)}var r=[],o=[],p=1e3,n=null,d=60,a=null;function _(e=d){setTimeout(S,e)}function h(e=50){a===null&&(a=setTimeout(()=>{a=null,v(),n&&(r.length>0||o.length>0)&&h()},e))}function f(e,t){e.push(t),e.length>p&&e.splice(0,e.length-Math.floor(p/2)),h()}function P(e){if(n?.dispatchGrpcEvent){n.dispatchGrpcEvent(e);return}f(r,e)}function g(e){if(n?.dispatchSchemaEvent){n.dispatchSchemaEvent(e);return}f(o,e)}function v(){if(!(!n||!n.dispatchGrpcEvent||!n.dispatchSchemaEvent)){for(;o.length>0&&n.dispatchSchemaEvent;)n.dispatchSchemaEvent(o.shift());for(;r.length>0&&n.dispatchGrpcEvent;)n.dispatchGrpcEvent(r.shift())}}function S(){chrome.devtools.inspectedWindow.eval(`(function() {
      var queue = window.__GRPC_DEBUGGER_EVENT_QUEUE__;
      if (!Array.isArray(queue) || queue.length === 0) {
        return '${s}';
      }

      var events = queue.slice();
      queue.splice(0, queue.length);
      return JSON.stringify(events);
    })()`,(e,t)=>{let l=!1;try{let c=t?[]:u(e);l=c.length>0;for(let i of c){if(i?.kind==="schema"&&i.data){g(i.data);continue}i?.kind==="call"&&i.data&&P(i.data)}}finally{d=E({hadCalls:l,currentDelayMs:d}),_()}})}_();chrome.devtools.panels.create("gRPC Debugger","launchericon-48-48.png","index.html",e=>{e.onShown.addListener(t=>{n=t,h(0)}),e.onHidden?.addListener&&e.onHidden.addListener(()=>{n=null})});})();

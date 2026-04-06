(()=>{var l="__GRPC_DEBUGGER_EMPTY__";function f(e){if(!e||e===l)return{pageHref:"",events:[]};let t=JSON.parse(e);return Array.isArray(t)?{pageHref:"",events:t}:{pageHref:typeof t?.pageHref=="string"?t.pageHref:"",events:Array.isArray(t?.events)?t.events:[]}}function p({hadCalls:e,currentDelayMs:t,baseDelayMs:r=60,maxDelayMs:a=600}){if(e)return r;let s=Math.max(t||r,r)*2;return Math.min(s,a)}var o=[],c=[],E=1e3,n=null,h=60,d=null;function _(e=h){setTimeout(y,e)}function u(e=50){d===null&&(d=setTimeout(()=>{d=null,A(),n&&(o.length>0||c.length>0)&&u()},e))}function g(e,t){e.push(t),e.length>E&&e.splice(0,e.length-Math.floor(E/2)),u()}function P(e){if(n?.dispatchGrpcEvent){n.dispatchGrpcEvent(e);return}g(o,e)}function L(e){if(n?.dispatchSchemaEvent){n.dispatchSchemaEvent(e);return}g(c,e)}function m(e){n?.dispatchPageContext&&typeof e=="string"&&e&&n.dispatchPageContext({pageHref:e})}function S(e,t){let r=typeof e?._debugFrameHref=="string"?e._debugFrameHref:"";return!t||!r?!0:r===t}function A(){if(!(!n||!n.dispatchGrpcEvent||!n.dispatchSchemaEvent)){for(;c.length>0&&n.dispatchSchemaEvent;)n.dispatchSchemaEvent(c.shift());for(;o.length>0&&n.dispatchGrpcEvent;)n.dispatchGrpcEvent(o.shift())}}function y(){chrome.devtools.inspectedWindow.eval(`(function() {
      var queue = window.__GRPC_DEBUGGER_EVENT_QUEUE__;
      if (!Array.isArray(queue) || queue.length === 0) {
        return '${l}';
      }

      var pageHref = window.location.href || '';
      var events = queue.slice();
      queue.splice(0, queue.length);
      return JSON.stringify({ pageHref: pageHref, events: events });
    })()`,(e,t)=>{let r=!1;try{let{pageHref:a,events:s}=t?{pageHref:"",events:[]}:f(e);r=s.length>0,m(a);for(let i of s){if(i?.kind==="schema"&&i.data){L(i.data);continue}i?.kind==="call"&&i.data&&S(i.data,a)&&P(i.data)}}finally{h=p({hadCalls:r,currentDelayMs:h}),_()}})}_();chrome.devtools.panels.create("gRPC Debugger","launchericon-48-48.png","index.html",e=>{e.onShown.addListener(t=>{n=t,u(0)}),e.onHidden?.addListener&&e.onHidden.addListener(()=>{n=null})});})();

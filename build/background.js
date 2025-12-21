/* global chrome */
// gRPC Debugger - Background Service Worker
// Automatic HTTP interception using chrome.debugger API

const connections = {};
const pendingRequests = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId || !connections[tabId]?.panel) return;

  // Relay registration messages to the panel
  connections[tabId].panel.postMessage(message);
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "panel" && port.name !== "content") {
    return;
  }

  const extensionListener = message => {
    const tabId = port.sender?.tab?.id >= 0 ? port.sender.tab.id : message.tabId;

    if (message.action === "init") {
      if (!connections[tabId]) {
        connections[tabId] = {};
      }
      connections[tabId][port.name] = port;

      if (port.name === "panel") {
        attachDebugger(tabId);
      }
      return;
    }

    if (message.target) {
      const conn = connections[tabId]?.[message.target];
      if (conn) {
        conn.postMessage(message);
      }
    }
  };

  port.onMessage.addListener(extensionListener);

  port.onDisconnect.addListener(disconnectedPort => {
    disconnectedPort.onMessage.removeListener(extensionListener);

    for (const tabId of Object.keys(connections)) {
      if (connections[tabId][disconnectedPort.name] === disconnectedPort) {
        delete connections[tabId][disconnectedPort.name];

        if (disconnectedPort.name === "panel") {
          detachDebugger(parseInt(tabId));
        }

        if (Object.keys(connections[tabId]).length === 0) {
          delete connections[tabId];
        }
        break;
      }
    }
  });
});

function attachDebugger(tabId) {
  chrome.debugger.attach({ tabId }, "1.3", () => {
    if (chrome.runtime.lastError) {
      console.warn("Failed to attach debugger:", chrome.runtime.lastError.message);
      return;
    }
    chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
  });
}

function detachDebugger(tabId) {
  chrome.debugger.detach({ tabId }, () => {
    if (chrome.runtime.lastError) {
      console.warn("Failed to detach debugger:", chrome.runtime.lastError.message);
    }
  });
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;

  if (method === "Network.requestWillBeSent") {
    handleRequestWillBeSent(tabId, params);
  } else if (method === "Network.responseReceived") {
    handleResponseReceived(tabId, params);
  } else if (method === "Network.loadingFinished") {
    handleLoadingFinished(tabId, params);
  } else if (method === "Network.loadingFailed") {
    handleLoadingFailed(tabId, params);
  }
});

function isGrpcWebRequest(headers) {
  const contentType = headers?.["content-type"] || headers?.["Content-Type"] || "";
  return contentType.includes("grpc-web") || contentType.includes("application/grpc");
}

function extractMethodFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      return "/" + pathParts.join("/");
    }
    return urlObj.pathname;
  } catch {
    return url;
  }
}

function handleRequestWillBeSent(tabId, params) {
  const { requestId, request, timestamp } = params;
  const { url, headers, postData } = request;

  if (!isGrpcWebRequest(headers)) {
    return;
  }

  const method = extractMethodFromUrl(url);
  const parts = method.split("/");
  const endpoint = parts.pop() || parts.pop();

  pendingRequests.set(requestId, {
    tabId,
    requestId,
    method,
    endpoint,
    url,
    startTime: timestamp,
    requestHeaders: headers,
    requestPostData: postData,
  });

  chrome.debugger.sendCommand(
    { tabId },
    "Network.getRequestPostData",
    { requestId },
    (response) => {
      if (response?.postData) {
        const pending = pendingRequests.get(requestId);
        if (pending) {
          pending.requestPostData = response.postData;
        }
      }
    }
  );
}

function handleResponseReceived(tabId, params) {
  const { requestId, response } = params;
  const pending = pendingRequests.get(requestId);

  if (!pending) {
    if (isGrpcWebRequest(response.headers)) {
      const method = extractMethodFromUrl(response.url);
      const parts = method.split("/");
      const endpoint = parts.pop() || parts.pop();

      pendingRequests.set(requestId, {
        tabId,
        requestId,
        method,
        endpoint,
        url: response.url,
        startTime: params.timestamp,
        requestHeaders: {},
      });
    } else {
      return;
    }
  }

  const req = pendingRequests.get(requestId);
  if (req) {
    req.httpStatus = response.status;
    req.responseHeaders = response.headers;
    req.mimeType = response.mimeType;
  }
}

function handleLoadingFinished(tabId, params) {
  const { requestId, timestamp, encodedDataLength } = params;
  const pending = pendingRequests.get(requestId);

  if (!pending) return;

  pending.endTime = timestamp;
  pending.duration = Math.round((timestamp - pending.startTime) * 1000);
  pending.size = encodedDataLength;

  chrome.debugger.sendCommand(
    { tabId },
    "Network.getResponseBody",
    { requestId },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Failed to get response body:", chrome.runtime.lastError.message);
        sendToPanel(tabId, pending, null);
        return;
      }

      sendToPanel(tabId, pending, response);
      pendingRequests.delete(requestId);
    }
  );
}

function handleLoadingFailed(tabId, params) {
  const { requestId, errorText, timestamp } = params;
  const pending = pendingRequests.get(requestId);

  if (!pending) return;

  pending.endTime = timestamp;
  pending.duration = Math.round((timestamp - pending.startTime) * 1000);
  pending.error = { message: errorText };

  sendToPanel(tabId, pending, null);
  pendingRequests.delete(requestId);
}

function sendToPanel(tabId, requestData, responseData) {
  const conn = connections[tabId]?.panel;
  if (!conn) return;

  const grpcStatus = parseGrpcStatus(requestData.responseHeaders);

  const message = {
    action: "gRPCNetworkCall",
    data: {
      id: requestData.requestId,
      method: requestData.method,
      endpoint: requestData.endpoint,
      methodType: "unary",
      url: requestData.url,
      startTime: requestData.startTime,
      endTime: requestData.endTime,
      duration: requestData.duration,
      size: requestData.size,
      httpStatus: requestData.httpStatus,
      requestHeaders: requestData.requestHeaders,
      responseHeaders: requestData.responseHeaders,
      grpcStatus: grpcStatus.code,
      grpcMessage: grpcStatus.message,
      requestRaw: requestData.requestPostData,
      responseRaw: responseData?.body,
      responseBase64Encoded: responseData?.base64Encoded,
      request: null,
      response: null,
      error: requestData.error,
    },
  };

  conn.postMessage(message);
}

function parseGrpcStatus(headers) {
  if (!headers) return { code: null, message: null };

  const grpcStatus = headers["grpc-status"] || headers["Grpc-Status"];
  const grpcMessage = headers["grpc-message"] || headers["Grpc-Message"];

  return {
    code: grpcStatus ? parseInt(grpcStatus, 10) : null,
    message: grpcMessage ? decodeURIComponent(grpcMessage) : null,
  };
}

chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`Debugger detached from tab ${source.tabId}: ${reason}`);
});

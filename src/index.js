/* global chrome */

import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import App from "./App";
import "./index.css";
import networkReducer, { networkLog, clearLog, reprocessLog } from "./state/network";
import toolbarReducer from "./state/toolbar";
import clipboardReducer from "./state/clipboard";
import schemaReducer, {
  setReflectionLoading,
  setReflectionSuccess,
  setReflectionFailed,
} from "./state/schema";
import schemaManager from "./lib/schema-manager";
import reflectionClient from "./lib/reflection-client";

let port, tabId;

async function initializeApp() {
  await schemaManager.initialize();

  if (typeof chrome !== "undefined" && chrome.devtools) {
    try {
      tabId = chrome.devtools.inspectedWindow.tabId;
      port = chrome.runtime.connect(null, { name: "panel" });
      port.postMessage({ tabId, action: "init" });
      port.onMessage.addListener(onMessageReceived);
      chrome.tabs.onUpdated.addListener(onTabUpdated);
    } catch (error) {
      console.warn("Not running app in chrome extension panel:", error);
    }
  }
}

const store = configureStore({
  reducer: {
    network: networkReducer,
    toolbar: toolbarReducer,
    clipboard: clipboardReducer,
    schema: schemaReducer,
  },
});

async function tryAutoReflection(url) {
  if (!url) return;

  try {
    const serverUrl = new URL(url).origin;

    if (schemaManager.reflectedServers.has(serverUrl)) return;
    schemaManager.reflectedServers.add(serverUrl);

    console.log("[Auto Reflection] Attempting for:", serverUrl);
    store.dispatch(setReflectionLoading(serverUrl));

    const result = await reflectionClient.fetchFromServer(serverUrl);

    if (result && (result.services.length > 0 || Object.keys(result.messages).length > 0)) {
      store.dispatch(
        setReflectionSuccess({
          server: serverUrl,
          services: result.services,
        })
      );

      const schema = {
        name: `reflection:${serverUrl}`,
        services: result.services,
        messages: result.messages,
      };
      schemaManager.schemas.set(schema.name, schema);
      schemaManager.buildServiceMap(schema);
      store.dispatch(reprocessLog());
    } else {
      store.dispatch(setReflectionFailed("No services found via Reflection"));
    }
  } catch (e) {
    store.dispatch(setReflectionFailed(e.message));
  }
}

function onMessageReceived({ action, data }) {
  if (action === "gRPCNetworkCall") {
    store.dispatch(networkLog(data));

    if (data.url) {
      tryAutoReflection(data.url);
    }
  }
}

function onTabUpdated(tId, { status }) {
  if (tId === tabId && status === "loading") {
    store.dispatch(clearLog());
    schemaManager.reflectedServers.clear();
  }
}

initializeApp();

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById("root")
);

export { store };


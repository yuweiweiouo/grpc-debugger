<script>
  /**
   * 應用程序主入口 (Main App Component)
   *
   * 負責組裝側邊欄、頂部工具欄以及主內容區域，
   * 並根據 activePage 狀態切換不同的視圖。
   */
  import { onMount, onDestroy } from "svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import NetworkList from "./components/NetworkList.svelte";
  import NetworkDetails from "./components/NetworkDetails.svelte";
  import ServicesView from "./components/ServicesView.svelte";
  import SettingsView from "./components/SettingsView.svelte";
  import { addLog, clearLogs } from "./stores/network";
  import { registerSchema } from "./stores/schema";
  import { activePage } from "./stores/ui";
  import { listPaneWidth } from "./stores/layout";
  import { theme } from "./stores/settings";
  import { t } from "./lib/i18n";

  let tabId;

  onMount(() => {
    applyTheme($theme);
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', onSystemThemeChange);

    if (typeof chrome !== "undefined" && chrome.devtools) {
      try {
        tabId = chrome.devtools.inspectedWindow.tabId;

        // 設定全域函式，供 devtools.js 直接呼叫
        window.dispatchGrpcEvent = (data) => {
          addLog(data);
        };

        // 監聽來自 content-script / background 的訊息
        chrome.runtime.onMessage.addListener((message) => {
          // 跳過 background relay 的重複訊息（只處理 content-script 直接送來的）
          if (message._relayedBy === "background") return;

          // PostMessage Interceptor：前端 interceptor 直接送入已解碼的 call data
          if (
            message.type === "__GRPCWEB_DEVTOOLS__" &&
            message.action === "gRPCNetworkCall"
          ) {
            const method = message.method?.startsWith("/")
              ? message.method
              : `/${message.method || ""}`;
            const parts = method.split("/");
            const endpoint = parts.pop() || parts.pop();

            addLog({
              id: `interceptor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              method,
              endpoint,
              methodType: message.methodType || "unary",
              request: message.request,
              response: message.error
                ? {
                    _error:
                      typeof message.error === "string"
                        ? message.error
                        : message.error.message || String(message.error),
                    _code: message.error?.code,
                  }
                : message.response,
              error: message.error,
              status: "finished",
              startTime: Date.now() / 1000,
              _source: "interceptor",
            });
            return;
          }

          // Schema 註冊：從 grpc-web-injector 或其他來源
          if (
            message.type === "__GRPCWEB_DEVTOOLS__" &&
            message.action === "registerSchema"
          ) {
            registerSchema(message.schema, message.source || "");
          }
        });

        // 監聽頁面重新載入以清除日誌
        if (chrome.tabs && chrome.tabs.onUpdated) {
          chrome.tabs.onUpdated.addListener(onTabUpdated);
        }
      } catch (error) {
        console.warn("DevTools API not available:", error);
      }
    }
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      delete window.dispatchGrpcEvent;
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.removeEventListener('change', onSystemThemeChange);
    }
    if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    }
  });

  function onTabUpdated(tId, { status }) {
    if (tId === tabId && status === "loading") {
      clearLogs();
    }
  }

  // --- Resizer Logic ---
  let isResizing = false;

  function startResizing(e) {
    isResizing = true;
    window.addEventListener("mousemove", handleResize);
    window.addEventListener("mouseup", stopResizing);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function stopResizing() {
    isResizing = false;
    window.removeEventListener("mousemove", handleResize);
    window.removeEventListener("mouseup", stopResizing);
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";
  }

  function handleResize(e) {
    if (!isResizing) return;
    const newWidth = e.clientX - 60;
    if (newWidth > 200 && newWidth < 800) {
      listPaneWidth.set(newWidth);
    }
  }

  function applyTheme(themeValue) {
    if (typeof document === 'undefined') return;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = themeValue === 'dark' || (themeValue === 'system' && prefersDark);
    document.body.classList.toggle('dark', isDark);
  }

  function onSystemThemeChange() {
    applyTheme($theme);
  }

  $: applyTheme($theme);
</script>

<main class="app-layout">
  <Sidebar />

  <div class="main-content">
    {#if $activePage === "network"}
      <header>
        <Toolbar />
      </header>
      <div class="split-view" style="--list-width: {$listPaneWidth}px">
        <div class="list-pane">
          <NetworkList />
        </div>
        <div
          class="resizer"
          class:active={isResizing}
          on:mousedown|preventDefault={startResizing}
        ></div>
        <div class="details-pane">
          <NetworkDetails />
        </div>
      </div>
    {:else if $activePage === "services"}
      <ServicesView />
    {:else if $activePage === "settings"}
      <SettingsView />
    {/if}
  </div>
</main>

<style>
  :global(body) {
    --color-primary: #2563eb;
    --color-primary-dark: #1d4ed8;
    --color-primary-bg: #eff6ff;
    --color-success: #059669;
    --color-success-bg: #ecfdf5;
    --color-error: #ef4444;
    --color-error-bg: #fef2f2;
    --color-warning: #ea580c;
    --color-purple: #8b5cf6;
    --color-purple-dark: #7c3aed;
    --color-purple-bg: #fdf4ff;

    --color-text-primary: #111827;
    --color-text-secondary: #6b7280;
    --color-text-tertiary: #9ca3af;

    --color-bg-primary: #ffffff;
    --color-bg-secondary: #f9fafb;
    --color-bg-tertiary: #f3f4f6;
    --color-bg-hover: #f3f4f6;

    --color-border: #e5e7eb;
    --color-border-light: #f3f4f6;

    --color-badge-p-bg: #e0e7ff;
    --color-badge-p-text: #4f46e5;
    --color-badge-r-bg: #fdf4ff;
    --color-badge-r-text: #c026d3;

    --color-highlight: #fef08a;

    margin: 0;
    font-family:
      "Inter",
      -apple-system,
      system-ui,
      sans-serif;
    overflow: hidden;
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
    transition: background-color 0.2s, color 0.2s;
  }

  :global(body.dark) {
    --color-primary: #3b82f6;
    --color-primary-dark: #2563eb;
    --color-primary-bg: #1e3a5f;
    --color-success: #34d399;
    --color-success-bg: #064e3b;
    --color-error: #f87171;
    --color-error-bg: #450a0a;
    --color-warning: #fb923c;
    --color-purple: #a78bfa;
    --color-purple-dark: #8b5cf6;
    --color-purple-bg: #2e1065;

    --color-text-primary: #f3f4f6;
    --color-text-secondary: #9ca3af;
    --color-text-tertiary: #6b7280;

    --color-bg-primary: #1f2937;
    --color-bg-secondary: #111827;
    --color-bg-tertiary: #374151;
    --color-bg-hover: #374151;

    --color-border: #374151;
    --color-border-light: #1f2937;

    --color-badge-p-bg: #312e81;
    --color-badge-p-text: #a5b4fc;
    --color-badge-r-bg: #4a1d96;
    --color-badge-r-text: #d8b4fe;

    --color-highlight: #854d0e;
  }

  .app-layout {
    display: flex;
    height: 100vh;
    width: 100vw;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    flex: 0 0 auto;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-primary);
  }

  .split-view {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
  }

  .resizer {
    width: 4px;
    height: 100%;
    cursor: col-resize;
    background: transparent;
    transition: background 0.2s;
    flex: 0 0 4px;
    z-index: 10;
    margin: 0 -2px;
  }

  .resizer:hover,
  .resizer.active {
    background: var(--color-purple);
  }

  .list-pane {
    width: var(--list-width);
    min-width: var(--list-width);
    max-width: var(--list-width);
    border-right: 1px solid var(--color-border);
    background: var(--color-bg-primary);
    overflow: auto;
  }

  .details-pane {
    flex: 1;
    background: var(--color-bg-primary);
    overflow: hidden;
  }
</style>

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
  import PlaygroundView from "./components/PlaygroundView.svelte";
  import { addLog, clearLogs } from "./stores/network";
  import { registerSchema } from "./stores/schema";
  import { activePage } from "./stores/ui";
  import { listPaneWidth } from "./stores/layout";
  import { t } from "./lib/i18n";

  let tabId;

  onMount(() => {
    if (typeof chrome !== "undefined" && chrome.devtools) {
      try {
        tabId = chrome.devtools.inspectedWindow.tabId;

        // 設定全域函式，供 devtools.js 直接呼叫
        window.dispatchGrpcEvent = (data) => {
          addLog(data);
        };

        // 監聯來自 content-script/background 的 schema 註冊訊息
        chrome.runtime.onMessage.addListener((message) => {
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
    // 清理全域函式和 listeners
    if (typeof window !== "undefined") {
      delete window.dispatchGrpcEvent;
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
    // 側邊欄寬度 = 滑鼠 X 座標 - Sidebar 寬度 (60px)
    const newWidth = e.clientX - 60;
    if (newWidth > 200 && newWidth < 800) {
      listPaneWidth.set(newWidth);
    }
  }
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
    {:else if $activePage === "playground"}
      <PlaygroundView />
    {:else if $activePage === "settings"}
      <SettingsView />
    {/if}
  </div>
</main>

<style>
  :global(body) {
    /* 設計系統色彩變數 */
    --color-primary: #2563eb;
    --color-primary-dark: #1d4ed8;
    --color-success: #059669;
    --color-warning: #ea580c;
    --color-purple: #8b5cf6;
    --color-purple-dark: #7c3aed;

    --color-text-primary: #111827;
    --color-text-secondary: #6b7280;
    --color-text-tertiary: #9ca3af;

    --color-bg-primary: white;
    --color-bg-secondary: #f9fafb;
    --color-bg-hover: #f3f4f6;

    --color-border: #e5e7eb;
    --color-border-light: #f3f4f6;

    margin: 0;
    font-family:
      "Inter",
      -apple-system,
      system-ui,
      sans-serif;
    overflow: hidden;
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
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
    border-bottom: 1px solid #e5e7eb;
    background: white;
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
    border-right: 1px solid #e5e7eb;
    background: white;
    overflow: auto;
  }

  .details-pane {
    flex: 1;
    background: white;
    overflow: hidden;
  }
</style>

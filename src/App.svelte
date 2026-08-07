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
  import { activeTabId, clearInspectorRecords, refreshInspector, selectInspectorTab } from "./stores/inspector";
  import { preserveLog } from "./stores/network";
  import { activePage } from "./stores/ui";
  import { listPaneWidth } from "./stores/layout";
  import { theme } from "./stores/settings";
  let storageListener;
  let tabListener;
  let navigationListener;
  let runtimeListener;
  let splitView;
  let resizeFrame = null;
  let pendingListPaneHeight = null;
  let panelWindowId = null;
  const panelTabId = getPanelTabId();

  onMount(() => {
    applyTheme($theme);
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', onSystemThemeChange);

    if (typeof chrome !== "undefined" && chrome.runtime) {
      if (Number.isInteger(panelTabId)) {
        selectInspectorTab(panelTabId);
      } else {
        void initializeInspectorTab();
      }
      storageListener = (changes, areaName) => {
        if (areaName !== "local") return;
        const tabId = $activeTabId;
        if (!Number.isInteger(tabId)) return;
        if (changes[`protobufTsInspectorConfig:${tabId}`] || changes[`protobufTsInspectorHiddenServices:${tabId}`]) {
          refreshInspector(tabId);
        }
      };
      tabListener = ({ tabId, windowId }) => {
        if (Number.isInteger(panelTabId)) return;
        if (panelWindowId !== null && windowId !== panelWindowId) return;
        selectInspectorTab(tabId);
      };
      runtimeListener = (message) => {
        if (message?.type === "inspectorRecordAdded" && message.tabId === $activeTabId) refreshInspector(message.tabId);
      };
      navigationListener = ({ tabId, frameId }) => {
        if (frameId === 0 && tabId === $activeTabId && !$preserveLog) {
          clearInspectorRecords(tabId);
        }
      };
      chrome.storage.onChanged.addListener(storageListener);
      chrome.tabs.onActivated.addListener(tabListener);
      chrome.webNavigation.onCommitted.addListener(navigationListener);
      chrome.runtime.onMessage.addListener(runtimeListener);
    }
  });

  async function initializeInspectorTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!Number.isInteger(tab?.id)) return;
      panelWindowId = tab.windowId ?? null;
      selectInspectorTab(tab.id);
    } catch {
      refreshInspector();
    }
  }

  function getPanelTabId() {
    const value = Number(new URLSearchParams(window.location.search).get('tabId'));
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  onDestroy(() => {
    stopResizing();
    if (typeof window !== "undefined") {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.removeEventListener('change', onSystemThemeChange);
    }
    if (typeof chrome !== "undefined" && storageListener) {
      chrome.storage?.onChanged?.removeListener(storageListener);
    }
    if (typeof chrome !== "undefined" && tabListener) {
      chrome.tabs?.onActivated?.removeListener(tabListener);
    }
    if (typeof chrome !== "undefined" && navigationListener) {
      chrome.webNavigation?.onCommitted?.removeListener(navigationListener);
    }
    if (typeof chrome !== "undefined" && runtimeListener) {
      chrome.runtime?.onMessage?.removeListener(runtimeListener);
    }
  });

  // --- Resizer Logic ---
  let isResizing = false;

  function startResizing(e) {
    isResizing = true;
    window.addEventListener("mousemove", handleResize);
    window.addEventListener("mouseup", stopResizing);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  function stopResizing() {
    isResizing = false;
    window.removeEventListener("mousemove", handleResize);
    window.removeEventListener("mouseup", stopResizing);
    if (resizeFrame !== null) {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
    }
    flushPendingResize();
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";
  }

  function handleResize(e) {
    if (!isResizing) return;
    if (!splitView) return;
    const { top, height } = splitView.getBoundingClientRect();
    const newHeight = e.clientY - top;
    const maxHeight = Math.max(180, height - 180);
    if (newHeight > 140 && newHeight < maxHeight) {
      queueListPaneHeight(newHeight);
    }
  }

  function queueListPaneHeight(height) {
    pendingListPaneHeight = height;
    if (resizeFrame !== null) return;

    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = null;
      flushPendingResize();
    });
  }

  function flushPendingResize() {
    if (pendingListPaneHeight === null) return;
    listPaneWidth.set(pendingListPaneHeight);
    pendingListPaneHeight = null;
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
      <div class="split-view" bind:this={splitView} style="--list-height: {$listPaneWidth}px">
        <div class="list-pane">
          <NetworkList />
        </div>
        <button
          type="button"
          class="resizer"
          class:active={isResizing}
          aria-label="Resize panels"
          on:mousedown|preventDefault={startResizing}
        ></button>
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
    flex-direction: column;
    height: 100vh;
    width: 100vw;
  }

  .main-content {
    flex: 1;
    min-height: 0;
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
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .resizer {
    appearance: none;
    width: 100%;
    height: 4px;
    cursor: row-resize;
    background: transparent;
    border: 0;
    padding: 0;
    transition: background 0.2s;
    flex: 0 0 4px;
    z-index: 10;
    margin: -2px 0;
  }

  .resizer:hover,
  .resizer.active {
    background: var(--color-purple);
  }

  .list-pane {
    width: 100%;
    height: min(var(--list-height), 55%);
    min-height: 140px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-primary);
    overflow: auto;
  }

  .details-pane {
    flex: 1;
    background: var(--color-bg-primary);
    overflow: hidden;
    min-height: 0;
  }

</style>

<script>
  import { onMount, onDestroy } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import NetworkList from './components/NetworkList.svelte';
  import NetworkDetails from './components/NetworkDetails.svelte';
  import ServicesView from './components/ServicesView.svelte';
  import SettingsView from './components/SettingsView.svelte';
  import { addLog, clearLogs } from './stores/network';
  import { registerSchema } from './stores/schema';
  import { activePage } from './stores/ui';
  import { t } from './lib/i18n';

  let port;
  let tabId;

  onMount(() => {
    if (typeof chrome !== "undefined" && chrome.devtools) {
      try {
        tabId = chrome.devtools.inspectedWindow.tabId;
        port = chrome.runtime.connect(null, { name: "panel" });
        port.postMessage({ tabId, action: "init" });
        port.onMessage.addListener(onMessageReceived);
        
        if (chrome.tabs && chrome.tabs.onUpdated) {
          chrome.tabs.onUpdated.addListener(onTabUpdated);
        }
      } catch (error) {
        console.warn("DevTools API not available:", error);
      }
    }
  });

  onDestroy(() => {
    // 清理 Chrome API listeners，避免 memory leak
    if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    }
    if (port) {
      port.onMessage.removeListener(onMessageReceived);
      port.disconnect();
    }
  });

  function onMessageReceived({ action, data, schema }) {
    if (action === "gRPCNetworkCall") {
      addLog(data);
    } else if (action === "registerSchema" && schema) {
      registerSchema(schema);
    }
  }

  function onTabUpdated(tId, { status }) {
    if (tId === tabId && status === "loading") {
      clearLogs();
    }
  }
</script>

<main class="app-layout">
  <Sidebar />
  
  <div class="main-content">
    {#if $activePage === 'network'}
      <header>
        <Toolbar />
      </header>
      <div class="split-view">
        <div class="list-pane">
          <NetworkList />
        </div>
        <div class="details-pane">
          <NetworkDetails />
        </div>
      </div>
    {:else if $activePage === 'services'}
      <ServicesView />
    {:else if $activePage === 'settings'}
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
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
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
    display: grid;
    grid-template-columns: 350px 1fr;
    overflow: hidden;
  }

  .list-pane {
    border-right: 1px solid #e5e7eb;
    background: white;
    overflow-y: auto;
  }

  .details-pane {
    background: white;
    overflow: hidden;
  }

</style>

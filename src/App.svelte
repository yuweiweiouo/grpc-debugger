<script>
  import { onMount } from 'svelte';
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
    margin: 0;
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
    overflow: hidden;
    background-color: #f9fafb;
    color: #111827;
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

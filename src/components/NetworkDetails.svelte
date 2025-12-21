<script>
  import { selectedEntry } from '../stores/network';
  import { protoEngine } from '../lib/proto-engine';
  import { t } from '../lib/i18n';
  import JsonTree from './JsonTree.svelte';

  let activeTab = 'request';

  $: entry = $selectedEntry;
  $: protoDef = entry ? protoEngine.serviceMap.get(entry.method) : null;
  $: requestMsg = protoDef ? protoEngine.findMessage(protoDef.requestType) : null;
  $: responseMsg = protoDef ? protoEngine.findMessage(protoDef.responseType) : null;

  function setTab(tab) {
    activeTab = tab;
  }
</script>

<div class="network-details">
  {#if !entry}
    <div class="empty">{$t('select_request')}</div>
  {:else}
    <div class="tabs">
      <button class:active={activeTab === 'headers'} on:click={() => setTab('headers')}>{$t('headers')}</button>
      <button class:active={activeTab === 'request'} on:click={() => setTab('request')}>{$t('request')}</button>
      <button class:active={activeTab === 'response'} on:click={() => setTab('response')}>{$t('response')}</button>
      <button class:active={activeTab === 'proto'} on:click={() => setTab('proto')}>{$t('proto')}</button>
    </div>

    <div class="content">
      {#if activeTab === 'headers'}
        <section>
          <h3>{$t('general')}</h3>
          <div class="field"><span class="label">Method:</span> <span class="val">{entry.method}</span></div>
          <div class="field"><span class="label">URL:</span> <span class="val">{entry.url}</span></div>
          <div class="field"><span class="label">{$t('status')}:</span> <span class="val">{entry.grpcStatus === 0 ? 'OK (0)' : `Error (${entry.grpcStatus})`}</span></div>
        </section>
        {#if entry.requestHeaders}
          <section>
            <h3>{$t('request_headers')}</h3>
            {#each Object.entries(entry.requestHeaders) as [k, v]}
              <div class="field"><span class="label">{k}:</span> <span class="val">{v}</span></div>
            {/each}
          </section>
        {/if}
      {:else if activeTab === 'request'}
        <div class="data-view">
          {#if entry.request}
            <JsonTree data={entry.request} />
          {:else}
            <div class="no-data">{$t('no_data')}</div>
          {/if}
        </div>
      {:else if activeTab === 'response'}
        <div class="data-view">
          {#if entry.response}
            <JsonTree data={entry.response} />
          {:else}
            <div class="no-data">{$t('no_data')}</div>
          {/if}
        </div>
      {:else if activeTab === 'proto'}
        <div class="proto-view">
          {#if protoDef}
            <div class="msg-section">
              <h4>Request Message: {protoDef.requestType}</h4>
              <table class="proto-table">
                <thead><tr><th>#</th><th>Name</th><th>Type</th></tr></thead>
                <tbody>
                  {#each requestMsg?.fields || [] as f}
                    <tr><td>{f.number}</td><td>{f.name}</td><td>{f.type_name || f.type}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <div class="msg-section">
              <h4>Response Message: {protoDef.responseType}</h4>
              <table class="proto-table">
                <thead><tr><th>#</th><th>Name</th><th>Type</th></tr></thead>
                <tbody>
                  {#each responseMsg?.fields || [] as f}
                    <tr><td>{f.number}</td><td>{f.name}</td><td>{f.type_name || f.type}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <div class="no-data">{$t('no_data')}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .network-details {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #9ca3af;
    font-size: 14px;
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid #e5e7eb;
    padding: 0 12px;
    gap: 8px;
    background: #fdfdfd;
  }

  .tabs button {
    background: transparent;
    border: none;
    padding: 12px 16px;
    font-size: 13px;
    font-weight: 500;
    color: #6b7280;
    cursor: pointer;
    position: relative;
  }

  .tabs button.active {
    color: #2563eb;
  }

  .tabs button.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: #2563eb;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  section {
    margin-bottom: 24px;
  }

  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9ca3af;
    margin-bottom: 12px;
    border-bottom: 1px solid #f3f4f6;
    padding-bottom: 4px;
  }

  .field {
    font-size: 13px;
    margin-bottom: 6px;
    word-break: break-all;
  }

  .label {
    font-weight: 600;
    color: #4b5563;
    margin-right: 8px;
  }

  .val {
    color: #111827;
  }

  .data-view, .proto-view {
    padding: 8px;
  }

  .no-data {
    text-align: center;
    padding: 40px;
    color: #9ca3af;
    font-style: italic;
  }

  .msg-section {
    margin-bottom: 32px;
  }

  h4 {
    font-size: 11px;
    color: #6b7280;
    background: #f9fafb;
    padding: 4px 8px;
    border-radius: 4px;
    margin-bottom: 12px;
  }

  .proto-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .proto-table th, .proto-table td {
    border: 1px solid #f3f4f6;
    padding: 8px;
    text-align: left;
  }

  .proto-table th {
    background: #f9fafb;
    font-weight: 600;
    color: #4b5563;
  }
</style>

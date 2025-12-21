<script>
  import { services, clearAllSchemas, reflectionStatus } from '../stores/schema';
  import { t } from '../lib/i18n';
  import { Trash2, ShieldCheck, Box, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-svelte';

  function handleClear() {
    if (confirm("Clear all loaded schemas?")) {
      clearAllSchemas();
    }
  }
</script>

<div class="services-page">
  <header>
    <div class="title">
      <ShieldCheck size={20} />
      <h2>{$t('loaded_services')}</h2>
      
      {#if $reflectionStatus === 'loading'}
        <div class="status-badge loading">
          <RefreshCw size={12} class="spin" />
          <span>{$t('reflecting')}</span>
        </div>
      {:else if $reflectionStatus === 'success'}
        <div class="status-badge success">
          <CheckCircle2 size={12} />
          <span>{$t('sync_ok')}</span>
        </div>
      {:else if $reflectionStatus === 'failed'}
        <div class="status-badge error">
          <AlertCircle size={12} />
          <span>{$t('sync_failed')}</span>
        </div>
      {/if}
    </div>
    <button class="clear-btn" on:click={handleClear}>
      <Trash2 size={16} />
      <span>{$t('clear_all')}</span>
    </button>
  </header>

  <div class="service-grid">
    {#each $services as service}
      <div class="service-card">
        <div class="card-header">
          <Box size={16} color="#8b5cf6" />
          <span class="pkg">{service.fullName.split('.').slice(0, -1).join('.')}</span>
        </div>
        <h3>{service.name}</h3>
        <div class="methods">
          {#each service.methods as method}
            <div class="method-chip">{method.name}</div>
          {/each}
        </div>
      </div>
    {/each}

    {#if $services.length === 0}
      <div class="empty-state">
        <p>{$t('no_schemas_yet')}</p>
        <span class="hint">{$t('hint_register')}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .services-page {
    padding: 24px;
    height: 100%;
    overflow-y: auto;
    background: #f9fafb;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #111827;
  }

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 20px;
  }

  .status-badge.loading {
    background: #eff6ff;
    color: #2563eb;
  }

  .status-badge.success {
    background: #ecfdf5;
    color: #059669;
  }

  .status-badge.error {
    background: #fef2f2;
    color: #dc2626;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  :global(.spin) {
    animation: spin 2s linear infinite;
  }

  .clear-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: white;
    border: 1px solid #e5e7eb;
    padding: 8px 16px;
    border-radius: 8px;
    color: #ef4444;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .clear-btn:hover {
    background: #fef2f2;
    border-color: #fca5a5;
  }

  .service-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
  }

  .service-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .pkg {
    font-size: 10px;
    color: #6b7280;
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
    color: #111827;
  }

  .methods {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .method-chip {
    font-size: 10px;
    background: #f3f4f6;
    color: #4b5563;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid #e5e7eb;
  }

  .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    padding: 100px 20px;
    color: #9ca3af;
  }

  .hint {
    font-size: 12px;
    color: #d1d5db;
  }
</style>

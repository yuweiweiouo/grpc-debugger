<script>
  import { filterValue, clearLogs } from '../stores/network';
  import { t } from '../lib/i18n';
  import { Trash2, Search } from 'lucide-svelte';

  function handleClearLogs() {
    clearLogs(true);
  }
</script>

<div class="toolbar">
  <div class="left">
    <div class="search-container">
      <Search size={14} class="search-icon" />
      <input 
        type="text" 
        placeholder={$t('filter_placeholder')} 
        bind:value={$filterValue}
      />
    </div>
  </div>

  <div class="right">
    <button class="icon-btn" on:click={handleClearLogs} title={$t('clear_logs')}>
      <Trash2 size={16} />
    </button>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    height: 48px;
    box-sizing: border-box;
  }

  .left {
    flex: 1;
    display: flex;
    align-items: center;
  }

  .search-container {
    display: flex;
    align-items: center;
    background: #f3f4f6;
    border-radius: 6px;
    padding: 4px 8px;
    width: 240px;
  }

  .search-icon {
    color: #6b7280;
    margin-right: 6px;
  }

  input {
    background: transparent;
    border: none;
    outline: none;
    font-size: 13px;
    width: 100%;
    color: #374151;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: #6b7280;
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: #f3f4f6;
    color: #ef4444;
  }
</style>

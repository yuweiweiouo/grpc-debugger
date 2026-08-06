<script>
  /**
   * 工具欄 (Toolbar)
   *
   * 提供網路日誌的過濾、清除、以及持久化設定（Preserve Log）。
   */
  import { filterValue, preserveLog } from "../stores/network";
  import {
    clearInspectorRecords,
    inspectorError,
    monitoring,
    refreshInspector,
    startInspector,
    stopInspector,
    urlFilter,
  } from "../stores/inspector";
  import { t } from "../lib/i18n";
  import { Play, RefreshCw, Search, Square, Trash2 } from "lucide-svelte";

  let isReprocessing = false;

  async function handleClearLogs() {
    await clearInspectorRecords();
  }

  async function handleReprocess() {
    if (isReprocessing) return;
    isReprocessing = true;
    try {
      await refreshInspector();
    } finally {
      isReprocessing = false;
    }
  }

  async function handleStart() {
    urlFilter.set($filterValue);
    await startInspector();
    await refreshInspector();
  }

  async function handleStop() {
    await stopInspector();
  }

</script>

<div class="toolbar">
  <div class="left">
    <button class="monitor-btn" class:stop={$monitoring} on:click={$monitoring ? handleStop : handleStart}>
      {#if $monitoring}<Square size={14} /> {$t("stop")}{:else}<Play size={14} /> {$t("start")}{/if}
    </button>
    <button
      class="icon-btn"
      on:click={handleClearLogs}
      title={$t("clear_logs")}
      aria-label={$t("clear_logs")}
    >
      <Trash2 size={16} />
    </button>
    <div class="search-container">
      <span class="search-icon"><Search size={14} /></span>
      <input
        type="text"
        placeholder={$t("filter")}
        bind:value={$filterValue}
      />
    </div>
    <label class="preserve-checkbox">
      <input type="checkbox" bind:checked={$preserveLog} />
      <span>{$t("preserve_log")}</span>
    </label>
  </div>

  <div class="right">
    <button
      class="icon-btn"
      on:click={handleReprocess}
      title={$t("reprocess_logs")}
      aria-label={$t("reprocess_logs")}
      disabled={isReprocessing}
      class:spinning={isReprocessing}
    >
      <RefreshCw size={16} />
    </button>
  </div>
  {#if $inspectorError}<span class="error-message">{$inspectorError}</span>{/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    position: relative;
    padding: 8px 12px;
    min-height: 48px;
    box-sizing: border-box;
    gap: 6px;
  }

  .left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .search-container {
    display: flex;
    align-items: center;
    background: var(--color-bg-tertiary, #f3f4f6);
    border-radius: 6px;
    padding: 4px 8px;
    width: 140px;
    flex: 0 1 140px;
    min-width: 0;
  }

  .search-icon {
    display: inline-flex;
    align-items: center;
    color: var(--color-text-secondary);
    margin-right: 6px;
  }

  input {
    background: transparent;
    border: none;
    outline: none;
    font-size: 13px;
    width: 100%;
    color: var(--color-text-primary);
  }

  .monitor-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 9px;
    border: 0;
    border-radius: 6px;
    background: var(--color-primary);
    color: white;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .monitor-btn.stop { background: var(--color-error); }

  .preserve-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
  }

  .preserve-checkbox input { margin: 0; cursor: pointer; }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }


  .right {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
  }

  .error-message {
    flex: 1 0 100%;
    z-index: 20;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: 11px;
  }

  @media (max-width: 640px) {
    .toolbar { padding: 8px; }
    .left { gap: 6px; }
    .search-container { flex-basis: 110px; }
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon-btn.spinning :global(svg) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>

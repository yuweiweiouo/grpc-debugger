<script>
  /**
   * 工具欄 (Toolbar)
   *
   * 提供網路日誌的過濾、清除、以及持久化設定（Preserve Log）。
   */
  import { filterValue } from "../stores/network";
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
    await startInspector();
    await refreshInspector();
  }

  async function handleStop() {
    await stopInspector();
  }
</script>

<div class="toolbar">
  <div class="left">
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
        placeholder={$t("filter_placeholder")}
        bind:value={$filterValue}
      />
    </div>
    <input class="url-filter" type="text" placeholder="XHR/fetch URL 篩選，例如 /Service/" bind:value={$urlFilter} />
    <button class="monitor-btn" class:stop={$monitoring} on:click={$monitoring ? handleStop : handleStart}>
      {#if $monitoring}<Square size={14} /> 停止監看{:else}<Play size={14} /> 開始監看{/if}
    </button>
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
    align-items: center;
    justify-content: space-between;
    position: relative;
    padding: 8px 12px;
    height: 48px;
    box-sizing: border-box;
  }

  .left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .search-container {
    display: flex;
    align-items: center;
    background: var(--color-bg-tertiary, #f3f4f6);
    border-radius: 6px;
    padding: 4px 8px;
    width: 240px;
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

  .url-filter {
    width: min(300px, 32vw);
    padding: 6px 8px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg-primary);
    font-size: 12px;
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
  }

  .error-message {
    position: absolute;
    right: 12px;
    top: 50px;
    z-index: 20;
    max-width: 50%;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: 11px;
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

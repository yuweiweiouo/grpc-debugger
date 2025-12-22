<script>
  import {
    filterValue,
    clearLogs,
    reprocessAllLogs,
    preserveLog,
  } from "../stores/network";
  import { t } from "../lib/i18n";
  import { Trash2, Search, RefreshCw } from "lucide-svelte";

  let isReprocessing = false;

  function handleClearLogs() {
    clearLogs(true);
  }

  async function handleReprocess() {
    if (isReprocessing) return;
    isReprocessing = true;
    try {
      await reprocessAllLogs();
    } finally {
      isReprocessing = false;
    }
  }
</script>

<div class="toolbar">
  <div class="left">
    <div class="search-container">
      <Search size={14} class="search-icon" />
      <input
        type="text"
        placeholder={$t("filter_placeholder")}
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
      disabled={isReprocessing}
      class:spinning={isReprocessing}
    >
      <RefreshCw size={16} />
    </button>
    <button
      class="icon-btn"
      on:click={handleClearLogs}
      title={$t("clear_logs")}
    >
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
    gap: 12px;
  }

  .preserve-checkbox {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #6b7280;
    cursor: pointer;
    user-select: none;
  }

  .preserve-checkbox input {
    cursor: pointer;
  }

  .preserve-checkbox span {
    white-space: nowrap;
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
    color: #374151;
  }

  .icon-btn.active {
    background: #dbeafe;
    color: #2563eb;
  }

  .right {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
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

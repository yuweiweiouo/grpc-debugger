<script>
  /**
   * 工具欄 (Toolbar)
   *
   * 提供網路日誌的過濾、清除、以及持久化設定（Preserve Log）。
   */
  import {
    filterValue,
    clearLogs,
    preserveLog,
  } from "../stores/network";
  import {
    listenLegacyPostmessage,
    listenGrpcWebDevtools,
  } from "../stores/settings";
  import { t } from "../lib/i18n";
  import { Trash2, Search } from "lucide-svelte";

  function handleClearLogs() {
    clearLogs(true);
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
    <label class="preserve-checkbox">
      <input type="checkbox" bind:checked={$preserveLog} />
      <span>{$t("preserve_log")}</span>
    </label>
    <label class="preserve-checkbox">
      <input type="checkbox" bind:checked={$listenLegacyPostmessage} />
      <span>[{$t("source")}] {$t("listen_legacy_postmessage")}</span>
    </label>
    <label class="preserve-checkbox">
      <input type="checkbox" bind:checked={$listenGrpcWebDevtools} />
      <span>[{$t("source")}] {$t("listen_grpc_web_devtools")}</span>
    </label>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    min-height: 48px;
    box-sizing: border-box;
  }

  .left {
    flex: 1;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .preserve-checkbox {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--color-text-secondary);
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
</style>

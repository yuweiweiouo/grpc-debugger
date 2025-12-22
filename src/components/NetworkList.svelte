<script>
  import { afterUpdate } from "svelte";
  import { filteredLog, selectedIdx } from "../stores/network";
  import { t } from "../lib/i18n";

  let listContainer;
  let shouldAutoScroll = true;

  function handleSelect(idx) {
    selectedIdx.set(idx);
  }

  function handleKeyDown(e, i) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(i);
    }
  }

  function handleScroll() {
    if (!listContainer) return;
    // 檢查是否在底部（允許 5px 誤差）
    const { scrollTop, scrollHeight, clientHeight } = listContainer;
    shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 5;
  }

  afterUpdate(() => {
    if (shouldAutoScroll && listContainer) {
      listContainer.scrollTop = listContainer.scrollHeight;
    }
  });
</script>

<div class="network-list" bind:this={listContainer} on:scroll={handleScroll}>
  {#each $filteredLog as entry, i}
    <div
      class="row"
      class:selected={$selectedIdx === i}
      on:click={() => handleSelect(i)}
      on:keydown={(e) => handleKeyDown(e, i)}
      role="button"
      tabindex="0"
    >
      <div class="method-col">
        <span
          class="dot"
          class:success={entry.grpcStatus === 0}
          class:error={entry.grpcStatus > 0}
        ></span>
        <span class="method-name">{entry.method.split("/").pop()}</span>
      </div>
      <div class="meta-col">
        <span class="status">{entry.grpcStatus ?? "-"}</span>
        <span class="time"
          >{entry.duration ? `${entry.duration}ms` : "0ms"}</span
        >
      </div>
    </div>
  {/each}

  {#if $filteredLog.length === 0}
    <div class="empty">
      <p>{$t("no_requests")}</p>
    </div>
  {/if}
</div>

<style>
  .network-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    height: 100%;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid #f3f4f6;
    cursor: pointer;
    transition: background 0.2s;
  }

  .row:hover {
    background: #f9fafb;
  }

  .row.selected {
    background: #eff6ff;
  }

  .method-col {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #d1d5db;
    flex-shrink: 0;
  }

  .dot.success {
    background: #10b981;
  }

  .dot.error {
    background: #ef4444;
  }

  .method-name {
    font-size: 13px;
    font-weight: 500;
    color: #374151;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta-col {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .status {
    font-size: 11px;
    color: #6b7280;
    width: 20px;
    text-align: right;
  }

  .time {
    font-size: 11px;
    color: #9ca3af;
    width: 45px;
    text-align: right;
  }

  .empty {
    padding: 40px 20px;
    text-align: center;
    color: #9ca3af;
    font-size: 13px;
  }
</style>

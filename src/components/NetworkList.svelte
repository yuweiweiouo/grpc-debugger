<script>
  /**
   * 網路請求列表組件 (Network List)
   *
   * 職責：
   * 1. 條列式顯示所有經過過濾的 gRPC 請求。
   * 2. 透過顏色小點 (Dot) 反映請求的即時狀態 (Pending, Success, Error)。
   * 3. 實作「自動滾動到底部」邏輯，方便使用者追蹤最新的請求。
   * 4. 虛擬捲動：僅渲染可視範圍 DOM，大量請求下維持 60fps。
   */
  import { afterUpdate } from "svelte";
  import { filteredLog, selectedId, filterValue } from "../stores/network";
  import { t } from "../lib/i18n";
  import { normalizeTimestampMs } from "../lib/time";

  const ROW_HEIGHT = 37;
  const BUFFER = 10;

  let listContainer;
  let shouldAutoScroll = true;
  let scrollTop = 0;
  let containerHeight = 400;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightText(text, query) {
    const escaped = escapeHtml(text);
    if (!query) return escaped;
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(
      `(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
      'gi'
    );
    return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  $: totalItems = $filteredLog.length;
  $: startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  $: endIndex = Math.min(
    totalItems,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER
  );
  $: visibleItems = $filteredLog.slice(startIndex, endIndex);
  $: paddingTop = startIndex * ROW_HEIGHT;
  $: paddingBottom = Math.max(0, (totalItems - endIndex) * ROW_HEIGHT);

  function handleSelect(entry) {
    selectedId.set(entry?.id ?? null);
  }

  function handleKeyDown(e, entry) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(entry);
    }
  }

  function onScroll() {
    if (!listContainer) return;
    const { scrollTop: st, scrollHeight, clientHeight: ch } = listContainer;
    shouldAutoScroll = scrollHeight - st - ch < 5;
    scrollTop = st;
    containerHeight = ch;
  }

  afterUpdate(() => {
    if (shouldAutoScroll && listContainer) {
      listContainer.scrollTop = listContainer.scrollHeight;
    }
  });

  function formatStartTime(ts) {
    const timestampMs = normalizeTimestampMs(ts);
    if (!timestampMs) return "";
    return new Date(timestampMs).toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDuration(durationMs) {
    const duration = Number(durationMs);
    return Number.isFinite(duration) ? `${(duration / 1000).toFixed(2)}s` : "-";
  }

  function isParsed(entry) {
    const hasPayload = entry.requestRaw || entry.responseRaw || entry.request || entry.response;
    if (!hasPayload) return false;
    if (entry.requestRaw && !entry.request) return false;
    if (entry.responseRaw && !entry.response) return false;
    return ![entry.request, entry.response].some((value) => value?._error || value?._decodeReason);
  }
</script>

<div
  class="network-list"
  bind:this={listContainer}
  bind:clientHeight={containerHeight}
  on:scroll={onScroll}
>
  <div
    style="padding-top: {paddingTop}px; padding-bottom: {paddingBottom}px;"
  >
    {#each visibleItems as entry, i (entry.id ?? startIndex + i)}
      <div
        class="row"
        class:selected={$selectedId === entry.id}
        on:click={() => handleSelect(entry)}
        on:keydown={(e) => handleKeyDown(e, entry)}
        role="button"
        tabindex="0"
      >
        <div class="method-col">
          <span
            class="dot"
            class:success={entry.status === "finished" && entry.grpcStatus === 0}
            class:error={entry.status === "finished" && entry.grpcStatus > 0}
            class:pending={entry.status === "pending"}
          ></span>

          {#if isParsed(entry)}
            <span class="source-tag source-parsed" title={$t("parsed")}>{$t("parsed")}</span>
          {:else}
            <span class="source-tag source-unparsed" title={$t("unparsed")}>{$t("unparsed")}</span>
          {/if}

          <span
            class="method-name"
            class:pending-text={entry.status === "pending"}
          >
            <!-- svelte-ignore html_dangerous_html_in_svelte_html -->
            {@html highlightText(entry.method.split("/").pop(), $filterValue)}
          </span>
          {#if entry.status === "pending"}
            <span class="loading-dots" aria-label={$t("loading")}>
              <span></span><span></span><span></span>
            </span>
          {:else if entry.status === "finished"}
            <span class="duration">{formatDuration(entry.duration)}</span>
          {/if}
        </div>

        <div class="meta-col">
          {#if entry.status === "finished"}
            <span class="start-time">{formatStartTime(entry.startTime)}</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if totalItems === 0}
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
    overflow-x: hidden;
    height: 100%;
  }

  :global(.search-highlight) {
    background: var(--color-highlight, #fef08a);
    border-radius: 2px;
    padding: 0 1px;
    color: inherit;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 12px;
    height: 37px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--color-border-light);
    cursor: pointer;
    transition: background 0.15s;
  }

  .row:hover {
    background: var(--color-bg-secondary);
  }

  .row.selected {
    background: var(--color-primary-bg);
  }

  .method-col {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    min-width: 100px;
    flex: 1;
  }

  .source-tag {
    font-size: 10px;
    font-weight: bold;
    padding: 2px 4px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .source-parsed {
    background: var(--color-success-bg);
    color: var(--color-success);
  }

  .source-unparsed {
    background: var(--color-bg-tertiary);
    color: var(--color-text-secondary);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-text-tertiary);
    flex-shrink: 0;
  }

  .dot.success {
    background: var(--color-success);
  }

  .dot.error {
    background: var(--color-error, #ef4444);
  }

  .dot.pending {
    background: var(--color-purple);
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.3); opacity: 0.5; }
    100% { transform: scale(1); opacity: 1; }
  }

  .pending-text {
    color: var(--color-purple) !important;
    font-style: italic;
  }

  .method-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }

  .meta-col {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
  }

  .start-time {
    font-size: 11px;
    color: var(--color-text-tertiary);
    font-family: monospace;
    width: 60px;
  }

  .duration {
    font-size: 11px;
    color: var(--color-text-tertiary);
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 4 auto;
    min-width: 0;
    max-width: 62px;
  }

  .loading-dots {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: 0 0 auto;
  }

  .loading-dots span {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--color-purple);
    animation: loading-dot 1.05s ease-in-out infinite;
  }

  .loading-dots span:nth-child(2) { animation-delay: 0.15s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.3s; }

  @keyframes loading-dot {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
    30% { transform: translateY(-3px); opacity: 1; }
  }

  .empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: 13px;
  }
</style>

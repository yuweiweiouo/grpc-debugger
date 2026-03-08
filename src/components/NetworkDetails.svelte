<script>
  /**
   * 請求詳情面板 (Network Details)
   *
   * 展示選定請求的所有細節，包含：
   * 1. 標頭 (Headers) 與 一般資訊。
   * 2. 解碼後的請求與回應 JSON 樹。
   * 3. 原始 Proto 欄位定義。
   * 4. 支援將解碼後的資歷導出為 JSON 文字。
   */
  import { selectedEntry } from "../stores/network";
  import { protoEngine } from "../lib/proto-engine";
  import { t } from "../lib/i18n";
  import { combinedView } from "../stores/settings";
  import JsonTree from "./JsonTree.svelte";
  import ProtoFieldRow from "./ProtoFieldRow.svelte";

  let activeTab = "request";
  let copyFeedback = "";
  let searchQuery = "";
  let replayStatus = "";

  // 反應式數據流：當 Store 中的 selectedEntry 改變時，自動重新計算相應的 Proto 定義與訊息結構
  $: entry = $selectedEntry;
  $: protoDef = entry ? protoEngine.findMethod(entry.method, entry.url) : null;
  $: requestMsg = protoDef
    ? protoEngine.findMessage(protoDef.requestType)
    : null;
  $: responseMsg = protoDef
    ? protoEngine.findMessage(protoDef.responseType)
    : null;

  function setTab(tab) {
    activeTab = tab;
  }

  let showCopyModal = false;
  let copyText = "";

  /**
   * JSON 序列化輔助函數
   * 1. 過濾掉 $typeName 內部屬性
   * 2. 處理 BigInt 與 Uint8Array 特殊類型
   */
  function jsonReplacer(key, value) {
    if (key === "$typeName") {
      return undefined;
    }
    if (value instanceof Uint8Array) {
      return `[bytes: ${value.length} bytes]`;
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  }

  function openCopyModal(data) {
    try {
      copyText = JSON.stringify(data, jsonReplacer, 2);
    } catch (e) {
      copyText = `${$t("serialize_failed")}: ${e.message}`;
    }
    showCopyModal = true;
  }

  async function handleCopy(data) {
    const text = JSON.stringify(data, jsonReplacer, 2);

    try {
      await navigator.clipboard.writeText(text);
      copyFeedback = $t("copy_success");
      setTimeout(() => {
        copyFeedback = "";
      }, 1500);
      return;
    } catch {
      // ignore and try legacy fallback
    }

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);

      if (ok) {
        copyFeedback = $t("copy_success");
        setTimeout(() => {
          copyFeedback = "";
        }, 1500);
        return;
      }
    } catch {
      // fallback to manual modal
    }

    copyFeedback = $t("copy_blocked_manual");
    openCopyModal(data);
  }

  function closeCopyModal() {
    showCopyModal = false;
    copyText = "";
  }

  function selectAllText(e) {
    e.target.select();
  }

  async function handleReplay() {
    if (!entry?.url) {
      replayStatus = $t('replay_no_data');
      setTimeout(() => { replayStatus = ''; }, 2000);
      return;
    }

    replayStatus = $t('replaying');

    const headers = entry.requestHeaders || {};
    const body = entry.requestRaw || null;
    const isBase64 = entry.requestBase64Encoded;

    const replayScript = `
      (async function() {
        try {
          const headers = ${JSON.stringify(headers)};
          ${isBase64 && body
            ? `const raw = atob(${JSON.stringify(body)});
               const bytes = new Uint8Array(raw.length);
               for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
               var bodyData = bytes.buffer;`
            : body
              ? `var bodyData = ${JSON.stringify(body)};`
              : `var bodyData = null;`}
          const resp = await fetch(${JSON.stringify(entry.url)}, {
            method: 'POST',
            headers,
            body: bodyData,
          });
          return 'OK:' + resp.status;
        } catch(e) {
          return 'ERR:' + e.message;
        }
      })()
    `;

    if (typeof chrome !== 'undefined' && chrome.devtools?.inspectedWindow) {
      chrome.devtools.inspectedWindow.eval(replayScript, (result, isException) => {
        if (isException || !result || result.startsWith('ERR:')) {
          replayStatus = $t('replay_failed');
        } else {
          replayStatus = $t('replay_success');
        }
        setTimeout(() => { replayStatus = ''; }, 2000);
      });
    } else {
      replayStatus = $t('replay_failed');
      setTimeout(() => { replayStatus = ''; }, 2000);
    }
  }
</script>

<div class="network-details">
  {#if !entry}
    <div class="empty">{$t("select_request")}</div>
  {:else}
    <div class="tabs">
      <button
        class:active={activeTab === "headers"}
        on:click={() => setTab("headers")}>{$t("headers")}</button
      >
      {#if $combinedView}
        <button
          class:active={activeTab === "data"}
          on:click={() => setTab("data")}>{$t("combined_tab")}</button
        >
      {:else}
        <button
          class:active={activeTab === "request"}
          on:click={() => setTab("request")}>{$t("request")}</button
        >
        <button
          class:active={activeTab === "response"}
          on:click={() => setTab("response")}>{$t("response")}</button
        >
      {/if}
      <button
        class:active={activeTab === "proto"}
        on:click={() => setTab("proto")}>{$t("proto")}</button
      >
      <div class="tab-spacer"></div>
      {#if copyFeedback}
        <span class="copy-feedback">{copyFeedback}</span>
      {/if}
      {#if replayStatus}
        <span class="copy-feedback">{replayStatus}</span>
      {/if}
    </div>

    <div class="content">
      {#if activeTab === "headers"}
        <section>
          <h3>{$t("general")}</h3>
          <div class="field">
            <span class="label">{$t("method")}:</span>
            <span class="val">{entry.method}</span>
          </div>
          <div class="field">
            <span class="label">{$t("url")}:</span>
            <span class="val">{entry.url}</span>
          </div>
          <div class="field">
            <span class="label">{$t("status")}:</span>
            <span class="val"
              >{entry.status === "pending"
                ? "Pending (Waiting for Server...)"
                : entry.grpcStatus === 0
                  ? "OK (0)"
                  : `Error (${entry.grpcStatus})`}</span
            >
          </div>
        </section>
        {#if entry.status === "pending"}
          <div class="pending-notice">
            <div class="spinner"></div>
            <p>Waiting for response from server...</p>
          </div>
        {:else}
          {#if entry.url}
            <section>
              <div class="replay-row">
                <button class="replay-btn" on:click={handleReplay}>
                  ▶ {$t('replay')}
                </button>
              </div>
            </section>
          {/if}
          {#if entry.requestHeaders}
            <section>
              <h3>{$t("request_headers")}</h3>
              {#each Object.entries(entry.requestHeaders) as [k, v]}
                <div class="field">
                  <span class="label">{k}:</span> <span class="val">{v}</span>
                </div>
              {/each}
            </section>
          {/if}
        {/if}
      {:else if activeTab === "request"}
        <div class="data-view">
          <div class="data-header">
            <span>Request Data</span>
            {#if entry.request}
              <div class="header-actions">
                <input class="search-input" type="text" placeholder={$t('search_in_data')} bind:value={searchQuery} />
                <button class="copy-btn" on:click={() => handleCopy(entry.request)}>
                  {$t("copy_json")}
                </button>
              </div>
            {/if}
          </div>
          {#if entry.request}
            <JsonTree data={entry.request} {searchQuery} />
          {:else}
            <div class="no-data">{$t("no_data")}</div>
          {/if}
        </div>
      {:else if activeTab === "response"}
        <div class="data-view">
          <div class="data-header">
            <span>Response Data</span>
            {#if entry.response}
              <div class="header-actions">
                <input class="search-input" type="text" placeholder={$t('search_in_data')} bind:value={searchQuery} />
                <button class="copy-btn" on:click={() => handleCopy(entry.response)}>
                  {$t("copy_json")}
                </button>
              </div>
            {/if}
          </div>
          {#if entry.response}
            <JsonTree data={entry.response} {searchQuery} />
          {:else if entry.status === "pending"}
            <div class="no-data">Waiting for response...</div>
          {:else}
            <div class="no-data">{$t("no_data")}</div>
          {/if}
        </div>
      {:else if activeTab === "data"}
        <!-- 合併視圖：同時顯示請求和回應 -->
        <div class="combined-view">
          <div class="combined-section">
            <div class="data-header">
              <span>📤 {$t("request")}</span>
              {#if entry.request}
                <div class="header-actions">
                  <input class="search-input" type="text" placeholder={$t('search_in_data')} bind:value={searchQuery} />
                  <button class="copy-btn" on:click={() => handleCopy(entry.request)}>
                    {$t("copy_json")}
                  </button>
                </div>
              {/if}
            </div>
            {#if entry.request}
              <JsonTree data={entry.request} {searchQuery} />
            {:else}
              <div class="no-data">{$t("no_data")}</div>
            {/if}
          </div>

          <div class="combined-divider"></div>

          <div class="combined-section">
            <div class="data-header">
              <span>📥 {$t("response")}</span>
              {#if entry.response}
                <div class="header-actions">
                  <button class="copy-btn" on:click={() => handleCopy(entry.response)}>
                    {$t("copy_json")}
                  </button>
                </div>
              {/if}
            </div>
            {#if entry.response}
              <JsonTree data={entry.response} {searchQuery} />
            {:else if entry.status === "pending"}
              <div class="no-data">Waiting for response...</div>
            {:else}
              <div class="no-data">{$t("no_data")}</div>
            {/if}
          </div>
        </div>
      {:else if activeTab === "proto"}
        <div class="proto-view">
          {#if protoDef}
            <div class="msg-section">
              <h4>{$t("request_message")}: {protoDef.requestType}</h4>
              <table class="proto-table">
                <thead
                  ><tr><th>#</th><th>{$t("name")}</th><th>{$t("type")}</th></tr
                  ></thead
                >
                <tbody>
                  {#each requestMsg?.fields || [] as f}
                    <ProtoFieldRow field={f} />
                  {/each}
                </tbody>
              </table>
            </div>
            <div class="msg-section">
              <h4>{$t("response_message")}: {protoDef.responseType}</h4>
              <table class="proto-table">
                <thead
                  ><tr><th>#</th><th>{$t("name")}</th><th>{$t("type")}</th></tr
                  ></thead
                >
                <tbody>
                  {#each responseMsg?.fields || [] as f}
                    <ProtoFieldRow field={f} />
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <div class="no-data">{$t("no_data")}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if showCopyModal}
  <div
    class="modal-overlay"
    on:click|self={closeCopyModal}
    on:keydown={(e) => e.key === "Escape" && closeCopyModal()}
    role="button"
    tabindex="-1"
  >
    <div class="modal-content" role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <span>{$t("copy_json")}</span>
        <button class="modal-close" on:click={closeCopyModal}>✕</button>
      </div>
      <textarea
        class="copy-textarea"
        readonly
        value={copyText}
        on:focus={selectAllText}
      ></textarea>
      <p class="modal-hint">{$t("copy_hint")}</p>
    </div>
  </div>
{/if}


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
    color: var(--color-text-tertiary);
    font-size: 14px;
  }

  .pending-notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: var(--color-purple);
    gap: 12px;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid var(--color-border-light);
    border-top: 3px solid var(--color-purple);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--color-border);
    padding: 0 12px;
    gap: 8px;
    background: var(--color-bg-primary);
  }

  .tab-spacer {
    flex: 1;
  }

  .copy-feedback {
    margin-left: 8px;
    font-size: 11px;
    color: var(--color-success);
    align-self: center;
    white-space: nowrap;
  }

  .tabs button {
    background: transparent;
    border: none;
    padding: 6px 10px;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-secondary);
    cursor: pointer;
    position: relative;
  }

  .tabs button.active {
    color: var(--color-primary);
  }

  .tabs button.active::after {
    content: "";
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--color-primary);
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
  }

  section {
    margin-bottom: 24px;
  }

  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-tertiary);
    margin-bottom: 12px;
    border-bottom: 1px solid var(--color-border-light);
    padding-bottom: 4px;
  }

  .field {
    font-size: 13px;
    margin-bottom: 6px;
    word-break: break-all;
  }

  .label {
    font-weight: 600;
    color: var(--color-text-secondary);
    margin-right: 8px;
  }

  .val {
    color: var(--color-text-primary);
  }

  .data-view,
  .proto-view {
    padding: 8px;
  }

  .data-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--color-border-light);
    margin-bottom: 12px;
  }

  .data-header span {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .search-input {
    background: var(--color-bg-tertiary, #f3f4f6);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
    color: var(--color-text-primary);
    width: 160px;
    outline: none;
    transition: border-color 0.2s;
  }

  .search-input:focus {
    border-color: var(--color-primary);
  }

  .copy-btn {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--color-text-primary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .copy-btn:hover {
    background: var(--color-bg-hover);
    border-color: var(--color-text-tertiary);
  }

  .replay-row {
    display: flex;
    gap: 8px;
  }

  .replay-btn {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    color: var(--color-primary);
    cursor: pointer;
    font-weight: 500;
    transition: all 0.15s;
  }

  .replay-btn:hover {
    background: var(--color-primary-bg);
    border-color: var(--color-primary);
  }

  .no-data {
    text-align: center;
    padding: 40px;
    color: var(--color-text-tertiary);
    font-style: italic;
  }

  .msg-section {
    margin-bottom: 32px;
  }

  h4 {
    font-size: 11px;
    color: var(--color-text-secondary);
    background: var(--color-bg-secondary);
    padding: 4px 8px;
    border-radius: 4px;
    margin-bottom: 12px;
  }

  .proto-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .proto-table th {
    border: 1px solid var(--color-border-light);
    padding: 8px;
    text-align: left;
    background: var(--color-bg-secondary);
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .proto-table :global(td) {
    border: 1px solid var(--color-border-light);
    padding: 8px;
    text-align: left;
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--color-bg-primary);
    border-radius: 8px;
    width: 90%;
    max-width: 600px;
    max-height: 80%;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 16px;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: 4px 8px;
  }

  .modal-close:hover {
    color: var(--color-text-primary);
  }

  .copy-textarea {
    flex: 1;
    margin: 12px 16px;
    padding: 12px;
    font-family: monospace;
    font-size: 12px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    resize: none;
    min-height: 200px;
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .modal-hint {
    padding: 8px 16px 16px;
    font-size: 12px;
    color: var(--color-text-secondary);
    text-align: center;
  }

  .combined-view {
    padding: 8px;
  }

  .combined-section {
    margin-bottom: 16px;
  }

  .combined-divider {
    height: 1px;
    background: linear-gradient(to right, transparent, var(--color-border), transparent);
    margin: 20px 0;
  }
</style>

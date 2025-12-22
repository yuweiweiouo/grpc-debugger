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
  import JsonTree from "./JsonTree.svelte";
  import ProtoFieldRow from "./ProtoFieldRow.svelte";

  let activeTab = "request";
  let copyFeedback = "";

  // 反應式數據流：當 Store 中的 selectedEntry 改變時，自動重新計算相應的 Proto 定義與訊息結構
  $: entry = $selectedEntry;
  $: protoDef = entry ? protoEngine.findMethod(entry.method) : null;
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
      copyText = `序列化失敗: ${e.message}`;
    }
    showCopyModal = true;
  }

  function closeCopyModal() {
    showCopyModal = false;
    copyText = "";
  }

  function selectAllText(e) {
    e.target.select();
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
      <button
        class:active={activeTab === "request"}
        on:click={() => setTab("request")}>{$t("request")}</button
      >
      <button
        class:active={activeTab === "response"}
        on:click={() => setTab("response")}>{$t("response")}</button
      >
      <button
        class:active={activeTab === "proto"}
        on:click={() => setTab("proto")}>{$t("proto")}</button
      >
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
        {:else if entry.requestHeaders}
          <section>
            <h3>{$t("request_headers")}</h3>
            {#each Object.entries(entry.requestHeaders) as [k, v]}
              <div class="field">
                <span class="label">{k}:</span> <span class="val">{v}</span>
              </div>
            {/each}
          </section>
        {/if}
      {:else if activeTab === "request"}
        <div class="data-view">
          <div class="data-header">
            <span>Request Data</span>
            {#if entry.request}
              <button
                class="copy-btn"
                on:click={() => openCopyModal(entry.request)}
              >
                📋 {$t("copy_json")}
              </button>
            {/if}
          </div>
          {#if entry.request}
            <JsonTree data={entry.request} />
          {:else}
            <div class="no-data">{$t("no_data")}</div>
          {/if}
        </div>
      {:else if activeTab === "response"}
        <div class="data-view">
          <div class="data-header">
            <span>Response Data</span>
            {#if entry.response}
              <button
                class="copy-btn"
                on:click={() => openCopyModal(entry.response)}
              >
                📋 {$t("copy_json")}
              </button>
            {/if}
          </div>
          {#if entry.response}
            <JsonTree data={entry.response} />
          {:else if entry.status === "pending"}
            <div class="no-data">Waiting for response...</div>
          {:else}
            <div class="no-data">{$t("no_data")}</div>
          {/if}
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
    on:click={closeCopyModal}
    on:keydown={(e) => e.key === "Escape" && closeCopyModal()}
    role="button"
    tabindex="-1"
  >
    <div class="modal-content" on:click|stopPropagation role="dialog">
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
    color: #9ca3af;
    font-size: 14px;
  }

  .pending-notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: #8b5cf6;
    gap: 12px;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid #f3f3f3;
    border-top: 3px solid #8b5cf6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
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
    padding: 6px 10px;
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
    content: "";
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
    padding: 4px 8px;
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

  .data-view,
  .proto-view {
    padding: 8px;
  }

  .data-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #f3f4f6;
    margin-bottom: 12px;
  }

  .data-header span {
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
  }

  .copy-btn {
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    color: #374151;
    cursor: pointer;
    transition: all 0.15s;
  }

  .copy-btn:hover {
    background: #e5e7eb;
    border-color: #d1d5db;
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

  .proto-table th,
  .proto-table td {
    border: 1px solid #f3f4f6;
    padding: 8px;
    text-align: left;
  }

  .proto-table th {
    background: #f9fafb;
    font-weight: 600;
    color: #4b5563;
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
    background: white;
    border-radius: 8px;
    width: 90%;
    max-width: 600px;
    max-height: 80%;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #e5e7eb;
    font-weight: 600;
    color: #374151;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 16px;
    color: #9ca3af;
    cursor: pointer;
    padding: 4px 8px;
  }

  .modal-close:hover {
    color: #374151;
  }

  .copy-textarea {
    flex: 1;
    margin: 12px 16px;
    padding: 12px;
    font-family: monospace;
    font-size: 12px;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    resize: none;
    min-height: 200px;
    background: #f9fafb;
  }

  .modal-hint {
    padding: 8px 16px 16px;
    font-size: 12px;
    color: #6b7280;
    text-align: center;
  }
</style>

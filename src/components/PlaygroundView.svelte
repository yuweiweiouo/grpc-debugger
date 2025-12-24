<script>
  /**
   * gRPC Playground - 請求測試介面
   *
   * 類似 grpcui 的功能，讓使用者可以：
   * 1. 選擇已載入的服務和方法
   * 2. 輸入 JSON 格式的請求內容
   * 3. 發送 gRPC-Web 請求並查看回應
   */
  import { services } from "../stores/schema";
  import { protoEngine } from "../lib/proto-engine";
  import { t } from "../lib/i18n";
  import { sendGrpcWebRequest } from "../lib/grpc-web-transport";
  import {
    Play,
    AlertCircle,
    CheckCircle2,
    Pencil,
    Check,
  } from "lucide-svelte";

  let selectedService = null;
  let selectedMethod = null;
  let baseUrl = "";
  let requestBody = "{}";
  let requestHeaders = "{}";
  let response = null;
  let responseHeaders = null;
  let error = null;
  let isLoading = false;
  let isEditingUrl = false;

  // 當選擇服務時，自動填充該服務的來源 host
  $: if (selectedService?.sourceHost) {
    baseUrl = selectedService.sourceHost;
    isEditingUrl = false;
  }

  $: availableMethods = selectedService?.methods || [];

  $: if (
    selectedService &&
    !availableMethods.find((m) => m.name === selectedMethod?.name)
  ) {
    selectedMethod = null;
  }

  // 當選擇方法時，自動填入請求模板 (grpcui 風格)
  $: if (selectedMethod) {
    const template = protoEngine?.getMessageTemplate(
      selectedMethod.requestType,
    );
    if (template) {
      requestBody = formatJson(template);
    }
  }

  function toggleEditUrl() {
    isEditingUrl = !isEditingUrl;
  }

  async function sendRequest() {
    if (!selectedService || !selectedMethod || !baseUrl) return;

    isLoading = true;
    error = null;
    response = null;

    try {
      const serviceName = selectedService.fullName;
      const methodName = selectedMethod.name;
      const methodPath = `/${serviceName}/${methodName}`;
      const fullUrl = baseUrl.replace(/\/$/, "") + methodPath;

      const methodInfo = protoEngine?.findMethod(methodPath);
      if (!methodInfo) {
        throw new Error(`找不到方法定義: ${methodPath}`);
      }

      const requestJson = JSON.parse(requestBody);
      const customHeaders = JSON.parse(requestHeaders);
      const requestBytes = protoEngine?.encodeMessage(
        methodInfo.requestType,
        requestJson,
      );

      if (!requestBytes) {
        throw new Error(`無法編碼請求: ${methodInfo.requestType}`);
      }

      const { data: responseFrames, headers: resHeaders } =
        await sendGrpcWebRequest(fullUrl, requestBytes, customHeaders);
      responseHeaders = resHeaders;

      if (responseFrames && responseFrames.length > 0) {
        const decoded = protoEngine?.decodeMessage(
          methodInfo.responseType,
          responseFrames[0],
        );
        response = decoded;
      } else {
        response = { _info: "空回應" };
      }
    } catch (e) {
      error = e.message;
    } finally {
      isLoading = false;
    }
  }

  function formatJson(obj) {
    try {
      return JSON.stringify(
        obj,
        (key, value) => {
          if (key === "$typeName") return undefined;
          if (typeof value === "bigint") return value.toString();
          return value;
        },
        2,
      );
    } catch (e) {
      return String(obj);
    }
  }
</script>

<div class="playground-page">
  <div class="playground-content">
    <div class="form-section">
      <div class="form-grid">
        <div class="form-row">
          <label>{$t("enter_base_url")}</label>
          <div class="url-input-wrapper">
            <input
              type="text"
              bind:value={baseUrl}
              placeholder="https://your-server.com"
              readonly={!isEditingUrl}
              class:readonly={!isEditingUrl}
            />
            <button
              class="edit-btn"
              class:active={isEditingUrl}
              on:click={toggleEditUrl}
              title={isEditingUrl ? $t("lock_url") : $t("edit_url")}
            >
              {#if isEditingUrl}
                <Check size={14} />
              {:else}
                <Pencil size={14} />
              {/if}
            </button>
          </div>
        </div>

        <div class="form-row">
          <label>{$t("select_service")}</label>
          <select bind:value={selectedService}>
            <option value={null}>-- {$t("select_service")} --</option>
            {#each $services as svc}
              <option value={svc}>{svc.fullName}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="form-row">
        <label>{$t("select_method")}</label>
        <select bind:value={selectedMethod} disabled={!selectedService}>
          <option value={null}>-- {$t("select_method")} --</option>
          {#each availableMethods as method}
            <option value={method}>{method.name}</option>
          {/each}
        </select>
      </div>

      <div class="form-row">
        <label>Request Headers (JSON)</label>
        <textarea
          bind:value={requestHeaders}
          placeholder={`Enter JSON headers, e.g. {"authorization": "Bearer ..."}`}
          rows="2"
          class="headers-textarea"
        ></textarea>
      </div>

      <div class="form-row">
        <label>{$t("request_body")}</label>
        <textarea
          bind:value={requestBody}
          placeholder="Enter JSON request body"
          rows="8"
        ></textarea>
      </div>

      <button
        class="send-btn"
        on:click={sendRequest}
        disabled={!selectedService || !selectedMethod || !baseUrl || isLoading}
      >
        {#if isLoading}
          {$t("sending")}
        {:else}
          <Play size={16} />
          {$t("send_request")}
        {/if}
      </button>
    </div>

    <div class="response-section">
      <h3>{$t("response_body")}</h3>

      {#if error}
        <div class="error-box">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      {:else if response}
        <div class="success-indicator">
          <CheckCircle2 size={14} />
          <span>Success</span>
        </div>

        <div class="res-block">
          <h4>{$t("response_body")}</h4>
          <pre class="response-json">{formatJson(response)}</pre>
        </div>

        {#if responseHeaders}
          <div class="res-block">
            <h4>Response Headers</h4>
            <pre class="response-json small">{formatJson(responseHeaders)}</pre>
          </div>
        {/if}
      {:else}
        <div class="empty-response">選擇服務和方法後點擊發送</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .playground-page {
    padding: 24px;
    height: 100%;
    overflow-y: auto;
    background: #f9fafb;
  }

  .playground-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    max-width: 1200px;
  }

  .form-section,
  .response-section {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .form-row {
    margin: 0;
  }

  .url-input-wrapper {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .url-input-wrapper input {
    flex: 1;
  }

  .url-input-wrapper input.readonly {
    background: #f9fafb;
    color: #6b7280;
  }

  .edit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .edit-btn:hover {
    background: #e5e7eb;
    color: #374151;
  }

  .edit-btn.active {
    background: #dbeafe;
    border-color: #3b82f6;
    color: #2563eb;
  }

  label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: #374151;
    margin-bottom: 6px;
  }

  input,
  select,
  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 13px;
    font-family: inherit;
    background: white;
    box-sizing: border-box;
  }

  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
  }

  textarea {
    font-family: monospace;
    resize: vertical;
  }

  .headers-textarea {
    font-size: 11px;
    padding: 8px;
    min-height: 50px;
  }

  select:disabled {
    background: #f3f4f6;
    color: #9ca3af;
  }

  .send-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 12px;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .send-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .send-btn:disabled {
    background: #9ca3af;
    cursor: not-allowed;
  }

  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 600;
    color: #4b5563;
  }

  .res-block {
    margin-bottom: 16px;
  }

  .error-box {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    border-radius: 8px;
    color: #dc2626;
    font-size: 13px;
  }

  .success-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
    color: #059669;
    font-size: 12px;
    font-weight: 500;
  }

  .response-json {
    margin: 0;
    padding: 16px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    font-size: 12px;
    font-family: monospace;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .response-json.small {
    font-size: 10px;
    padding: 10px;
  }

  .empty-response {
    padding: 40px 20px;
    text-align: center;
    color: #9ca3af;
    font-size: 13px;
  }
</style>

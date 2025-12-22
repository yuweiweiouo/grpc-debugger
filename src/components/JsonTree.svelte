<script>
  /**
   * JSON 樹狀瀏覽組件 (Recursive JSON Tree)
   * 
   * 職責：
   * 1. 以無限遞迴的方式呈現 Protobuf 解碼後的巢狀物件結構。
   * 2. 針對 Protobuf 特殊類型 (Bytes, BigInt) 進行美化顯示。
   * 3. 支援節點展開/摺疊，預設只展開前兩層以維護性能。
   */
  export let data;
  export let label = null;
  export let depth = 0;
  export let expanded = depth < 2;

  $: isObject =
    typeof data === "object" && data !== null && !(data instanceof Uint8Array);
  $: objectTypeName = isObject && data.$typeName ? data.$typeName : "";
  $: keys = isObject ? Object.keys(data).filter((k) => k !== "$typeName") : [];
  $: type = getType(data);

  /**
   * 偵測資料類型以匹配不同的 CSS 樣式
   */
  function getType(val) {
    if (Array.isArray(val)) return "Array";
    if (val instanceof Uint8Array) return "Uint8Array";
    if (typeof val === "bigint") return "BigInt";
    if (typeof val === "object" && val !== null) return "Object";
    return typeof val;
  }

  /**
   * 資料視覺化預處理
   * 確保 bytes 或超大數值能以人類可讀的格式顯示。
   */
  function formatValue(val) {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (typeof val === "bigint") return val.toString(); 
    if (val instanceof Uint8Array) {
      if (val.length === 0) return "[]";
      // 對短 Byte 陣列顯示 16 進位預覽
      if (val.length <= 16) {
        return `[${Array.from(val)
          .map((b) => "0x" + b.toString(16).padStart(2, "0"))
          .join(", ")}]`;
      }
      // 對長 Byte 陣列僅顯示長度
      return `[${val.length} bytes]`;
    }
    if (typeof val === "string") return `"${val}"`;
    return String(val);
  }

  function toggle() {
    expanded = !expanded;
  }
  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }
</script>

<div class="json-node" style="padding-left: {depth > 0 ? 16 : 0}px">
  {#if isObject}
    <div
      class="item"
      on:click={toggle}
      on:keydown={handleKeyDown}
      role="button"
      tabindex="0"
    >
      <span class="toggle">{expanded ? "▼" : "▶"}</span>
      {#if label}<span class="key">{label}:</span>{/if}
      <span class="type">
        {objectTypeName || type} [{keys.length}]
      </span>
    </div>
    {#if expanded}
      {#each keys as key}
        <svelte:self data={data[key]} label={key} depth={depth + 1} />
      {/each}
    {/if}
  {:else}
    <div class="item leaf">
      {#if label}<span class="key">{label}:</span>{/if}
      <span
        class="value"
        class:string={typeof data === "string"}
        class:number={typeof data === "number"}
        class:bigint={typeof data === "bigint"}
        class:bytes={data instanceof Uint8Array}
      >
        {formatValue(data)}
      </span>
    </div>
  {/if}
</div>

<style>
  .json-node {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 13px;
    line-height: 1.6;
    user-select: text;
  }

  .item {
    cursor: pointer;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 1px 0;
  }

  .item:hover {
    background: #f3f4f6;
  }

  .item.leaf {
    cursor: default;
    padding-left: 14px;
  }

  .toggle {
    font-size: 8px;
    width: 10px;
    color: #9ca3af;
  }

  .key {
    color: #8b5cf6;
    font-weight: 500;
  }

  .type {
    color: #9ca3af;
    font-size: 11px;
    font-style: italic;
  }

  .value {
    color: #111827;
  }

  .value.string {
    color: #059669;
  }

  .value.number {
    color: #2563eb;
  }

  .value.bigint {
    color: #7c3aed;
  }

  .value.bytes {
    color: #ea580c;
    font-size: 12px;
  }
</style>

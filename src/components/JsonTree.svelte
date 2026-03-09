<script>
  import { tick } from "svelte";

  export let data;
  export let label = null;
  export let depth = 0;
  export let expanded = depth < 2;
  export let searchQuery = "";
  export let activePath = null;
  export let currentPath = "";

  $: myPath =
    label != null
      ? currentPath
        ? `${currentPath}.${label}`
        : String(label)
      : currentPath;

  $: isObject =
    typeof data === "object" && data !== null && !(data instanceof Uint8Array);
  $: objectTypeName = isObject && data.$typeName ? data.$typeName : "";
  $: keys = isObject ? Object.keys(data).filter((k) => k !== "$typeName") : [];
  $: type = getType(data);

  $: hasMatchInChildren =
    searchQuery && isObject ? checkChildrenMatch(data, searchQuery) : false;
  $: hasActiveInChildren =
    activePath != null && myPath !== "" && activePath.startsWith(myPath + ".");
  $: shouldExpand = expanded || hasMatchInChildren || hasActiveInChildren;

  $: isActiveKey = activePath === myPath + ":key";
  $: isActiveValue = activePath === myPath + ":value";

  function getType(val) {
    if (Array.isArray(val)) return "Array";
    if (val instanceof Uint8Array) return "Uint8Array";
    if (typeof val === "bigint") return "BigInt";
    if (typeof val === "object" && val !== null) return "Object";
    return typeof val;
  }

  function formatValue(val) {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (typeof val === "bigint") return val.toString();
    if (val instanceof Uint8Array) {
      if (val.length === 0) return "[]";
      if (val.length <= 16) {
        return `[${Array.from(val)
          .map((b) => "0x" + b.toString(16).padStart(2, "0"))
          .join(", ")}]`;
      }
      return `[${val.length} bytes]`;
    }
    if (typeof val === "string") return `"${val}"`;
    return String(val);
  }

  function checkChildrenMatch(obj, query) {
    if (!query || !obj) return false;
    const q = query.toLowerCase();
    for (const key of Object.keys(obj)) {
      if (key === "$typeName") continue;
      if (key.toLowerCase().includes(q)) return true;
      const val = obj[key];
      if (val !== null && val !== undefined) {
        const str = typeof val === "object" ? "" : String(val);
        if (str.toLowerCase().includes(q)) return true;
        if (typeof val === "object" && !(val instanceof Uint8Array)) {
          if (checkChildrenMatch(val, query)) return true;
        }
      }
    }
    return false;
  }

  function isMatch(text) {
    if (!searchQuery || !text) return false;
    return String(text).toLowerCase().includes(searchQuery.toLowerCase());
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

  function scrollIfActive(node, active) {
    if (active)
      tick().then(() =>
        node.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
    return {
      update(active) {
        if (active)
          tick().then(() =>
            node.scrollIntoView({ block: "nearest", behavior: "smooth" }),
          );
      },
    };
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
      <span class="toggle">{shouldExpand ? "▼" : "▶"}</span>
      {#if label != null}
        <span
          class="key"
          class:highlighted={isMatch(label)}
          class:active-match={isActiveKey}
          use:scrollIfActive={isActiveKey}>{label}:</span
        >
      {/if}
      <span class="type">
        {objectTypeName || type} [{keys.length}]
      </span>
    </div>
    {#if shouldExpand}
      {#each keys as key}
        <svelte:self
          data={data[key]}
          label={key}
          depth={depth + 1}
          {searchQuery}
          {activePath}
          currentPath={myPath}
        />
      {/each}
    {/if}
  {:else}
    <div class="item leaf">
      {#if label != null}
        <span
          class="key"
          class:highlighted={isMatch(label)}
          class:active-match={isActiveKey}
          use:scrollIfActive={isActiveKey}>{label}:</span
        >
      {/if}
      <span
        class="value"
        class:string={typeof data === "string"}
        class:number={typeof data === "number"}
        class:bigint={typeof data === "bigint"}
        class:bytes={data instanceof Uint8Array}
        class:highlighted={isMatch(formatValue(data))}
        class:active-match={isActiveValue}
        use:scrollIfActive={isActiveValue}
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
    background: var(--color-bg-hover, #f3f4f6);
  }

  .item.leaf {
    cursor: default;
    padding-left: 14px;
  }

  .toggle {
    font-size: 8px;
    width: 10px;
    color: var(--color-text-tertiary, #9ca3af);
  }

  .key {
    color: var(--color-purple, #8b5cf6);
    font-weight: 500;
  }

  .type {
    color: var(--color-text-tertiary, #9ca3af);
    font-size: 11px;
    font-style: italic;
  }

  .value {
    color: var(--color-text-primary, #111827);
  }

  .value.string {
    color: var(--color-success, #059669);
  }

  .value.number {
    color: var(--color-primary, #2563eb);
  }

  .value.bigint {
    color: var(--color-purple-dark, #7c3aed);
  }

  .value.bytes {
    color: var(--color-warning, #ea580c);
    font-size: 12px;
  }

  .highlighted {
    background: var(--color-highlight, #fef08a);
    border-radius: 2px;
    padding: 0 2px;
  }

  .active-match {
    background: var(--color-primary, #2563eb) !important;
    color: white !important;
    border-radius: 2px;
    padding: 0 2px;
    outline: 2px solid var(--color-primary, #2563eb);
    outline-offset: 1px;
  }
</style>

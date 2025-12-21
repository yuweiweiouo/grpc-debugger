<script>
  export let data;
  export let label = null;
  export let depth = 0;
  export let expanded = depth < 2;

  $: isObject = typeof data === 'object' && data !== null;
  $: keys = isObject ? Object.keys(data) : [];
  $: type = Array.isArray(data) ? 'Array' : (isObject ? 'Object' : typeof data);

  function toggle() {
    expanded = !expanded;
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
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
      <span class="toggle">{expanded ? '▼' : '▶'}</span>
      {#if label}<span class="key">{label}:</span>{/if}
      <span class="type">{type} [{keys.length}]</span>
    </div>
    {#if expanded}
      {#each keys as key}
        <svelte:self data={data[key]} label={key} depth={depth + 1} />
      {/each}
    {/if}
  {:else}
    <div class="item leaf">
      {#if label}<span class="key">{label}:</span>{/if}
      <span class="value" class:string={type === 'string'} class:number={type === 'number'}>
        {type === 'string' ? `"${data}"` : data}
      </span>
    </div>
  {/if}
</div>

<style>
  .json-node {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
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
</style>

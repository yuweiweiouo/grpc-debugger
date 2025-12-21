<script>
  import { protoEngine } from '../lib/proto-engine';
  
  export let field;
  export let level = 0;
  
  let expanded = false;
  
  $: isMessage = field.type === 11 || (field.type_name && field.type_name.includes('.'));
  $: nestedMsg = isMessage && field.type_name ? protoEngine.findMessage(field.type_name) : null;
  
  function toggle() {
    if (nestedMsg) {
      expanded = !expanded;
    }
  }
  
  function getTypeDisplay(f) {
    if (f.type_name) return f.type_name;
    const typeMap = {1:'double',2:'float',3:'int64',4:'uint64',5:'int32',8:'bool',9:'string',12:'bytes',13:'uint32'};
    return typeMap[f.type] || `type_${f.type}`;
  }
</script>

<tr class="proto-row" class:nested={level > 0}>
  <td class="col-num">{field.number}</td>
  <td class="col-name" style="padding-left: {12 + level * 20}px">
    {field.name}
  </td>
  <td class="col-type">
    {#if nestedMsg}
      <button class="type-link" on:click={toggle}>
        <span class="arrow">{expanded ? '▼' : '▶'}</span>
        {getTypeDisplay(field)}
      </button>
    {:else}
      <span class="type-plain">{getTypeDisplay(field)}</span>
    {/if}
  </td>
</tr>

{#if expanded && nestedMsg}
  {#each nestedMsg.fields || [] as subField}
    <svelte:self field={subField} level={level + 1} />
  {/each}
{/if}

<style>
  .proto-row td {
    padding: 8px 12px;
    border-bottom: 1px solid #f3f4f6;
    font-size: 12px;
  }
  
  .proto-row.nested td {
    background: #fafbfc;
  }
  
  .col-num {
    width: 50px;
    text-align: center;
    color: #9ca3af;
    font-weight: 500;
  }
  
  .col-name {
    font-weight: 500;
    color: #374151;
  }
  
  .col-type {
    color: #6b7280;
  }
  
  .type-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: #2563eb;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .type-link:hover {
    text-decoration: underline;
  }
  
  .arrow {
    font-size: 10px;
    color: #9ca3af;
    width: 12px;
  }
  
  .type-plain {
    color: #6b7280;
  }
</style>

<script>
  /**
   * 服務列表首頁 (Services View)
   *
   * 職責：
   * 1. 顯示目前 Debugger 載入的所有 gRPC 服務。
   * 2. 支援過濾功能。
   * 3. 提供顯示切換 (Toggle Visibility) 功能，控制特定服務是否出現在 Network 日誌中。
   */
  import {
    services,
    toggleServiceVisibility,
  } from "../stores/schema";
  import { t } from "../lib/i18n";
  import { ShieldCheck, Box, Eye, EyeOff } from "lucide-svelte";
</script>

<div class="services-page">
  <header>
    <div class="title">
      <ShieldCheck size={20} />
      <h2>{$t("loaded_services")}</h2>
    </div>
  </header>

  <div class="service-grid">
    {#each $services as service}
      <div class="service-card">
        <div class="card-header">
          <div class="header-left">
            <Box size={16} color={service.hidden ? "#9ca3af" : "#8b5cf6"} />
            <span class="pkg"
              >{service.fullName.split(".").slice(0, -1).join(".")}</span
            >
          </div>
          <button
            class="visibility-toggle"
            class:hidden={service.hidden}
            on:click={() => toggleServiceVisibility(service.fullName)}
            title={service.hidden ? $t("show_in_log") : $t("hide_from_log")}
          >
            {#if service.hidden}
              <EyeOff size={14} />
            {:else}
              <Eye size={14} />
            {/if}
          </button>
        </div>
        <h3 class:muted={service.hidden}>{service.name}</h3>
        <div class="methods">
          {#each service.methods as method}
            <div class="method-chip">{method.name}</div>
          {/each}
        </div>
      </div>
    {/each}

    {#if $services.length === 0}
      <div class="empty-state">
        <p>{$t("no_schemas_yet")}</p>
        <span class="hint">{$t("hint_register")}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .services-page {
    padding: 24px;
    height: 100%;
    overflow-y: auto;
    background: var(--color-bg-secondary);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--color-text-primary);
  }

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .service-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
  }

  .service-card {
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .pkg {
    font-size: 10px;
    color: var(--color-text-secondary);
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
    color: var(--color-text-primary);
    transition: color 0.2s;
  }

  h3.muted {
    color: var(--color-text-tertiary);
  }

  .visibility-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .visibility-toggle:hover {
    background: var(--color-bg-hover);
    color: var(--color-purple);
  }

  .visibility-toggle.hidden {
    color: var(--color-error);
  }

  .visibility-toggle.hidden:hover {
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  .methods {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .method-chip {
    font-size: 10px;
    background: var(--color-bg-tertiary);
    color: var(--color-text-secondary);
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
  }

  .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    padding: 100px 20px;
    color: var(--color-text-tertiary);
  }

  .hint {
    font-size: 12px;
    color: var(--color-border);
  }
</style>

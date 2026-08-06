<script>
  /**
   * 側邊導航欄 (Sidebar)
   *
   * 提供主要功能頁面的切換按鈕。
   */
  import { activePage, navigate } from "../stores/ui";
  import { t } from "../lib/i18n";
  import { APP_VERSION } from "../lib/version";
  import { Activity, ShieldCheck, Settings } from "lucide-svelte";
</script>

<nav class="sidebar">
  <div class="nav-items">
    <button
      class:active={$activePage === "network"}
      on:click={() => navigate("network")}
      title={$t("network")}
    >
      <Activity size={20} />
    </button>

    <button
      class:active={$activePage === "services"}
      on:click={() => navigate("services")}
      title={$t("services")}
    >
      <ShieldCheck size={20} />
    </button>
  </div>

  <div class="bottom">
    <button
      class:active={$activePage === "settings"}
      on:click={() => navigate("settings")}
      title={$t("settings")}
    >
      <Settings size={20} />
    </button>
    <div class="version">v{APP_VERSION}</div>
  </div>
</nav>

<style>
  .sidebar {
    width: auto;
    height: 52px;
    background: var(--color-bg-primary);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 0 8px;
    gap: 8px;
    flex: 0 0 auto;
  }

  .nav-items {
    display: flex;
    flex-direction: row;
    gap: 4px;
  }

  .bottom {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }

  .version {
    font-size: 9px;
    font-weight: bold;
    color: var(--color-text-tertiary);
    margin-left: 2px;
    opacity: 0.5;
  }

  button {
    background: transparent;
    border: none;
    padding: 8px;
    border-radius: 8px;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  button:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  button.active {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }

</style>

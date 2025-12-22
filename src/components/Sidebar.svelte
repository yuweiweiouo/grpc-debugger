<script>
  import { activePage, navigate } from "../stores/ui";
  import { t } from "../lib/i18n";
  import { Activity, ShieldCheck, Settings, Box } from "lucide-svelte";
</script>

<nav class="sidebar">
  <div class="logo">
    <Box size={24} color="#2563eb" />
  </div>

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
    <div class="version">v2.7</div>
  </div>
</nav>

<style>
  .sidebar {
    width: 64px;
    background: #ffffff;
    border-right: 1px solid #e5e7eb;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 0;
    gap: 12px;
  }

  .logo {
    margin-bottom: 4px;
  }

  .nav-items {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .version {
    font-size: 9px;
    font-weight: bold;
    color: #9ca3af;
    margin-top: 2px;
    text-align: center;
    opacity: 0.5;
  }

  button {
    background: transparent;
    border: none;
    padding: 12px;
    border-radius: 12px;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  button:hover {
    background: #f3f4f6;
    color: #111827;
  }

  button.active {
    background: #eff6ff;
    color: #2563eb;
  }
</style>

<script>
  import { language, combinedView, theme } from "../stores/settings";
  import { t } from "../lib/i18n";
  import { APP_VERSION, APP_NAME } from "../lib/version";
  import { Settings, Globe, Bug, Layout, Palette } from "lucide-svelte";

  function setLanguage(lang) {
    language.set(lang);
  }

  function toggleCombinedView() {
    combinedView.update((v) => !v);
  }

  function setTheme(val) {
    theme.set(val);
  }

  function openIssue() {
    window.open(
      "https://github.com/yuweiweiouo/grpc-debugger/issues/new",
      "_blank",
    );
  }
</script>

<div class="settings-page">
  <header>
    <div class="title">
      <Settings size={20} />
      <h2>{$t("settings")}</h2>
    </div>
  </header>

  <div class="settings-content">
    <section class="card">
      <div class="card-title">
        <Palette size={18} />
        <h3>{$t("appearance")}</h3>
      </div>

      <div class="lang-options">
        <button
          class:active={$theme === "light"}
          on:click={() => setTheme("light")}
        >
          ☀️ {$t("theme_light")}
        </button>
        <button
          class:active={$theme === "dark"}
          on:click={() => setTheme("dark")}
        >
          🌙 {$t("theme_dark")}
        </button>
        <button
          class:active={$theme === "system"}
          on:click={() => setTheme("system")}
        >
          💻 {$t("theme_system")}
        </button>
      </div>
    </section>

    <section class="card" style="margin-top: 16px;">
      <div class="card-title">
        <Globe size={18} />
        <h3>{$t("language")}</h3>
      </div>

      <div class="lang-options">
        <button
          class:active={$language === "en"}
          on:click={() => setLanguage("en")}
        >
          English
        </button>
        <button
          class:active={$language === "zh"}
          on:click={() => setLanguage("zh")}
        >
          繁體中文
        </button>
      </div>
    </section>

    <section class="card" style="margin-top: 16px;">
      <div class="card-title">
        <Layout size={18} />
        <h3>{$t("display_settings")}</h3>
      </div>

      <div class="toggle-row">
        <div class="toggle-info">
          <span class="toggle-label">{$t("combined_view")}</span>
          <span class="toggle-desc">{$t("combined_view_desc")}</span>
        </div>
        <button
          class="toggle-switch"
          class:active={$combinedView}
          on:click={toggleCombinedView}
          aria-label={$t("combined_view")}
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
    </section>

    <section class="card" style="margin-top: 16px;">
      <div class="card-title">
        <Bug size={18} />
        <h3>{$t("report_bug")}</h3>
      </div>
      <p class="description">{$t("report_bug_desc")}</p>
      <button class="report-btn" on:click={openIssue}>
        {$t("open_github_issue")}
      </button>
    </section>

    <div class="version">{APP_NAME} v{APP_VERSION}</div>
  </div>
</div>

<style>
  .settings-page {
    padding: 24px;
    height: 100%;
    overflow-y: auto;
    background: var(--color-bg-secondary);
  }

  header {
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

  .settings-content {
    max-width: 600px;
  }

  .card {
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .card-title {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
    color: var(--color-text-primary);
  }

  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .lang-options {
    display: flex;
    gap: 12px;
  }

  button {
    flex: 1;
    padding: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-bg-primary);
    border-radius: 8px;
    font-size: 14px;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: all 0.2s;
  }

  button:hover {
    border-color: var(--color-text-tertiary);
    background: var(--color-bg-secondary);
  }

  button.active {
    background: var(--color-primary-bg);
    border-color: var(--color-primary);
    color: var(--color-primary);
    font-weight: 500;
  }

  .toggle-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toggle-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .toggle-desc {
    font-size: 12px;
    color: var(--color-text-secondary);
  }

  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    flex: none;
    padding: 0;
    border-radius: 12px;
    background: var(--color-border);
    border: none;
    cursor: pointer;
    transition: background 0.2s;
  }

  .toggle-switch.active {
    background: var(--color-primary);
  }

  .toggle-switch:hover {
    background: var(--color-text-tertiary);
  }

  .toggle-switch.active:hover {
    background: var(--color-primary-dark);
  }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: transform 0.2s;
  }

  .toggle-switch.active .toggle-knob {
    transform: translateX(20px);
  }

  .description {
    margin: 0 0 16px 0;
    font-size: 13px;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .report-btn {
    width: 100%;
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .report-btn:hover {
    background: var(--color-primary-dark);
    border-color: var(--color-primary-dark);
  }

  .version {
    margin-top: 32px;
    text-align: center;
    font-size: 12px;
    color: var(--color-text-tertiary);
  }
</style>

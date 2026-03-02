<script>
  /**
   * 設定頁面 (Settings View)
   *
   * 管理應用程序的全域偏好設定，例如語系與佈景主題。
   */
  import { language, combinedView } from "../stores/settings";
  import { t } from "../lib/i18n";
  import { APP_VERSION, APP_NAME } from "../lib/version";
  import { Settings, Globe, Bug, Layout } from "lucide-svelte";

  function setLanguage(lang) {
    language.set(lang);
  }

  function toggleCombinedView() {
    combinedView.update((v) => !v);
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
    background: #f9fafb;
  }

  header {
    margin-bottom: 24px;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #111827;
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
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .card-title {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
    color: #374151;
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
    border: 1px solid #e5e7eb;
    background: white;
    border-radius: 8px;
    font-size: 14px;
    color: #4b5563;
    cursor: pointer;
    transition: all 0.2s;
  }

  button:hover {
    border-color: #d1d5db;
    background: #f9fafb;
  }

  button.active {
    background: #eff6ff;
    border-color: #2563eb;
    color: #2563eb;
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
    color: #374151;
  }

  .toggle-desc {
    font-size: 12px;
    color: #6b7280;
  }

  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    flex: none;
    padding: 0;
    border-radius: 12px;
    background: #e5e7eb;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
  }

  .toggle-switch.active {
    background: #3b82f6;
  }

  .toggle-switch:hover {
    background: #d1d5db;
  }

  .toggle-switch.active:hover {
    background: #2563eb;
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
    color: #6b7280;
    line-height: 1.5;
  }

  .report-btn {
    width: 100%;
    background: #3b82f6;
    border-color: #3b82f6;
    color: white;
  }

  .report-btn:hover {
    background: #2563eb;
    border-color: #2563eb;
  }

  .version {
    margin-top: 32px;
    text-align: center;
    font-size: 12px;
    color: #9ca3af;
  }
</style>

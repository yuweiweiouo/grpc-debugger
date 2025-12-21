<script>
  import { language } from '../stores/settings';
  import { t } from '../lib/i18n';
  import { Settings, Globe } from 'lucide-svelte';

  function setLanguage(lang) {
    language.set(lang);
  }
</script>

<div class="settings-page">
  <header>
    <div class="title">
      <Settings size={20} />
      <h2>{$t('settings')}</h2>
    </div>
  </header>

  <div class="settings-content">
    <section class="card">
      <div class="card-title">
        <Globe size={18} />
        <h3>{$t('language')}</h3>
      </div>
      
      <div class="lang-options">
        <button 
          class:active={$language === 'en'} 
          on:click={() => setLanguage('en')}
        >
          English
        </button>
        <button 
          class:active={$language === 'zh'} 
          on:click={() => setLanguage('zh')}
        >
          繁體中文
        </button>
      </div>
    </section>

    <div class="version">
      gRPC Debugger v1.0.0
    </div>
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
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
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

  .version {
    margin-top: 32px;
    text-align: center;
    font-size: 12px;
    color: #9ca3af;
  }
</style>

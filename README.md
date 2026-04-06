# gRPC Debugger

gRPC-Web 網路請求除錯工具，自動攔截並解碼 Protobuf 訊息。

## 特色功能

- 🔍 **自動攔截** - 無需前端配合，自動捕捉所有 gRPC-Web 請求
- 📦 **Protobuf 解碼** - 自動解碼二進制 Protobuf 訊息
- 📄 **Proto 載入** - 拖放 `.proto` 檔案獲得完整欄位名稱
- 🌊 **Streaming 支援** - 支援 Server Streaming 請求
- 🌙 **深色模式** - 自動配合系統主題

## 安裝

### Chrome

1. 執行 `npm run build`
2. 開啟 `chrome://extensions/`
3. 啟用「開發人員模式」
4. 點擊「載入未封裝項目」選擇 `build` 資料夾

### Firefox

1. 執行 `npm run build`
2. 開啟 `about:debugging`
3. 點擊「此 Firefox」>「載入暫時性附加元件」
4. 選擇 `build/manifest.json`

## 使用方式

1. 開啟任何使用 gRPC-Web 的網站
2. 開啟 DevTools (F12)
3. 切換到「gRPC Debugger」面板
4. 請求會自動顯示

### 進階功能

**載入 Proto 定義檔：**
- 直接拖放 `.proto` 檔案到面板
- 或讓工具透過 Reflection 自動同步服務定義

載入 Proto 後，欄位名稱會從 `field_1`、`field_2` 變成實際的欄位名稱。

## 開發

```bash
# 安裝依賴
npm install

# 開發模式
npm run dev

# 測試
npm test

# 建置
npm run build

# 預覽建置結果
npm run preview
```

## CI/CD

- `CI`：在 push / pull request 時自動執行版本同步檢查、測試與建置。
- `Release`：當程式碼推到 `main` 時，自動執行 patch 版號遞增、同步 `manifest.json` 與 `src/lib/version.ts`、建置套件、建立 tag 與 GitHub Release。
- Release 產物名稱固定為 `release_v{version}.zip`，壓縮檔內包含可直接發佈的 extension build 結果。
- Release Notes 會根據這次 push 到 `main` 的 commit 訊息，自動整理「這次改了什麼」。

## 授權

MIT License

# gRPC Debugger

gRPC / Connect 請求除錯工具，透過頁面端事件橋接顯示已解碼訊息與 schema。

## 特色功能

- 🔍 **事件橋接** - 接收頁面端主動送出的 gRPC / Connect 呼叫資料
- 📦 **Schema 顯示** - 根據註冊的 service/message 定義顯示 proto 資訊
- 📄 **前端整合 API** - 可由頁面主動註冊 schema 與送出已解碼 call
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
4. 頁面主動送出的 gRPC 事件會顯示在面板中

### 進階功能

**註冊 Schema 定義：**
- 透過前端 API 註冊 service / message
- 或依賴頁面端自動偵測註冊服務定義

註冊 Schema 後，欄位名稱會從通用結構顯示成實際的型別資訊。

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
```

## CI/CD

- `CI`：在 push / pull request 時自動執行版本同步檢查、測試與建置。
- `Release`：當程式碼推到 `main` 時，自動執行 patch 版號遞增、同步 `manifest.json` 與 `src/lib/version.ts`、建置套件、建立 tag 與 GitHub Release。
- Release 產物名稱固定為 `release_v{version}.zip`，壓縮檔內包含可直接發佈的 extension build 結果。
- Release Notes 會根據這次 push 到 `main` 的 commit 訊息，自動整理「這次改了什麼」。
- 目前專案的封包接收路徑已統一為頁面端 `PostMessage` 橋接，不再依賴 HAR / Reflection 模式。

## 授權

MIT License

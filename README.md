<p align="center">
  <img src="public/launchericon-144-144.png" width="96" alt="gRPC Debugger logo">
</p>

<h1 align="center">gRPC Debugger</h1>

<p align="center">
  直接在 Chrome Side Panel 檢視、追蹤與解碼 gRPC-Web 請求的開源瀏覽器擴充功能。
</p>

<p align="center">
  <a href="https://github.com/yuweiweiouo/grpc-debugger/releases">Releases</a>
  &nbsp;&middot;&nbsp;
  <a href="https://github.com/yuweiweiouo/grpc-debugger/issues">Issues</a>
  &nbsp;&middot;&nbsp;
  <a href="#開發">開發</a>
  &nbsp;&middot;&nbsp;
  <a href="#授權">MIT</a>
</p>

## 簡介

gRPC Debugger 是一個 Chrome Manifest V3 擴充功能，用來檢視網站發出的 gRPC-Web 請求。它可在目前分頁啟用請求偵測，並在可取得執行期型別資訊時，將 Protobuf 請求與回應轉為可閱讀的 JSON。

適合用於除錯已部署的 Web 應用程式，不需要在應用程式中預先加入專用的除錯 UI。

## 功能

| 功能 | 說明 |
| --- | --- |
| Chrome Side Panel | 從工具列圖示開啟與目前分頁綁定的除錯面板。 |
| 請求偵測 | 顯示 gRPC、Connect 與 Protobuf 內容類型的 POST 請求、狀態、標頭與時間資訊。 |
| Proto 偵測與解碼 | 透過 Chrome Debugger 取得 `protobuf-ts` 與 `grpc-web` 的執行期資訊，解碼請求與回應內容。 |
| 服務管理 | 檢視已偵測的服務，並從日誌中隱藏不需要的服務。 |
| 日誌工具 | 搜尋方法、清除紀錄與保留導覽前的紀錄；每個分頁最多保留 200 筆。 |
| 介面設定 | 支援繁體中文與英文，以及淺色、深色和跟隨系統主題。 |

## 相容性

- Google Chrome 114 以上，需支援 Manifest V3 與 Side Panel API。
- 其他 Chromium 瀏覽器可能可運作，但目前未列為正式支援範圍。
- 用於網頁中的 gRPC-Web 呼叫；不支援直接擷取原生 gRPC 的 HTTP/2 流量。

## 安裝

目前可從原始碼載入未封裝擴充功能。

### 前置需求

- Node.js 22，與 release workflow 使用的版本一致。
- npm 與 Google Chrome。

### 從原始碼載入

```bash
git clone https://github.com/yuweiweiouo/grpc-debugger.git
cd grpc-debugger
npm ci
npm run build
```

接著在 Chrome 完成以下步驟：

1. 開啟 `chrome://extensions/`。
2. 啟用右上角的「開發人員模式」。
3. 選擇「載入未封裝項目」。
4. 選取專案內的 `build` 目錄。

## 使用方式

1. 開啟要檢查的 gRPC-Web 網頁。
2. 點擊 Chrome 工具列中的 gRPC Debugger 圖示，開啟 Side Panel。
3. 在「網路紀錄」點擊「偵測請求」。
4. 如需解碼 Protobuf 內容，再點擊「偵測 Proto」。Chrome 會將 Debugger 附加至目前分頁。
5. 發送或重現目標網站的請求，然後在清單中選取一筆紀錄查看一般資訊、標頭、請求、回應與 Proto 定義。

只需觀察端點與狀態時，可僅啟用「偵測請求」；啟用「偵測 Proto」後才會嘗試讀取執行期型別並解碼訊息。

## 運作方式

1. Background service worker 將 Side Panel 綁定到目前分頁，並管理每個分頁的偵測狀態。
2. 請求偵測模式會在頁面中注入輕量攔截器，蒐集符合 gRPC 內容類型的請求資料。
3. Proto 偵測模式使用 Chrome Debugger Protocol 取得網路事件與頁面執行期的 `protobuf-ts` 或 `grpc-web` 型別資訊。
4. 擴充功能將可用的 Schema 快取在 `chrome.storage.local`，並以 JSON 顯示已解碼的內容。

## 權限與資料

擴充功能需要 `debugger`、`scripting`、`sidePanel`、`storage`、`webNavigation` 與 `<all_urls>` 權限，才能在使用者選擇的分頁中偵測 gRPC-Web 請求並開啟 Side Panel。

擷取的紀錄與偵測到的 Proto 資訊會存放於瀏覽器本機的 `chrome.storage.local`。使用前請確認你有權檢查目標網站的網路資料，並避免在未受信任的環境中暴露敏感請求內容。

## 限制

- 完整解碼需要目標頁面可取得相容的 `protobuf-ts` 或 `grpc-web` 執行期型別資訊；否則仍可能只顯示請求中繼資料或原始內容。
- 壓縮的 gRPC-Web frame 目前不支援解碼。
- Chrome 內部頁面、Chrome Web Store 與其他受限制頁面無法注入攔截器。
- Chrome Debugger 可能與其他同時附加到同一分頁的除錯工具互相影響。

## 專案結構

```text
src/
  components/  Side Panel 的 Svelte 介面
  extension/   Background service worker、攔截器與 Chrome API 整合
  lib/         Protobuf、gRPC-Web、Reflection 與共用工具
  stores/      Svelte 狀態管理
test/          Vitest 單元測試
public/        Manifest、圖示與靜態資源
scripts/       版本同步工具
```

## 開發

安裝依賴後可使用下列指令：

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 啟動 Vite 開發伺服器，方便調整 Side Panel UI。 |
| `npm run build` | 建置可載入 Chrome 的擴充功能至 `build/`。 |
| `npm test` | 執行完整 Vitest 測試。 |
| `npm run test:watch` | 以 watch 模式執行 Vitest。 |
| `npm run version:sync` | 將 `package.json` 版本同步到 manifest 與應用程式版本常數。 |
| `npm run zip` | 將 `build/` 打包為版本化 ZIP 檔。 |

變更擴充功能程式碼後，重新執行 `npm run build`，再到 `chrome://extensions/` 重新載入擴充功能。

## 發布

推送符合 `v*` 格式的 tag 時，GitHub Actions 會自動執行測試、建置、產生 ZIP，並建立 GitHub Release。tag 版本必須與 `package.json` 的版本一致。

## 貢獻

歡迎透過 Issue 回報問題或提出功能建議。提交 Pull Request 前請：

1. 從最新的預設分支建立功能分支。
2. 保持變更範圍明確，並為行為改動補上或調整測試。
3. 執行 `npm test` 與 `npm run build`。
4. 在 Pull Request 說明中列出變更內容與驗證方式。

## 授權

本專案依 [MIT License](./package.json) 發布。

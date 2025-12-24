# 錯誤解法記錄 (BAD.md)

記錄所有嘗試過但失敗的解法，避免重蹈覆轍。

---

## 1. 並發請求匹配問題

### ❌ 嘗試 1：時間戳匹配 (Timestamp Diff)
**做法：** 在 `devtools.js` 中，用 HAR 的 `startedDateTime` 和 interceptor 的 `timestamp` 比較，找最小差異。

**失敗原因：** 並發請求的時間戳非常接近（< 2ms），無法區分。

### ❌ 嘗試 2：Request Body Hash 匹配
**做法：** 在 `fetch-interceptor.js` 對 `path + headers + body` 計算 FNV-1a hash，在 `devtools.js` 對 HAR entry 計算相同 hash 來匹配。

**失敗原因：**
- `fetch-interceptor.js` 對 **ArrayBuffer (二進位)** 計算 hash
- `devtools.js` 對 **HAR postData.text (文字)** 計算 hash
- 兩者格式不同，hash 永遠不一致！

**教訓：** HAR API 返回的 body 格式與 fetch 攔截的原始格式不同，無法直接比較。

### ❌ 嘗試 3：FIFO + 發送 Pending 條目
**做法：** 
1. Ghost Intercept 時立即發送 `pending` 條目到 UI
2. HAR 完成時用相同 ID 發送 `finished` 條目
3. UI 使用 ID 匹配合併

**失敗原因：** **Race Condition** - `finished` 可能比 `pending` 先被處理，導致 `existingIdx = -1`，匹配失敗。

**證據（診斷日誌）：**
```
addLog: id=ghost-7v6skct, status=finished, existingIdx=-1
New entry: ghost-7v6skct  // 應該是 Merging!
```

### ✅ 正確解法：FIFO + 不發送 Pending
- 只緩存 intercept 資料，不發送 pending 條目
- HAR 完成時用 FIFO 取出匹配的緩存資料
- 只發送一次 `finished` 條目

---

## 2. 重複注入問題

### ❌ 嘗試：在腳本加入防重複標記
**做法：** 在 `fetch-interceptor.js`、`content-script.js`、`grpc-web-injector.js` 加入 `window.__XXX_INJECTED__` 檢查。

**結果：** 無效。問題根源不是重複注入，而是 Race Condition（見上）。

**教訓：** 診斷日誌很重要，要先確認根因再修復。

---

## 3. Proto 類型顯示問題

### ❌ 嘗試：修改 ReflectionClient._extractTypeName
**做法：** 在 `reflection-client.js` 的 `_extractTypeName` 函數中加入更多判斷邏輯。

**失敗原因：** `_descMessageToLegacy` 和 `_extractTypeName` **根本沒被調用**！

**根因：** UI 使用 `protoEngine.findMessage()`，它返回的是 `registry.getMessage()` 的原始 `DescMessage`，沒有經過 `_descMessageToLegacy` 轉換。

**教訓：** 要追蹤完整的資料流，找出真正被調用的代碼路徑。

### ✅ 正確解法：在 protoEngine.findMessage 返回前轉換
在 `proto-engine.js` 加入 `_toLegacyFormat` 函數，將 `DescMessage` 轉換為 UI 需要的 legacy 格式（包含 `type_name`）。

---

## 4. 修改 build/ 目錄的靜態檔案

### ❌ 嘗試：直接修改 build/devtools.js
**做法：** 直接編輯 `build/devtools.js`。

**失敗原因：** `npm run build` 會將 `public/` 目錄複製到 `build/`，覆蓋手動修改。

**教訓：** 確認 build 流程！靜態檔案應該修改 `public/` 目錄，而非 `build/`。

---

## 通用教訓

1. **先加診斷日誌，確認根因再修復**
2. **追蹤完整資料流，確認代碼路徑被調用**
3. **理解 build 流程，修改正確的源文件**
4. **HAR API 和 fetch 攔截的資料格式可能不同**
5. **異步系統中要考慮 Race Condition**

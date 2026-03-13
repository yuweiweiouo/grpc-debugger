# NetworkDetails Tab 切換邏輯 - 交接文件

> **日期**: 2026-03-14
> **分支**: develop
> **版本**: 1.3.29

---

## 一、目前進度

### 1.1 已完成的工作

**功能描述**: 當 `combinedView` 設定切換時，自動調整 `activeTab` 到合理的位置：
- 開啟 combined view 時，`request` / `response` tab 會自動切到 `data` tab
- 關閉 combined view 時，`data` tab 會自動回到 `request`

**新增檔案**:
- `src/lib/network-details-tabs.ts` - Tab 正規化邏輯
- `test/network-details-tabs.test.js` - 單元測試

**修改檔案**:
- `src/components/NetworkDetails.svelte:14,58` - 引入並使用 `normalizeActiveTab`
- `.gitignore` - 新增 `.vscode/`

### 1.2 核心程式碼

**src/lib/network-details-tabs.ts**:
```typescript
export function normalizeActiveTab(activeTab, isCombinedView) {
  if (isCombinedView && (activeTab === 'request' || activeTab === 'response')) {
    return 'data';
  }

  if (!isCombinedView && activeTab === 'data') {
    return 'request';
  }

  return activeTab;
}
```

**NetworkDetails.svelte 的修改**:
```svelte
import { normalizeActiveTab } from "../lib/network-details-tabs";
// ...
$: activeTab = normalizeActiveTab(activeTab, $combinedView);
```

### 1.3 測試覆蓋

**test/network-details-tabs.test.js**:
- 開啟 combined view 時，request/response 會切到 data tab
- 關閉 combined view 時，data tab 會回到 request
- 其他 tab 保持不變

---

## 二、待辦事項

### 2.1 立即需要完成

- [ ] **執行測試驗證**
  ```bash
  npm run test
  ```
  確認 `network-details-tabs.test.js` 通過

- [ ] **執行 Build**
  ```bash
  npm run build
  ```
  確認 build 成功，`build/assets/panel.js` 更新

- [ ] **手動測試**
  1. 開啟 DevTools，載入擴充功能
  2. 選擇一個 gRPC 請求
  3. 切換 Settings 中的 "Combined View"
  4. 確認 tab 自動切換：
     - request → data (開啟 combined view)
     - data → request (關閉 combined view)

- [ ] **提交變更**
  ```bash
  git add .
  git commit -m "feat: auto-switch tab when combinedView changes"
  ```

### 2.2 後續優化（非必要）

- [ ] 考慮將 `activeTab` 狀態持久化到 URL 或 localStorage
- [ ] 考慮在 tab 切換時加入動畫過渡
- [ ] 檢查是否有其他地方也需要類似的 tab 同步邏輯

---

## 三、技術背景

### 3.1 專案結構

```
grpc-debugger/
├── src/
│   ├── components/
│   │   └── NetworkDetails.svelte   # 請求詳情面板
│   ├── lib/
│   │   └── network-details-tabs.ts # Tab 正規化邏輯 (新)
│   └── stores/
│       └── settings.ts             # combinedView 設定
├── test/
│   └── network-details-tabs.test.js # 單元測試 (新)
└── build/
    └── assets/
        └── panel.js                # Build 產物
```

### 3.2 相關 Store

- `combinedView` 來自 `src/stores/settings.ts`
- `selectedEntry` 來自 `src/stores/network.ts`

### 3.3 測試框架

- 使用 **Vitest**
- 執行測試: `npm run test`
- 監聽模式: `npm run test:watch`

---

## 四、注意事項

1. **build/assets/panel.js** 是 build 產物，通常不應該 commit，但目前有被追蹤
2. `.vscode/` 已加入 `.gitignore`
3. 確保提交前執行 `npm run build` 更新產物

---

## 五、驗收標準

- [ ] `npm run test` 全部通過
- [ ] `npm run build` 成功
- [ ] 手動測試 combinedView 切換時 tab 正確跳轉
- [ ] 程式碼已提交到 develop 分支

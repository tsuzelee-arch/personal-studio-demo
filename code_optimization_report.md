# 專案代碼優化與安全審查報告 (Code Optimization & Security Audit)

雖然系統中預設的 Skills 主要針對 GCP 雲端與大數據架構，但我已經運用我內建的代碼分析能力，為您的 `personal-studio` 專案進行了深度的靜態檢查。

我發現了幾個**關鍵的優化點**，其中包含一個**非常危險的安全漏洞**以及一個**嚴重的效能瓶頸**，建議優先處理：

## 🚨 1. 嚴重的安全漏洞：環境變數 (.env) 外洩風險
**檔案位置**：`server.js`
**問題描述**：
您在第 36 行寫了 `app.use(express.static(path.resolve(__dirname)));`。
這意味著 Express 會將**整個專案根目錄**作為靜態檔案伺服器對外開放。如果有人（包含您網路內的其他人）訪問 `http://localhost:3001/.env` 或 `http://localhost:3001/server.js`，就可以直接下載您的原始碼和 API Keys！
**優化建議**：
建立一個 `public` 或 `client` 資料夾，將 `index.html`, `js/`, `css/`, `assets/` 全部移進去，然後改為 `app.use(express.static(path.join(__dirname, 'public')));`，確保後端代碼與設定檔不會被靜態伺服器暴露。

## ⚠️ 2. 前端效能瓶頸：無限迴圈的重繪計算
**檔案位置**：`js/workflow.js` (大約在 `updateCustomEdges` 函式)
**問題描述**：
為了繪製自訂的 SVG 連線，代碼使用了 `requestAnimationFrame(updateCustomEdges)` 進行自我呼叫。這會導致瀏覽器**永遠以每秒 60 次 (60FPS)** 的頻率在背景不斷計算所有節點的 `getBoundingClientRect()` 並重組 DOM 字串，即使使用者切換到了其他面板或沒有在操作，這會嚴重消耗 CPU 資源與電池。
**優化建議**：
應該加上條件判斷，例如：
```javascript
function updateCustomEdges() {
  // 當前不處於 workflow 頁面時，暫停計算
  if (!document.getElementById('panel-workflow').classList.contains('active')) {
    requestAnimationFrame(updateCustomEdges);
    return;
  }
  /* ... 原本的運算邏輯 ... */
  requestAnimationFrame(updateCustomEdges);
}
```
或是更進階的做法：只在「節點拖曳時」與「圖表縮放時」才觸發重繪，捨棄全時 `requestAnimationFrame`。

## 💡 3. DOM 查詢效能優化 (中度)
**檔案位置**：`js/workflow.js` (`syncDOMToGraph` 函式)
**問題描述**：
每次同步圖表資料時，都會迴圈遍歷所有節點並執行 `el.querySelector('.wf-model-sel')` 等操作。雖然目前節點不多時無感，但當工作流龐大時，頻繁的 DOM 查詢會造成卡頓。
**優化建議**：
在 `createNodeDOM` 時，將這些 Input / Select 的 DOM 參考 (Reference) 存在 `nodeDOMCache[id].controls` 裡，同步時直接讀取屬性而不需要再次 Query DOM。

## 💡 4. 存檔機制的防抖 (Debounce) (輕度)
**檔案位置**：`js/workflow.js`
**問題描述**：
目前只要工作流有變動，就會執行 `localStorage.setItem('ps_workflow', ...)`。如果使用者快速拖曳節點，會瘋狂觸發 JSON 序列化與寫入磁碟。
**優化建議**：
實作一個簡單的 Debounce 函式，讓存檔動作在使用者「停止動作後 500 毫秒」才執行一次。

---

> [!IMPORTANT]
> **是否需要我幫您修復？**
> 第一項（安全漏洞）與第二項（效能瓶頸）非常關鍵。如果您同意，我可以立即為您撰寫代碼修復 `server.js` 與 `workflow.js` 的問題。請讓我知道您的決定。

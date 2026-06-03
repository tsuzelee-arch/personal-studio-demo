# 工作流編輯器重構計劃：移植至 AntV G6 與 n8n 風格自動化

您決定採用更專業的圖表庫與自動化架構，這是一個明智的決定，能徹底解決原生 DOM 拖曳與連線的不穩定問題。我已經閱讀了 `antv-g6-graph` 與 `n8n` 相關技能的技術規範，並為您規劃了以下的重構計畫：

## User Review Required
> [!IMPORTANT]
> 1. **關於 AntV G6 移植**：您目前的節點包含大量表單元件（如文字框、下拉選單、滑桿）。為了在 Canvas 畫布中保留這些互動能力，我將使用 G6 的 `html` 節點類型（或是基於 React/DOM 覆蓋層的方式），這會將原本的 HTML 原封不動地嵌入 G6 的節點中。
> 2. **關於 Node.js 與自動化 (n8n)**：由於目前的工具是純前端靜態網頁（沒有後端伺服器），您提到的 n8n 自動化技能，我會將其理解為**「將 n8n 的節點資料流架構 (Data Flow Architecture) 引入前端」**，讓節點之間的串聯具有真實的資料傳遞邏輯，而不僅僅是視覺連線。如果您的意思是想要建立一個真實的 Node.js 後端伺服器來跑 n8n，請告訴我！

## Proposed Changes

### index.html
#### [MODIFY] index.html
- 引入 AntV G6 v5 的 CDN 腳本 (`<script src="https://unpkg.com/@antv/g6@5/dist/g6.min.js"></script>`)。

### js/workflow.js
#### [MODIFY] workflow.js
這將是一次大規模重構。我會將目前的 DOM 拖曳邏輯全部移除，替換為 G6 的架構：
- **G6 Graph 初始化**：建立 `new G6.Graph()`，設定支援 `drag-canvas`, `zoom-canvas`, `drag-element`, `click-select`, `create-edge` 等內建互動行為，直接獲得完美的縮放與連線體驗。
- **自訂 HTML 節點 (G6 `html` Node)**：將原先的 Model, Prompt, Parameters, Img2Img, Preview 等節點的 UI 封裝進 G6 的 `html` 節點中，並處理表單事件防止與畫布拖曳衝突。
- **連線與刪除 (Edges & Deletion)**：使用 G6 內建的 `create-edge` 行為，支援拖曳 Port 建立連線；選中節點或連線後，按下 Delete 鍵即可直接刪除，解決原本無法去除連線的問題。
- **n8n 風格執行引擎 (Execution Pipeline)**：
  - 引入 n8n 的有向無環圖 (DAG) 遍歷概念。
  - 當按下「開始生成」時，系統會從輸入節點開始，依照連線順序逐步執行節點，並將資料往下一個節點傳遞，實現真正的自動化串聯。
- **實作「貼上圖片 (Paste Image)」功能**：
  - 監聽 `window` 的 `paste` 事件。
  - 貼上時在 G6 畫布中新增一個「圖生圖 (Img2Img)」節點，動態更新 G6 的資料 (`graph.addNodeData`)。

### css/style.css
#### [MODIFY] style.css
- 移除舊版用來計算拖曳座標的繁雜 CSS。
- 調整 G6 畫布容器 (`#workflowCanvas`) 的樣式，確保 100% 填滿區域。
- 針對 G6 的 HTML 節點加上特定的樣式，隱藏瀏覽器預設的滾動條或邊框，使其融入工作流風格。

## Verification Plan
1. **渲染測試**：確認頁面載入後，G6 畫布能正確顯示，且預設的串聯節點正確無誤。
2. **操作測試**：使用滾輪縮放、滑鼠拖曳畫布，測試 G6 的原生流暢度。
3. **連線測試**：嘗試建立新節點，並從 Port 拉出線條連接至另一個節點，確認是否流暢且可被單獨刪除。
4. **貼上測試**：截圖並在畫布上 `Ctrl+V`，確認是否自動產生包含該圖片的節點。
5. **執行測試**：按下「產生影像」，確認資料流是否如 n8n 般依照順序傳遞並正確呼叫 API。

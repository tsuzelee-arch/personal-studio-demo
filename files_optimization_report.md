# 專案文件與設定優化報告 (Phase 2: Files & Config Optimization)

既然針對 `workflow.js` 與 `server.js` 的核心邏輯實作計畫已交由其他 Agent 執行，我利用了我的代碼審查能力，再次幫您掃描了專案中的**其他文件與設定檔 (HTML, CSS, 腳本, package.json)**，並整理出以下可以進一步優化的地方：

## 💡 1. Git 一鍵上傳腳本優化 (`upload_to_git.bat`)
**問題描述**：目前的腳本直接執行 `git add .` 和 `git commit`。如果沒有任何檔案變更，執行 `git commit` 會報錯中斷，並顯示非預期的錯誤訊息。
**優化建議**：在 Commit 前加入判斷，檢查是否有檔案變更。
```bat
git status --porcelain > nul
if errorlevel 1 (
    echo 目前沒有需要提交的變更。
    pause
    exit
)
```

## 💡 2. 靜態資源的快取機制 (Cache Busting)
**檔案位置**：`index.html`
**問題描述**：目前在 HTML 底部引入 JS 時，使用了手動加版號的方式（例如 `<script src="js/workflow.js?v=84"></script>`）。這種方式雖然有效，但在頻繁開發時很容易忘記手動更改版號，導致瀏覽器快取舊代碼。
**優化建議**：
- **短期**：後端 `server.js` 在吐出 `index.html` 時，可透過動態替換注入時間戳記 `?v=Date.now()`。
- **長期**：考慮引入如 Vite 等輕量化打包工具，自動處理檔案 Hash 與 Minify。

## 💡 3. CSS 體積過大與模組化 (`css/style.css`)
**檔案位置**：`css/style.css` (高達近 3000 行，70KB)
**問題描述**：所有元件（Sidebar, Workflow 節點, 提示詞熔爐, 彈出視窗, 主題變數）全部擠在同一個檔案內。隨著專案擴大，將變得非常難以維護且容易產生樣式衝突。
**優化建議**：將 CSS 拆分為多個檔案（如 `variables.css`, `layout.css`, `components/workflow.css`, `components/prompts.css`），並在 `style.css` 中使用 `@import` 引入，以提升可讀性與維護性。

## 💡 4. CDN 外部依賴的安全性與效能
**檔案位置**：`index.html` (Line 8 & Line 637)
**問題描述**：您使用了 `cdnjs` 和 `unpkg` 載入 Cropper.js 與 AntV G6。目前缺少了 `defer` 屬性，也沒有 Subresource Integrity (SRI) 校驗。
**優化建議**：
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js" integrity="[hash]" crossorigin="anonymous" defer></script>
```
加入 `defer` 讓腳本在背景下載，不阻塞 HTML 解析；加入 `integrity` 可防止 CDN 被惡意植入代碼。

---

> [!TIP]
> 這些文件的優化屬於「結構與維護性」的提升，不會影響目前的核心功能。您可以挑選覺得有幫助的部分，隨時吩咐我為您產生對應的修改代碼！

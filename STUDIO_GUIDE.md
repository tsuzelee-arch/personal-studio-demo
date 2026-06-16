# 客制化 Studio 教程與 AI 規範指引 (STUDIO_GUIDE.md)

本文件是「客制化 Studio」的系統開發指引，旨在幫助開發人員及 AI 協同 Agents 快速掌握本專案的架構設計、核心工作流及開發限制規範。

---

## 🏗️ 系統架構與目錄對照

客制化 Studio 是一個整合 Creative AI（如 Gemini 圖像分析、GPT-Image 生成）與自動化工作流（n8n）的本機創造力工作站。

### 1. 📂 核心檔案目錄對照 (File Map)

在開發或維護功能時，請務必了解以下核心檔案的職責：

| 檔案路徑 | 主要職責 / 模組邏輯 |
| :--- | :--- |
| **[index.html](file:///c:/Users/tsuze/personal-studio/index.html)** | 應用的主要單頁 (SPA) 骨架，載入所有面板區塊與 CSS/JS。 |
| **[server.js](file:///c:/Users/tsuze/personal-studio/server.js)** | 後端 Express 伺服器入口，掛載靜態目錄、API 路由，並具備同源與防 CSRF 驗證。 |
| **[js/app.js](file:///c:/Users/tsuze/personal-studio/js/app.js)** | 全域狀態管理者、導航列切換、全域 Toast 提示、及全域 Pickr 色板攔截器。 |
| **[js/simple-workflow.js](file:///c:/Users/tsuze/personal-studio/js/simple-workflow.js)** | 簡易工作流（卡片式畫布）的主邏輯：包含節點繪製、拖動、圖片壓縮與剪貼簿複製貼上。 |
| **[js/decode.js](file:///c:/Users/tsuze/personal-studio/js/decode.js)** | 圖像解構面板邏輯：傳送圖片至 Gemini Vision 進行分析並呈現結構化色板與標籤。 |
| **[js/prompts.js](file:///c:/Users/tsuze/personal-studio/js/prompts.js)** | 提示詞庫與熔爐：分類篩選、自訂分類、提示詞 AI 重寫/翻譯、自訂分類刪除 UI。 |
| **[js/workflow.js](file:///c:/Users/tsuze/personal-studio/js/workflow.js)** | 基於 G6.js 引擎運行的自定工作流圖表繪製（目前暫時停用/廢棄）。 |
| **[js/assets.js](file:///c:/Users/tsuze/personal-studio/js/assets.js)** | 資產庫前端邏輯：檢視與下載已生成的創意圖像。 |
| **[js/settings.js](file:///c:/Users/tsuze/personal-studio/js/settings.js)** | API 設定面板：管理 Gemini/OpenAI API Key、系統代理、GDrive Client ID。 |
| **[js/ai-service.js](file:///c:/Users/tsuze/personal-studio/js/ai-service.js)** | AI 整合服務：包含 Gemini 分析、GPT-Image 2 生成、GPT 提示詞重寫等底層 API 呼叫。 |
| **[js/ide-agent.js](file:///c:/Users/tsuze/personal-studio/js/ide-agent.js)** | 浮動 IDE Agent 對話面板邏輯：支援多種對話模型與 Track A (直通生成) / Track B (工具呼叫) 功能。 |
| **[js/utils.js](file:///c:/Users/tsuze/personal-studio/js/utils.js)** | 常用工具函式（如 dataURL/Blob 互轉、圖片安全性轉換）。 |
| **[js/gdrive-api.js](file:///c:/Users/tsuze/personal-studio/js/gdrive-api.js)** | 基於 Google Identity Services (GIS) 的 Google Drive 整合授權與上傳服務。 |

### 2. 🎨 樣式系統配置 (CSS Files)

樣式表均存放在 `css/` 目錄中，並由 **[style.css](file:///c:/Users/tsuze/personal-studio/css/style.css)** 統一進行 `@import` 引入：

*   **[base.css](file:///c:/Users/tsuze/personal-studio/css/base.css)**: 全域基本佈局、按鈕、卡片及全域浮動面板與按鈕樣式。
*   **[variables.css](file:///c:/Users/tsuze/personal-studio/css/variables.css)**: 定義色彩、陰影、字型及設計語彙變數。
*   **[simple-workflow.css](file:///c:/Users/tsuze/personal-studio/css/simple-workflow.css)**: 簡易工作流專屬面板、卡片節點、輸入框及縮圖高亮樣式。
*   **[prompts.css](file:///c:/Users/tsuze/personal-studio/css/prompts.css)**: 提示詞庫三欄佈局、提示詞熔爐及側邊欄（含自訂分類刪除按鈕）樣式。
*   **[dark.css](file:///c:/Users/tsuze/personal-studio/css/dark.css)**: 全域暗色主題變數與覆蓋樣式。

---

## ⚡ 核心功能與工作流教程 (Feature Walkthroughs)

### 1. 簡易工作流 參考圖片複製、貼上與刪除機制
*   **縮圖選取與複製**：
    *   在圖生圖 (I2I) 節點的縮圖上，滑鼠懸停會顯示「複製 (❐)」按鈕。點擊縮圖本身會將其選取並加上高亮藍色外框（樣式類別 `.swf-img-thumb-selected`），同時將資訊紀錄於 `window.__swfSelectedImage`。
    *   點擊複製按鈕或按 `Ctrl+C` 時，會透過 `convertToPngBlob()` 函式將 base64 轉為 `image/png` 的 Blob，寫入瀏覽器的系統剪貼簿中。同時將原始資料備份至內部變數 `window.__swfImageClipboard`。
*   **智慧貼上 (Paste)**：
    *   在工作流面板按 `Ctrl+V` 時，全域監聽器會解析剪貼簿圖片：
        *   若當前點選了 I2I 節點：直接將圖片儲存至該節點的參考圖中。
        *   若當前沒有選取 I2I 節點：使用視角換算公式 `(rect.width / 2 - panX) / zoomLevel` 計算目前畫布正中心座標，在此座標點建立一個新的 I2I 節點，並填入該圖片。
    *   非圖片格式時，自動 fallback 回普通的節點複製與貼上邏輯。
*   **快速鍵刪除**：
    *   點選縮圖高亮後按下 `Delete` 或 `Backspace`，會優先移除該縮圖並重繪，阻止事件氣泡，避免誤刪其所屬的整個節點卡片。

### 2. 提示詞庫自訂分類刪除
*   當滑鼠懸停在侧邊欄的自訂分類項目時，右側會顯現刪除按鈕 `✕`（類別 `.cat-delete-btn`）。
*   點擊該按鈕時，將觸發 `e.stopPropagation()` 阻止事件冒泡至分類切換，並呼叫 `deleteCategory(cat)` 函式，提示使用者確認後，會將該分類下所有提示詞重歸類至「其他元素 (Other)」，隨後重繪側邊欄。

---

## 🛡️ 核心開發規範與約束 (Critical Directives)

未來的 AI 代理在修改本 codebase 時，必須嚴格遵守以下指令：

### 1. 🚨 絕對禁止 Mocking（拒絕敷衍代碼）
*   **絕對禁止**在未經使用者指示的情況下使用模擬資料（如 Unsplash、Picsum 圖片、寫死的假字串、假 JSON）來假裝功能已完成。
*   如果遇到缺少 API 端點或金鑰，**立刻停下來詢問**。必須如實拋出錯誤並顯示於 UI 上，嚴禁塞入 fallback 假畫面。

### 2. 🎨 `gpt-image-2` 特殊 API 參數規範
*   專案中的 `gpt-image-2` 是特殊的代理端點，**並非標準的 DALL-E**。
*   **限制條件**：`quality` 參數僅接受 `low`, `medium`, `high`, `auto` 四個值，**絕對不支援** DALL-E 的 `standard` 或 `hd`。
*   **限制條件**：**完全不支援** `style` 參數。如果強行帶入會導致 API 伺服器報錯 `Invalid value: 'standard'`。

### 3. 🖥️ IDE Agent 全域 UI 定位規範
*   IDE Agent 觸發按鈕（`.global-ide-agent-btn`）與對話面板（`.global-ide-agent-panel`）是全域常駐的。
*   **唯一的樣式數據源**為 **[base.css](file:///c:/Users/tsuze/personal-studio/css/base.css)**。
*   **禁止**在子頁面樣式（如 **[assets.css](file:///c:/Users/tsuze/personal-studio/css/assets.css)**）中重複或覆蓋其 CSS 定義，否則會造成面板尺寸、z-index、展開動畫在不同介面切換時跳動或偏移。

### 4. 💾 預防 LocalStorage 爆滿之壓縮規範
*   儲存工作流或提示詞至 LocalStorage 時，由於 5MB 空間限制，圖片 base64 極易撐爆空間。
*   所有存入的 base64 圖片，必須在儲存前呼叫 `compressForStore(dataUrl)` 進行壓縮，將解析度限制在 1024px 以下並轉成合適的 JPEG 資料，確保系統順暢。

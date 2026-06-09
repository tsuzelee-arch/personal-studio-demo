# 整合 Google AI Studio 參數至 Workflow 實作計畫 (修訂版)

根據您的確認與回饋，本計畫已更新，所有的參數控制項將統一放置於 **Model (模型)** 節點內，並依據選擇的模型進行動態顯示/隱藏。

## 1. 介面與功能設計 (Model 節點)

當使用者在 Model 節點選擇 **Nano Banana 2** 或 **Nano Banana Pro** 時，節點下方將動態顯示以下控制項（若選擇 GPT Image 則自動隱藏）：

### 基本設定 (Basic Settings)
1. **Temperature (溫度)**：
   - 取代原有的 CFG 算法。提供 `0.0` ~ `2.0` 的滑桿（預設 `0.4`）。
2. **Aspect Ratio (比例)**：
   - 除了保留預設選項 (Auto, 1K, 16:9 等)，新增一個 **自訂比例 (Custom)** 的選項與純文字輸入框，允許自由填入如 `21:9` 等格式。
3. **Thinking Level (思考層級)**：
   - 下拉選單 (High, Low, None)，幫助具有推理引擎的模型控制思考深度。
4. **Tools: Grounding with Google Search**：
   - 切換開關 (Toggle)，開啟後可讓模型透過 Google 搜尋取得事實資料輔助生成。

### 進階設定 (Advanced Settings)
仿造 Google AI Studio 的介面，增加一個「進階設定」區塊：
1. **Add stop sequence (停止序列)**：文字輸入框，允許設定多個停止字串（由逗號分隔）。
2. **Output length (最大輸出長度)**：數字輸入框，預設值 `65536`。
3. **Top P**：滑桿 (`0.0` ~ `1.0`)，預設 `0.95`，控制詞彙取樣的機率門檻。

---

## 2. 關於 Raw Mode 的研究報告

經過查詢 Google Gemini API 官方文檔與開發者社群，關於 **Raw Mode (原始模式)** 的生效方式如下：

1. **官方 API 並沒有名為 `raw_mode` 的單一參數**。
2. 市面上的第三方工具（如 LibreChat 或社群外掛）所謂的 "Raw Mode" 通常是指**「跳過任何系統內建的提示詞優化 (Prompt Rewriting) 或格式化，直接將使用者的輸入原封不動送給模型」**。
3. 若要在 Gemini Image 模型中達到類似「不受干擾、最原始/寫實的渲染效果」，業界標準的做法是：
   - **關閉所有 Safety Settings** (設為 `BLOCK_NONE`，如果您有權限)。
   - **純淨 Prompt**：確保程式碼中沒有偷偷幫使用者加上額外的描述（例如目前 `ai-service.js` 裡的 Prompt 重寫邏輯不要介入）。
   - 對於 Imagen 模型，可以加入特定的**負面提示詞 (Negative Prompt)** 避免過度修飾。

**結論**：在您的系統中要實作 "Raw Mode"，最有效的方法是在節點中加一個 "Raw Mode" 開關，當開啟時，程式碼將跳過任何 prompt 修改，並清空預設的樣式設定，直接傳送字串至 Gemini API。

---

## 3. 預計修改的檔案與實作邏輯

### [MODIFY] `js/workflow.js`
1. **修改 `createNodeDOM` (Model 節點)**
   - 插入上述所有的 HTML 結構（滑桿、輸入框、進階設定摺疊區塊）。
   - 綁定 `change` 事件：當 `<select class="wf-model-sel">` 切換時，判斷是否為 `gptimage`，若是則隱藏這些參數區塊。
   - 綁定 Aspect Ratio 的切換事件：選擇 Custom 時顯示手動輸入框。
2. **修改 `syncDOMToGraph`**
   - 讀取 Temperature, Aspect Ratio, Thinking Level, Top P, Output Length, Stop Sequence, Google Search 等值，並寫入 `datum.data`。
3. **修改 執行邏輯**
   - 從 Model 節點中提取這些新參數，透過 `node.data` 傳遞給 `ai-service.js`。
   - Parameters 節點原本的 `resolution` 設定將被停用或直接廢棄。

### [MODIFY] `js/ai-service.js`
1. **修改 API Payload (`generateWithNanoBanana2` & `generateWithNanoBanana`)**
   - **GenerationConfig** 加入 `temperature`, `topP`, `maxOutputTokens` (即 Output Length), `stopSequences`。
   - **ImageConfig** 加入客製化的 `aspectRatio`。
   - **Tools** 若開啟 Google Search，則推入 `[{ googleSearch: {} }]`。

---

**準備好執行了嗎？** 
如果您同意這個修訂版的計畫，請回覆「同意」或「開始執行」，我將立即為您修改 `workflow.js` 和 `ai-service.js` 的程式碼。

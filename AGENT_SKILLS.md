# AGENT SKILLS & CORE DIRECTIVES

## CRITICAL DIRECTIVE: NO MOCKING OR BRUSHING OFF
- **ABSOLUTE RULE**: 絕對禁止在未經使用者明確指示的情況下，使用任何模擬資料（如 Unsplash 圖片、寫死的假字串、假 JSON 或假 API 端點）來「敷衍」或「假裝」功能已經完成。
- **缺失處理原則**: 當遇到缺少實際 API 端點、金鑰或其他依賴條件時，必須**立刻停下來詢問使用者**。嚴禁自作聰明加入 fallback 機制或假畫面來混淆使用者的測試體驗。
- **誠實原則**: 介面開發就是介面開發。如果這是一個純前端 UI 介面，就讓它保持純 UI 的狀態，絕不可以在底層偷偷塞入假的網路請求來假裝它是一個完整的全端應用。

任何違反此規則的行為都被視為極度嚴重的過失。

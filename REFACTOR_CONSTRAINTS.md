# Refactor Constraints

## 必須保留
- 所有既有路由
- API request format
- 表單欄位名稱
- 資料結構
- 現有代碼邏輯
- URL query parameters
- localStorage keys
- analytics events
- 測試依賴的 data-testid

## 可以修改
- CSS
- Tailwind class
- UI component composition
- spacing
- typography
- responsive layout
- icon presentation
- visual state

## 修改前必須說明
- 移除元件
- 合併元件
- 改變 DOM 結構
- 改變互動方式
- 更換 UI library
- 更改依賴套件

## 禁止
- 為了視覺修改而重寫代碼邏輯
- 一次改完整個專案
- 未驗證便刪除舊元件
- 任意增加動畫與裝飾

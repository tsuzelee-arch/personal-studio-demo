@echo off
chcp 65001 > nul
echo ========================================
echo       Git 一鍵上傳腳本 (Git Auto Upload)
echo ========================================
echo.
echo 正在將所有變更加入 Git...
git add .

git diff --cached --quiet
if %ERRORLEVEL%==0 (
    echo.
    echo 目前沒有需要提交的變更，跳過 Commit。
    pause
    exit /b 0
)

set /p message="請輸入提交訊息 (直接按 Enter 預設為 'Auto update'): "
if "%message%"=="" set message=Auto update

echo.
echo 正在提交變更...
git commit -m "%message%"

echo.
echo 正在推送到遠端儲存庫...
git push

echo.
echo ========================================
echo               上傳完成！
echo ========================================
pause

@echo off
chcp 65001 > nul
echo ========================================
echo       Git 一鍵上傳至 Main 倉庫
echo ========================================
echo.
echo 正在將所有變更加入 Git...
git add .
echo.
echo 正在提交變更...
git commit -m "Auto update"
echo.
echo 正在推送到 origin (Personal Studio)...
git push origin HEAD:main
echo.
echo ========================================
echo               上傳完成！
echo ========================================
pause
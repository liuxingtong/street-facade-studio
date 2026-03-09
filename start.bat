@echo off
chcp 65001 >nul
set HF_ENDPOINT=https://hf-mirror.com
echo.
echo ========================================
echo   Street Facade 一键启动
echo ========================================
echo.
echo 启动后访问: http://localhost:3000
echo 约 15 秒后自动打开浏览器...
echo.
start /b cmd /c "timeout /t 15 /nobreak >nul && start http://localhost:3000"
call npm run start:all
pause

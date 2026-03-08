@echo off
chcp 65001 >nul
echo 批量处理：底图+prompt.txt -^> 生成图保存到 F:\Aworks\HFE2\newimage
echo 请确保 server (3001) 和 sam2_server (3002) 已启动
echo.
node scripts/batch-process.js
pause

@echo off
chcp 65001 >nul
echo 正在终止 3000 3001 3002 端口的进程...
for %%p in (3000 3001 3002 3003) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%%p ^| findstr LISTENING') do (
    echo 终止 PID %%a (端口 %%p)
    taskkill /PID %%a /F 2>nul
  )
)
echo 完成。
pause

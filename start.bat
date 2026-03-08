@echo off
chcp 65001 >nul
set HF_ENDPOINT=https://hf-mirror.com
call npm run start:all
pause

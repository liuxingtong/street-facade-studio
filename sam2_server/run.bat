@echo off
cd /d "%~dp0"
pip install -r requirements.txt
python -m uvicorn app:app --port 3002 --reload

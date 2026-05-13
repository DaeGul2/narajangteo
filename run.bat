@echo off
REM 백엔드(FastAPI:3001)와 프론트엔드(Vite:5173)를 동시에 띄움
cd /d "%~dp0"

echo [server] http://127.0.0.1:3001
start "g2b-server" cmd /k "cd server && python main.py"

timeout /t 2 /nobreak >nul

echo [client] http://localhost:5173
start "g2b-client" cmd /k "cd client && npm run dev"

echo.
echo 브라우저에서 http://localhost:5173 을 여세요.
echo 종료하려면 두 cmd 창을 닫으세요.

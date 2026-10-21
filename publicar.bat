@echo off
rem Publica la landing en Cloudflare Pages (proyecto "elnorge" -> https://elnorge.pages.dev).
rem Usa CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID del .env del repo de la app (..\elnorge\.env).
setlocal
cd /d "%~dp0"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("..\elnorge\.env") do set "%%a=%%b"
if "%CLOUDFLARE_API_TOKEN%"=="" (
  echo Falta CLOUDFLARE_API_TOKEN en ..\elnorge\.env
  exit /b 1
)
if exist dist rmdir /s /q dist
mkdir dist
copy /Y index.html dist\ >nul
xcopy /E /I /Q /Y assets dist\assets >nul
call npx --yes wrangler@4 pages deploy dist --project-name elnorge --branch main --commit-dirty=true || exit /b 1
echo Listo: https://elnorge.pages.dev

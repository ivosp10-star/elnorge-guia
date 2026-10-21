@echo off
rem Publica la landing y la API de licencias en Cloudflare Pages (proyecto "elnorge" -> https://elnorge.pages.dev).
rem Incluye la ultima actualizacion cifrada del contenido si existe (..\elnorge\actualizacion\).
rem Usa CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID del .env del repo de la app (..\elnorge\.env).
setlocal
cd /d "%~dp0"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("..\elnorge\.env") do set "%%a=%%b"
if "%CLOUDFLARE_API_TOKEN%"=="" (
  echo Falta CLOUDFLARE_API_TOKEN en ..\elnorge\.env
  exit /b 1
)
if not exist node_modules call npm install --silent || exit /b 1
call npm test || exit /b 1
node --disable-warning=ExperimentalWarning herramientas\armar.ts || exit /b 1
call npx --yes wrangler@4 pages deploy dist --project-name elnorge --branch main --commit-dirty=true || exit /b 1
echo Listo: https://elnorge.pages.dev

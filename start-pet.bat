@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 首次运行, 正在安装依赖 (Electron ~100MB, 使用 npmmirror 镜像)...
  set npm_config_registry=https://registry.npmmirror.com
  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  set npm_config_cache=%CD%\.npm-cache
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败, 请检查网络后重试。
    pause
    exit /b 1
  )
)
start "" node_modules\.bin\electron.cmd .

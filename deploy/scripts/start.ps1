# NasCabOS 服务端管理脚本（Windows PowerShell）
# 用法：
#   powershell -ExecutionPolicy Bypass -File deploy\scripts\start.ps1 -Action Start
#   powershell -ExecutionPolicy Bypass -File deploy\scripts\start.ps1 -Action Stop
#   powershell -ExecutionPolicy Bypass -File deploy\scripts\start.ps1 -Action Status
#
# 长期运行建议改用 Windows 服务：deploy\windows\install-service.ps1

[CmdletBinding()]
param(
    [ValidateSet("Start", "Stop", "Restart", "Status")]
    [string]$Action = "Start",
    [string]$AppDir = "",
    [string]$DataDir = "",
    [string]$LogDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $AppDir) {
    $AppDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $AppDir = Join-Path $AppDir "electron_server"
}
if (-not (Test-Path "$AppDir\src\main_nascab_os.js")) {
    Write-Error "未找到 $AppDir\src\main_nascab_os.js，请用 -AppDir 指定 electron_server 目录。"
    exit 1
}
if (-not $DataDir) { $DataDir = "$AppDir\data" }
if (-not $LogDir) { $LogDir = "$AppDir\logs" }
$PidFile = Join-Path $DataDir "nascabos.pid"

New-Item -ItemType Directory -Path $DataDir, $LogDir -Force | Out-Null

function Get-ServerPid {
    if (Test-Path $PidFile) {
        $p = (Get-Content $PidFile -Raw).Trim()
        if ($p) {
            $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
            if ($proc) { return $p }
        }
    }
    return $null
}

function Start-Server {
    $existing = Get-ServerPid
    if ($existing) { Write-Host "已在运行 (PID $existing)"; return }

    $env:NODE_ENV = "production"
    $env:NASCAB_DATA_DIR = $DataDir
    $env:NASCAB_LOG_DIR = $LogDir
    $env:NASCAB_HOST = "0.0.0.0"
    $env:PORT = "6789"
    $env:HTTPS_PORT = "6799"
    $env:NASCAB_HTTPS_ENABLED = "false"
    $env:NASCAB_PORT_FALLBACK = "false"
    $env:NASCAB_ACCESS_LOG = "true"
    $env:NASCAB_WORKER_AUTO_RESTART = "true"

    Write-Host "启动 NasCabOS ..."
    Write-Host "  应用目录: $AppDir"
    Write-Host "  数据目录: $DataDir"
    Write-Host "  日志目录: $LogDir"

    $out = Join-Path $LogDir "stdout.log"
    $err = Join-Path $LogDir "stderr.log"
    $proc = Start-Process -FilePath "node" -ArgumentList "src\main_nascab_os.js" `
        -WorkingDirectory $AppDir -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    $proc.Id | Set-Content -Path $PidFile -Encoding ascii

    Start-Sleep -Seconds 4
    if (Get-ServerPid) { Write-Host "已启动 (PID $($proc.Id))" }
    else {
        Write-Error "启动失败，请查看 $out 与 $err"
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        exit 1
    }
}

function Stop-Server {
    $serverPid = Get-ServerPid
    if (-not $serverPid) { Write-Host "未在运行"; Remove-Item $PidFile -ErrorAction SilentlyContinue; return }

    Write-Host "停止 NasCabOS (PID $serverPid) ..."

    # Windows 平台说明：
    #   1. Node 在 Windows 上收不到 SIGTERM，只能靠 CTRL_BREAK（应用已监听 SIGBREAK）走优雅关停；
    #   2. 但从脚本跨进程发 CTRL_BREAK 需要 GenerateConsoleCtrlEvent，而组 ID 传 0 会连带打断
    #      调用方自己（PowerShell 5.1 收到 CTRL_BREAK 会直接进入调试器中断模式），传目标 PID
    #      又要求目标以 CREATE_NEW_PROCESS_GROUP 启动——Start-Process 无法指定该标志。
    #   因此裸机脚本这里只能直接结束进程。
    #   3. 直接结束不会执行退出钩子，单例锁文件会残留；应用下次启动会检测到「持有者已死」并自动接管，
    #      不会卡住（已实测）。需要优雅关停请改用 Windows 服务：deploy\windows\install-service.ps1
    #      （WinSW 会以 stopsignal=ctrl-break 走 SIGBREAK 路径）。
    Stop-Process -Id $serverPid -Force

    for ($i = 0; $i -lt 30; $i++) {
        if (-not (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Seconds 1
    }
    if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) {
        Write-Error "进程 $serverPid 未能结束，请手动检查。"
        exit 1
    }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Write-Host "已停止"
    Write-Host "提示：直接结束进程会留下残留锁文件，下次启动将自动接管。"
}

function Show-Status {
    $serverPid = Get-ServerPid
    if ($serverPid) {
        Write-Host "运行中 (PID $serverPid)"
        try {
            $r = Invoke-RestMethod -Uri "http://127.0.0.1:6789/healthz" -TimeoutSec 8
            Write-Host ("健康检查: {0} serverId={1}" -f $r.message, $r.serverId)
        } catch {
            Write-Warning "进程存活但 /healthz 未响应: $_"
        }
    } else {
        Write-Host "未运行"
    }
}

switch ($Action) {
    "Start" { Start-Server }
    "Stop" { Stop-Server }
    "Restart" { Stop-Server; Start-Sleep -Seconds 2; Start-Server }
    "Status" { Show-Status }
}

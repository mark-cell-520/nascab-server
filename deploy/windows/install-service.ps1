# NasCabOS Windows 服务安装脚本
# 依赖：WinSW（https://github.com/winsw/winsw/releases）—— 把任意进程包装成 Windows 服务
# 用法（管理员 PowerShell）：
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1 -InstallDir C:\NasCabOS
# 卸载：
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1 -Uninstall

[CmdletBinding()]
param(
    [string]$InstallDir = "C:\NasCabOS",
    [string]$ServiceName = "NasCabOSServer",
    [string]$NodeDir = "",
    [string]$WinSwUrl = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Error "请以【管理员身份】运行 PowerShell 后再执行本脚本。"
    exit 1
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

# ---------------- 卸载 ----------------
if ($Uninstall) {
    if ($svc) {
        if ($svc.Status -eq "Running") { Stop-Service -Name $ServiceName -Force }
        & sc.exe delete $ServiceName | Out-Null
        Write-Host "服务 $ServiceName 已删除。"
    } else {
        Write-Host "服务 $ServiceName 不存在。"
    }
    exit 0
}

# ---------------- 安装前检查 ----------------
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
if (-not (Test-Path "$InstallDir\src\main_nascab_os.js")) {
    Write-Error "未找到 $InstallDir\src\main_nascab_os.js —— 请先把 electron_server 部署到 $InstallDir。"
    exit 1
}

# 定位 node.exe：优先参数指定，其次 PATH
if (-not $NodeDir) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) { $NodeDir = Split-Path $nodeCmd.Source -Parent }
}
if (-not $NodeDir -or -not (Test-Path "$NodeDir\node.exe")) {
    Write-Error "未找到 node.exe，请用 -NodeDir 指定 Node 安装目录。注意：需要 Node 22 LTS。"
    exit 1
}

$nodeVersion = (& "$NodeDir\node.exe" --version) 2>$null
Write-Host "Node 版本: $nodeVersion"
if ($nodeVersion -notmatch "^v22\.") {
    Write-Warning "当前 Node 为 $nodeVersion，官方建议 v22.x（Electron 37 对应 Node 22；nodejieba 等原生模块仅在该 ABI 有预编译二进制）。"
}

# 下载 WinSW
$winsw = "$InstallDir\$ServiceName.exe"
if (-not (Test-Path $winsw)) {
    Write-Host "下载 WinSW ..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $WinSwUrl -OutFile $winsw
}

# 数据与日志目录
$dataDir = "$InstallDir\data"
$logDir = "$InstallDir\logs"
New-Item -ItemType Directory -Path $dataDir, $logDir -Force | Out-Null

# ---------------- 生成 WinSW 配置 ----------------
# 停止策略说明：
#   * Node 在 Windows 上收不到 SIGTERM，应用侧额外监听了 SIGBREAK（CTRL_BREAK）；
#   * WinSW 作为独立的 .NET 服务宿主，用 stopsignal=ctrl-break 向子进程发 CTRL_BREAK，
#     不会出现「脚本自己被打断」的问题（PowerShell 5.1 收到 CTRL_BREAK 会进调试器，故裸机脚本不发信号）；
#   * 该路径为 best-effort：若信号未送达，WinSW 会在 stopexec 超时后强杀；
#   * 无论哪种结束方式，单例锁文件都可能残留——应用下次启动检测到「持有者已死」会自动接管，
#     不会卡住（已实测）。这就是为什么强杀也不会导致服务起不来。
$xml = @"
<service>
  <id>$ServiceName</id>
  <name>$ServiceName</name>
  <description>NasCabOS NAS 服务端（无界面模式）</description>
  <executable>$NodeDir\node.exe</executable>
  <arguments>src\main_nascab_os.js</arguments>
  <workingdirectory>$InstallDir</workingdirectory>
  <logpath>$logDir\service</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>20480</sizeThreshold>
    <keepFiles>10</keepFiles>
  </log>

  <env name="NODE_ENV" value="production"/>
  <env name="NASCAB_DATA_DIR" value="$dataDir"/>
  <env name="NASCAB_LOG_DIR" value="$logDir"/>
  <env name="NASCAB_HOST" value="0.0.0.0"/>
  <env name="PORT" value="6789"/>
  <env name="HTTPS_PORT" value="6799"/>
  <env name="NASCAB_HTTPS_ENABLED" value="false"/>
  <env name="NASCAB_PORT_FALLBACK" value="false"/>
  <env name="NASCAB_ACCESS_LOG" value="true"/>
  <env name="NASCAB_WORKER_AUTO_RESTART" value="true"/>
  <!-- express API worker 进程数。0 = 自动（默认 1 个）。
       每个 worker 常驻约 80~120MB，而 API 负载以文件流与 SQLite IO 为主、不是 CPU 密集；
       内存吃紧时保持 1 个，需要并发再按 CPU 核心数往大调 -->
  <env name="NASCAB_EXPRESS_COUNT" value="0"/>
  <!-- Web 控制台显示的产品名 -->
  <env name="NASCAB_CONSOLE_TITLE" value="NasCabOS"/>
  <!-- 机器控制接口（/api/control）：面向脚本 / AI Agent 的 root 级控制面。
       默认只听 127.0.0.1:6792，本机脚本可直接用；需要远程控制时改成 0.0.0.0 并配好防火墙。
       令牌留空则首次启动自动生成，写进 <数据目录>/control.json，重启后复用 -->
  <env name="NASCAB_CONTROL_ENABLED" value="true"/>
  <env name="NASCAB_CONTROL_HOST" value="127.0.0.1"/>
  <env name="NASCAB_CONTROL_PORT" value="6792"/>
  <!-- <env name="NASCAB_CONTROL_TOKEN" value="ncctl_请换成自己的令牌"/> -->
  <!-- 首个超级管理员：两项都填才生效；留空则随机生成，账号密码见日志目录 combined.log 的启动横幅 -->
  <!--
  <env name="NASCAB_ADMIN_USER" value="admin"/>
  <env name="NASCAB_ADMIN_PASSWORD" value="请换成强密码"/>
  -->

  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>

  <!-- 优先尝试优雅停止：发送 CTRL_BREAK（node 侧已监听 SIGBREAK）。best-effort，
       未送达时由 stopexec 超时后强杀；残留的单例锁下次启动会自动接管 -->
  <stopsignal>ctrl-break</stopsignal>
  <stopexec timeout="60"/>
  <!-- 超时后强杀 -->
  <onfailure action="restart" delay="10 sec"/>
  <resetfailure>1 hour</resetfailure>
</service>
"@

$xmlPath = "$InstallDir\$ServiceName.xml"
# WinSW 配置需为 UTF-8（无 BOM 亦可，但中文描述建议带 BOM 避免乱码）
$utf8Bom = New-Object Text.UTF8Encoding($true)
[IO.File]::WriteAllText($xmlPath, $xml, $utf8Bom)
Write-Host "已生成服务配置: $xmlPath"

# ---------------- 安装并启动 ----------------
if ($svc) {
    Write-Host "服务已存在，先卸载旧实例 ..."
    if ($svc.Status -eq "Running") { Stop-Service -Name $ServiceName -Force }
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

& $winsw install
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
Start-Service -Name $ServiceName
Start-Sleep -Seconds 5

$svc = Get-Service -Name $ServiceName
Write-Host ""
Write-Host "===== 安装完成 ====="
Write-Host "服务名  : $ServiceName"
Write-Host "状态    : $($svc.Status)"
Write-Host "数据目录: $dataDir"
Write-Host "日志目录: $logDir"
Write-Host ""
Write-Host "常用命令："
Write-Host "  查看状态  : Get-Service $ServiceName"
Write-Host "  停止/启动 : Stop-Service $ServiceName / Start-Service $ServiceName"
Write-Host "  卸载      : $($MyInvocation.MyCommand.Path) -Uninstall"
Write-Host "  健康检查  : curl http://127.0.0.1:6789/healthz"

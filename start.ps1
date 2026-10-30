# start.ps1 — 爬宠繁育管理系统启动脚本（PowerShell 5.1 兼容）
# 用法：.\start.ps1 [-Port 3000] [-Diagnose] [-NoPause]
param(
  [int]$Port = 3000,
  [switch]$Diagnose,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

function Find-Node {
  $candidates = New-Object System.Collections.Generic.List[string]
  # 1. PATH 中的 node
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { $candidates.Add([string]$cmd.Source) }
  # 2. WorkBuddy 托管版本（较新的优先）
  $wbRoot = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions'
  if (Test-Path $wbRoot) {
    Get-ChildItem -Path $wbRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { $candidates.Add((Join-Path $_.FullName 'node.exe')) }
  }
  # 3. 常见安装位置
  $candidates.Add("$env:ProgramFiles\nodejs\node.exe")
  $candidates.Add("${env:ProgramFiles(x86)}\nodejs\node.exe")
  # 4. 注册表 PATH 中的 node（解决刚装完环境变量未刷新）
  foreach ($hive in @('HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'HKCU:\Environment')) {
    try {
      $p = (Get-ItemProperty -Path $hive -Name Path -ErrorAction SilentlyContinue).Path
      if ($p) {
        foreach ($seg in ($p -split ';')) {
          if ($seg -and (Test-Path -Path (Join-Path $seg 'node.exe') -PathType Leaf)) {
            $candidates.Add((Join-Path $seg 'node.exe'))
          }
        }
      }
    } catch { }
  }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -Path $c -PathType Leaf)) {
      try {
        $ver = & $c --version 2>$null
        if ($LASTEXITCODE -eq 0) { return @{ Path = $c; Version = $ver } }
      } catch { }
    }
  }
  return $null
}

$node = Find-Node
if ($Diagnose) {
  Write-Host '[诊断] Node 候选检测：'
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  Write-Host ("  PATH 节点: " + $(if ($cmd) { $cmd.Source } else { '未找到' }))
  foreach ($hive in @('HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'HKCU:\Environment')) {
    try {
      $p = (Get-ItemProperty -Path $hive -Name Path -ErrorAction SilentlyContinue).Path
      if ($p) {
        foreach ($seg in ($p -split ';')) {
          if ($seg -and (Test-Path -Path (Join-Path $seg 'node.exe') -PathType Leaf)) {
            Write-Host ("  注册表候选: " + (Join-Path $seg 'node.exe'))
          }
        }
      }
    } catch { }
  }
  Write-Host ("[诊断] 采用: " + $(if ($node) { "$($node.Path) $($node.Version)" } else { '无可用 Node' }))
  $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
  if ($conns) { Write-Host "[诊断] 端口 $Port 已被占用 (PID: $($conns[0].OwningProcess))" } else { Write-Host "[诊断] 端口 $Port 空闲" }
}

if (-not $node) {
  Write-Host ''
  Write-Host '[错误] 未找到可用的 Node.js（需要 22+）。'
  Write-Host '  请先安装 Node.js：https://nodejs.org'
  if (-not $NoPause) { Read-Host '按回车退出' }
  exit 1
}

Write-Host "[爬宠繁育管理系统] Node: $($node.Version)  端口: $Port"
Push-Location $Root
try {
  & $node.Path (Join-Path $Root 'server.js') "--port=$Port"
} finally {
  Pop-Location
}

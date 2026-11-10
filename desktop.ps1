param(
  [Parameter(Mandatory)][ValidateSet('Install','Register','Login','Configure','Status')][string]$Action,
  [string]$Session, [string]$CredentialFile,
  [ValidateSet('active','mixed','passive')][string]$Mode,
  [string]$Runtime = 'E:\ds-harness-desktop\runtime',
  [string]$Archive
)
$ErrorActionPreference = 'Stop'
if (-not $env:DSH_HOME) { $env:DSH_HOME = Join-Path $env:USERPROFILE '.ds-harness-desktop\dsh-home' }
$profileDir = Join-Path $env:DSH_HOME 'profiles\web'
if ($Action -eq 'Install') {
  if (-not $Archive) {
    & (Join-Path $Runtime 'bin\dsh.cmd') plugin --profile web add 'dsh-plugin-starpost@latest' '--registry=https://registry.npmjs.org'
    exit $LASTEXITCODE
  }
  $vendor = Join-Path $profileDir 'vendor'
  New-Item -ItemType Directory -Force -Path $vendor | Out-Null
  Copy-Item -LiteralPath $Archive -Destination (Join-Path $vendor 'dsh-plugin-starpost-0.1.1.tgz') -Force
  & (Join-Path $Runtime 'bin\dsh.cmd') plugin --profile web add 'file:vendor/dsh-plugin-starpost-0.1.1.tgz'
} else {
  $cli = Join-Path $profileDir 'node_modules\dsh-plugin-starpost\src\account.mjs'
  if (-not (Test-Path -LiteralPath $cli)) { throw '请先安装插件包' }
  $flags = @($Action.ToLowerInvariant())
  if ($Session) { $flags += @('--session',$Session) }
  if ($Mode) { $flags += @('--mode',$Mode) }
  if ($CredentialFile) { $flags += @('--file',(Resolve-Path -LiteralPath $CredentialFile).Path) }
  & (Join-Path $Runtime 'node\node.exe') $cli @flags
}
exit $LASTEXITCODE

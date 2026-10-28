# Baixa o Python "embutido" (portátil, ~11 MB) só pra pasta do jogo — não instala nada no
# Windows, não precisa de administrador e não mexe em outro Python que você tenha.
param([string]$Dest)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (Test-Path (Join-Path $Dest 'pythonw.exe')) { Write-Output 'Python do jogo: ja instalado.'; exit 0 }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$ver = '3.12.10'
$arch = switch ($env:PROCESSOR_ARCHITECTURE) { 'ARM64' { 'arm64' } 'x86' { if ($env:PROCESSOR_ARCHITEW6432) { 'amd64' } else { 'win32' } } default { 'amd64' } }
$url = "https://www.python.org/ftp/python/$ver/python-$ver-embed-$arch.zip"
$zip = Join-Path $env:TEMP 'djmax-training-python.zip'
Write-Output "Baixando o Python $ver ($arch)..."
for ($i = 1; $i -le 3; $i++) {
    try { Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing; break }
    catch { if ($i -eq 3) { Write-Output "ERRO: nao deu pra baixar ($($_.Exception.Message))"; exit 2 }; Start-Sleep -Seconds 2 }
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Expand-Archive -Path $zip -DestinationPath $Dest -Force
Remove-Item $zip -ErrorAction SilentlyContinue
if (-not (Test-Path (Join-Path $Dest 'pythonw.exe'))) { Write-Output 'ERRO: pythonw.exe nao apareceu'; exit 3 }
Write-Output 'Python do jogo: pronto.'
exit 0

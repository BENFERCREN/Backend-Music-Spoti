param(
    [string]$PublicBaseUrl = 'http://127.0.0.1:10000',
    [int]$Port = 10000
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Instala Node.js 22 o superior antes de iniciar el backend.'
}
$nodeMajor = & node -p 'process.versions.node.split(".")[0]'
if ([int]$nodeMajor -lt 22) { throw 'Este backend requiere Node.js 22 o superior.' }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Instala Python 3.10 o superior y agrega python al PATH.'
}
& python -m yt_dlp --version
if ($LASTEXITCODE -ne 0) {
    throw 'Instala el extractor con: python -m pip install "yt-dlp[default]"'
}
$musicKeyFile = Join-Path $PSScriptRoot '.local-api-key'
if (-not (Test-Path -LiteralPath $musicKeyFile)) {
    $musicKey = & node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar la clave.' }
    [System.IO.File]::WriteAllText($musicKeyFile, $musicKey)
}
$env:API_KEY = (Get-Content -LiteralPath $musicKeyFile -Raw).Trim()
$env:PUBLIC_BASE_URL = $PublicBaseUrl
$env:PORT = [string]$Port
Write-Host "Backend: $PublicBaseUrl"
Write-Host 'Clave guardada en music-backend/.local-api-key. Copiala en apiKey del config.lua del servidor.'
Write-Host '127.0.0.1 solo sirve para pruebas en esta PC. Bisect requiere una URL publica accesible por los jugadores.'
& node server.js
if ($LASTEXITCODE -ne 0) { throw 'El backend no pudo iniciarse. Revisa el error anterior.' }

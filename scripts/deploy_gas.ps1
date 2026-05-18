# scripts/deploy_gas.ps1 - Automated multi-environment Google Apps Script deployment

$ErrorActionPreference = "Stop"

$parrocchiaId = "11uYezYdIEK-WjV0ET7B-zWEoWpafK0E3-y1HLrdabPrSUTWxRwEQ4yMS"
$donRaimondoId = "1YsLvaTkhViwhIg8YPQtqj0YBetNWwYXgMGtWMcoR6ejM3IIqW95V7Wqx"

$claspJsonPath = Join-Path $PSScriptRoot "..\.clasp.json"
$claspJsonPath = [System.IO.Path]::GetFullPath($claspJsonPath)

# Back up original .clasp.json if it exists
$backupPath = "$claspJsonPath.bak"
if (Test-Path $claspJsonPath) {
    Copy-Item $claspJsonPath $backupPath -Force
    Write-Host "Backup of .clasp.json created." -ForegroundColor Gray
}

function Write-ClaspJson($scriptId) {
    $content = @{
        scriptId = $scriptId
        rootDir = "./"
    } | ConvertTo-Json -Compress
    Set-Content -Path $claspJsonPath -Value $content -Force
}

try {
    # 1. PARROCCHIA
    Write-Host "[1/2] Deploying environment: PARROCCHIA..." -ForegroundColor Cyan
    Write-ClaspJson $parrocchiaId
    npx clasp push -f

    # 2. DON RAIMONDO
    Write-Host "[2/2] Deploying environment: donRaimondo..." -ForegroundColor Cyan
    Write-ClaspJson $donRaimondoId
    npx clasp push -f

    Write-Host "SUCCESS: Both GAS environments have been successfully updated!" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: Deployment failed: $_" -ForegroundColor Red
    throw
}
finally {
    # Restore backup
    if (Test-Path $backupPath) {
        Move-Item $backupPath $claspJsonPath -Force
        Write-Host "Original .clasp.json restored." -ForegroundColor Gray
    }
}

# scripts/deploy_gas.ps1 - Automated multi-environment Google Apps Script deployment

$ErrorActionPreference = "Stop"

$claspJsonPath = Join-Path $PSScriptRoot "..\.clasp.json"
$claspJsonPath = [System.IO.Path]::GetFullPath($claspJsonPath)
$projectRoot = Split-Path -Parent $claspJsonPath
$deployConfigPath = Join-Path $PSScriptRoot "deploy_gas.local.json"
$hadOriginalClaspJson = Test-Path $claspJsonPath
$backupPath = "$claspJsonPath.$([Guid]::NewGuid().ToString('N')).bak"

function Get-LocalDeployConfig($path) {
    if (-not (Test-Path $path)) {
        return $null
    }

    try {
        return Get-Content -Path $path -Raw | ConvertFrom-Json
    }
    catch {
        throw "Invalid deploy config at ${path}: $_"
    }
}

function Get-DeployScriptId($environmentName, $envVarName, $localConfig) {
    $fromEnv = [Environment]::GetEnvironmentVariable($envVarName)
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
        return $fromEnv.Trim()
    }

    if ($null -ne $localConfig) {
        $property = $localConfig.PSObject.Properties[$envVarName]
        if ($property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
            return ([string]$property.Value).Trim()
        }
    }

    throw "Missing script ID for $environmentName. Set environment variable $envVarName or add $envVarName to scripts\deploy_gas.local.json."
}

function Write-ClaspJson($scriptId) {
    $content = @{
        scriptId = $scriptId
        rootDir = "./"
    } | ConvertTo-Json -Compress
    Set-Content -Path $claspJsonPath -Value $content -Force
}

function Invoke-ClaspPush($environmentName) {
    $pushExitCode = 0
    Push-Location -LiteralPath $projectRoot
    try {
        clasp.cmd push -f
        $pushExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($pushExitCode -ne 0) {
        throw "clasp push failed for $environmentName (exit code $pushExitCode)"
    }
}

$localConfig = Get-LocalDeployConfig $deployConfigPath
$parrocchiaId = Get-DeployScriptId "PARROCCHIA" "GAS_PARROCCHIA_SCRIPT_ID" $localConfig
$donRaimondoId = Get-DeployScriptId "DON_RAIMONDO" "GAS_DON_RAIMONDO_SCRIPT_ID" $localConfig

if ($hadOriginalClaspJson) {
    Copy-Item $claspJsonPath $backupPath -Force
    Write-Host "Backup of .clasp.json created." -ForegroundColor Gray
}

try {
    # 1. PARROCCHIA
    Write-Host "[1/2] Deploying environment: PARROCCHIA..." -ForegroundColor Cyan
    Write-ClaspJson $parrocchiaId
    Invoke-ClaspPush "PARROCCHIA"

    # 2. DON RAIMONDO
    Write-Host "[2/2] Deploying environment: donRaimondo..." -ForegroundColor Cyan
    Write-ClaspJson $donRaimondoId
    Invoke-ClaspPush "donRaimondo"

    Write-Host "SUCCESS: Both GAS environments have been successfully updated!" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: Deployment failed: $_" -ForegroundColor Red
    throw
}
finally {
    if ($hadOriginalClaspJson -and (Test-Path $backupPath)) {
        Move-Item $backupPath $claspJsonPath -Force
        Write-Host "Original .clasp.json restored." -ForegroundColor Gray
    }
    elseif (-not $hadOriginalClaspJson -and (Test-Path $claspJsonPath)) {
        Remove-Item $claspJsonPath -Force
        Write-Host "Temporary .clasp.json removed." -ForegroundColor Gray
    }
}

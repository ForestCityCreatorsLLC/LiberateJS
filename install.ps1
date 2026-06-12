# Base44 Standalone Converter Extension Installer
# This script sets up the global IDE skill configuration and checks for dependencies.

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Installing Base44 Standalone Converter..." -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Setup paths
$globalConfigDir = "$env:USERPROFILE\.gemini\config\skills\base44-converter"
$scriptsDir = "$globalConfigDir\scripts"
$uiDir = "$globalConfigDir\ui"

$sourceDir = Get-Item .
$sourceSkillFile = Join-Path $sourceDir "SKILL.md"
$sourceScript = Join-Path $sourceDir "base44-cleanse.py"
$sourceLauncher = Join-Path $sourceDir "run-dashboard.bat"
$sourceUiIndex = Join-Path $sourceDir "ui\index.html"
$sourceUiStyle = Join-Path $sourceDir "ui\styles.css"
$sourceUiApp = Join-Path $sourceDir "ui\app.js"
$sourceUiServer = Join-Path $sourceDir "ui\server.js"
$sourceAstRewriter = Join-Path $sourceDir "scripts\ast-rewriter.js"

# 2. Dependency Checks
Write-Host "[1/4] Verifying system dependencies..." -ForegroundColor Yellow
$dependenciesPassed = $true

# Check Python
try {
    $pyVer = python --version 2>&1
    Write-Host "  [OK] Python is installed: $pyVer" -ForegroundColor Green
} catch {
    Write-Host "  [X] Python was not found in your system PATH." -ForegroundColor Red
    Write-Host "      Please install Python 3.x to execute the cleansing script." -ForegroundColor DarkGray
    $dependenciesPassed = $false
}

# Check Git
try {
    $gitVer = git --version 2>&1
    Write-Host "  [OK] Git is installed: $gitVer" -ForegroundColor Green
} catch {
    Write-Host "  [X] Git was not found in your system PATH." -ForegroundColor Red
    Write-Host "      Please install Git to enable version control features." -ForegroundColor DarkGray
    $dependenciesPassed = $false
}

# Check Node.js (needed for local server)
try {
    $nodeVer = node --version 2>&1
    Write-Host "  [OK] Node.js is installed: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  [X] Node.js was not found in your system PATH." -ForegroundColor Red
    Write-Host "      Please install Node.js (v16+) to run the extension's local server." -ForegroundColor DarkGray
    $dependenciesPassed = $false
}

# Check GitHub CLI
try {
    $ghVer = gh --version 2>&1
    $ghVerFirstLine = $ghVer -split '\r?\n' | Select-Object -First 1
    Write-Host "  [OK] GitHub CLI is installed: $ghVerFirstLine" -ForegroundColor Green
} catch {
    Write-Host "  [!] GitHub CLI (gh) was not found." -ForegroundColor Yellow
    Write-Host "      Install it to enable automated GitHub repository creation." -ForegroundColor DarkGray
}

Write-Host ""

# 3. Create target directories
Write-Host "[2/4] Initializing installation paths..." -ForegroundColor Yellow
if (-not (Test-Path $globalConfigDir)) {
    New-Item -ItemType Directory -Path $globalConfigDir | Out-Null
}
if (-not (Test-Path $scriptsDir)) {
    New-Item -ItemType Directory -Path $scriptsDir | Out-Null
}
if (-not (Test-Path $uiDir)) {
    New-Item -ItemType Directory -Path $uiDir | Out-Null
}
Write-Host "  [OK] Global configuration directories created." -ForegroundColor Green
Write-Host ""

# 4. Copy files
Write-Host "[3/4] Packaging and copying extension components..." -ForegroundColor Yellow

# Copy Skill Manifest
if (Test-Path $sourceSkillFile) {
    Copy-Item -Path $sourceSkillFile -Destination $globalConfigDir -Force
    Write-Host "  [OK] Copied SKILL.md to global skills directory." -ForegroundColor Green
} else {
    Write-Host "  [i] SKILL.md is already global. Skipping copy." -ForegroundColor DarkGray
}

# Copy Cleansing script
if (Test-Path $sourceScript) {
    Copy-Item -Path $sourceScript -Destination (Join-Path $scriptsDir "base44-cleanse.py") -Force
    Write-Host "  [OK] Copied cleanser script to global scripts directory." -ForegroundColor Green
}

# Copy AST Rewriter script
if (Test-Path $sourceAstRewriter) {
    Copy-Item -Path $sourceAstRewriter -Destination (Join-Path $scriptsDir "ast-rewriter.js") -Force
    Write-Host "  [OK] Copied AST rewriter script to global scripts directory." -ForegroundColor Green
}

# Copy Dashboard Launcher
if (Test-Path $sourceLauncher) {
    Copy-Item -Path $sourceLauncher -Destination $globalConfigDir -Force
    Write-Host "  [OK] Copied run-dashboard.bat launcher to global skill root." -ForegroundColor Green
}

# Copy UI elements
if (Test-Path $sourceUiIndex) {
    Copy-Item -Path $sourceUiIndex -Destination $uiDir -Force
    Copy-Item -Path $sourceUiStyle -Destination $uiDir -Force
    Copy-Item -Path $sourceUiApp -Destination $uiDir -Force
    Copy-Item -Path $sourceUiServer -Destination $uiDir -Force
    Write-Host "  [OK] Copied Dashboard UI components and Node.js server server.js." -ForegroundColor Green
}
Write-Host ""

# 5. Diagnostic Validation
Write-Host "[4/4] Running installation diagnostics..." -ForegroundColor Yellow
$installedSkillPath = Join-Path $globalConfigDir "SKILL.md"
$installedScriptPath = Join-Path $scriptsDir "base44-cleanse.py"
$installedAstRewriterPath = Join-Path $scriptsDir "ast-rewriter.js"
$installedUiIndex = Join-Path $uiDir "index.html"
$installedLauncher = Join-Path $globalConfigDir "run-dashboard.bat"

if ((Test-Path $installedSkillPath) -and (Test-Path $installedScriptPath) -and (Test-Path $installedAstRewriterPath) -and (Test-Path $installedUiIndex) -and (Test-Path $installedLauncher)) {
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  INSTALLATION COMPLETED SUCCESSFULLY!" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Extension Path: $globalConfigDir" -ForegroundColor DarkGray
    Write-Host "  Launcher Path:  $installedLauncher" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. Double click run-dashboard.bat to launch the visual interface." -ForegroundColor Cyan
    Write-Host "  2. Activate in your IDE chat: 'Run base44-converter skill'." -ForegroundColor Cyan
    Write-Host ""
    
    # Prompt to open launcher
    $openDashboard = Read-Host "Would you like to run the Dashboard UI now? (Y/N)"
    if ($openDashboard -eq 'Y' -or $openDashboard -eq 'y') {
        Start-Process $installedLauncher
    }
} else {
    Write-Host "  [X] Installation failed. Some component files were not copied correctly." -ForegroundColor Red
    Exit 1
}

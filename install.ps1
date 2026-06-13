# LiberateJS Extension Installer
# This script sets up the global IDE skill configuration and checks for dependencies.

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Installing LiberateJS..." -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Setup paths
$globalConfigDir = "$env:USERPROFILE\.gemini\config\skills\liberatejs"
$scriptsDir = "$globalConfigDir\scripts"
$uiDir = "$globalConfigDir\ui"
$recipesDir = "$globalConfigDir\recipes"

$sourceDir = Get-Item .
$sourceSkillFile = Join-Path $sourceDir "SKILL.md"
$sourceLauncher = Join-Path $sourceDir "run-dashboard.bat"
$sourceUiIndex = Join-Path $sourceDir "ui\index.html"
$sourceUiStyle = Join-Path $sourceDir "ui\styles.css"
$sourceUiApp = Join-Path $sourceDir "ui\app.js"
$sourceUiServer = Join-Path $sourceDir "ui\server.js"
$sourceRecipes = Join-Path $sourceDir "recipes"

# 2. Dependency Checks
Write-Host "[1/4] Verifying system dependencies..." -ForegroundColor Yellow
$dependenciesPassed = $true

# Git is required for version control

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
if (-not (Test-Path $recipesDir)) {
    New-Item -ItemType Directory -Path $recipesDir | Out-Null
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

# Copy Recipes
if (Test-Path $sourceRecipes) {
    Copy-Item -Path "$sourceRecipes\*" -Destination $recipesDir -Recurse -Force
    Write-Host "  [OK] Copied decoupling recipes to global recipes directory." -ForegroundColor Green
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

# Copy compiled TypeScript dist/ directory
$sourceDist = Join-Path $sourceDir "dist"
if (Test-Path $sourceDist) {
    Copy-Item -Path $sourceDist -Destination $globalConfigDir -Recurse -Force
    Write-Host "  [OK] Copied compiled TypeScript engine (dist/) to global directory." -ForegroundColor Green
}

# Copy executable bin/ directory
$sourceBin = Join-Path $sourceDir "bin"
if (Test-Path $sourceBin) {
    Copy-Item -Path $sourceBin -Destination $globalConfigDir -Recurse -Force
    Write-Host "  [OK] Copied executable wrapper (bin/) to global directory." -ForegroundColor Green
}

# Copy recipes/ directory to global
if (Test-Path $sourceRecipes) {
    # Ensure recipes directory exists in global config dir
    $targetGlobalRecipes = Join-Path $globalConfigDir "recipes"
    if (-not (Test-Path $targetGlobalRecipes)) {
        New-Item -ItemType Directory -Path $targetGlobalRecipes | Out-Null
    }
    Copy-Item -Path "$sourceRecipes\*" -Destination $targetGlobalRecipes -Recurse -Force
    Write-Host "  [OK] Copied recipes folder to global directory." -ForegroundColor Green
}

# Copy package.json to global root so dependencies can be resolved
$sourcePkgJson = Join-Path $sourceDir "package.json"
if (Test-Path $sourcePkgJson) {
    Copy-Item -Path $sourcePkgJson -Destination $globalConfigDir -Force
    Write-Host "  [OK] Copied package.json to global directory." -ForegroundColor Green
}

# Install npm dependencies in global directory so compiled CLI runs properly
Write-Host "  Running npm install in global directory to download dependencies..."
Start-Process -FilePath "npm" -ArgumentList "install --production" -WorkingDirectory $globalConfigDir -NoNewWindow -Wait

Write-Host ""

# 5. Diagnostic Validation
Write-Host "[4/4] Running installation diagnostics..." -ForegroundColor Yellow
$installedSkillPath = Join-Path $globalConfigDir "SKILL.md"
$installedUiIndex = Join-Path $uiDir "index.html"
$installedLauncher = Join-Path $globalConfigDir "run-dashboard.bat"
$installedCliJs = Join-Path $globalConfigDir "dist\cli.js"
$installedBinJs = Join-Path $globalConfigDir "bin\liberate.js"

if ((Test-Path $installedSkillPath) -and (Test-Path $installedUiIndex) -and (Test-Path $installedLauncher) -and (Test-Path $installedCliJs) -and (Test-Path $installedBinJs)) {
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
    Write-Host "  2. Activate in your IDE chat: 'Run liberatejs skill'." -ForegroundColor Cyan
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

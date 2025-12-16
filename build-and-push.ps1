#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build, tag, and push the WarEra Discord Bot Docker image

.DESCRIPTION
    This script builds the Docker image, tags it with version and 'latest',
    and pushes it to the specified Docker registry.

.PARAMETER Registry
    Docker registry URL (e.g., 'docker.io/myuser', 'ghcr.io/myorg')

.PARAMETER ImageName
    Docker image name (default: 'warera-discord-bot')

.PARAMETER PushLatest
    Whether to also push the 'latest' tag (default: true)

.PARAMETER SkipPush
    Build and tag only, skip pushing to registry

.EXAMPLE
    .\build-and-push.ps1 -Registry "docker.io/myuser"
    
.EXAMPLE
    .\build-and-push.ps1 -Registry "ghcr.io/myorg" -ImageName "warera-bot" -PushLatest $false
    
.EXAMPLE
    .\build-and-push.ps1 -Registry "docker.io/myuser" -SkipPush
#>

param(
    [Parameter(Mandatory=$true, HelpMessage="Docker registry URL (e.g., docker.io/myuser)")]
    [string]$Registry,
    
    [Parameter(Mandatory=$false)]
    [string]$ImageName = "warera-discord-bot",
    
    [Parameter(Mandatory=$false)]
    [bool]$PushLatest = $true,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipPush
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Colors for output
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Warning { Write-Host $args -ForegroundColor Yellow }
function Write-Failure { Write-Host $args -ForegroundColor Red }

Write-Info "========================================"
Write-Info "WarEra Discord Bot - Build & Push Script"
Write-Info "========================================"

# Get the script directory and project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Read version from package.json
$PackageJsonPath = Join-Path $ScriptDir "package.json"
if (-not (Test-Path $PackageJsonPath)) {
    Write-Failure "Error: package.json not found at $PackageJsonPath"
    exit 1
}

$PackageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
$Version = $PackageJson.version

Write-Info "`nProject Information:"
Write-Host "  Name:        $($PackageJson.name)"
Write-Host "  Version:     $Version"
Write-Host "  Registry:    $Registry"
Write-Host "  Image Name:  $ImageName"
Write-Host "  Project Dir: $ProjectRoot"
Write-Host ""

# Construct image tags
$VersionTag = "${Registry}/${ImageName}:${Version}"
$LatestTag = "${Registry}/${ImageName}:latest"

# Check if we're in the correct directory structure
$WarEraBotPath = Join-Path $ProjectRoot "WarEraBot"
$WarEraSDKPath = Join-Path $ProjectRoot "WarEraSDK"

if (-not (Test-Path $WarEraBotPath)) {
    Write-Failure "Error: WarEraBot directory not found at $WarEraBotPath"
    Write-Warning "This script must be run from within the WarEraBot directory,"
    Write-Warning "and the parent directory must contain both WarEraBot and WarEraSDK."
    exit 1
}

if (-not (Test-Path $WarEraSDKPath)) {
    Write-Warning "Warning: WarEraSDK directory not found at $WarEraSDKPath"
    Write-Warning "The Docker build may fail if it requires the SDK."
}

# Build the Docker image
Write-Info "Step 1: Building Docker image..."
Write-Host "  Building from: $ProjectRoot"
Write-Host "  Dockerfile:    WarEraBot/Dockerfile"
Write-Host "  Tag:           $VersionTag"
Write-Host ""

try {
    Push-Location $ProjectRoot
    
    docker build -f WarEraBot/Dockerfile -t $VersionTag .
    
    if ($LASTEXITCODE -ne 0) {
        throw "Docker build failed with exit code $LASTEXITCODE"
    }
    
    Write-Success "✓ Docker image built successfully: $VersionTag"
    
    # Tag with 'latest' if requested
    if ($PushLatest) {
        Write-Info "`nStep 2: Tagging image as 'latest'..."
        docker tag $VersionTag $LatestTag
        
        if ($LASTEXITCODE -ne 0) {
            throw "Docker tag failed with exit code $LASTEXITCODE"
        }
        
        Write-Success "✓ Tagged as: $LatestTag"
    }
    
    # Push to registry if not skipped
    if (-not $SkipPush) {
        Write-Info "`nStep 3: Pushing to registry..."
        
        # Push version tag
        Write-Host "  Pushing $VersionTag..."
        docker push $VersionTag
        
        if ($LASTEXITCODE -ne 0) {
            throw "Docker push failed with exit code $LASTEXITCODE"
        }
        
        Write-Success "✓ Pushed: $VersionTag"
        
        # Push latest tag if requested
        if ($PushLatest) {
            Write-Host "  Pushing $LatestTag..."
            docker push $LatestTag
            
            if ($LASTEXITCODE -ne 0) {
                throw "Docker push failed with exit code $LASTEXITCODE"
            }
            
            Write-Success "✓ Pushed: $LatestTag"
        }
        
        Write-Success "`n✓ All images pushed successfully!"
    } else {
        Write-Info "`nSkipping push (--SkipPush specified)"
    }
    
    Write-Success "`n========================================"
    Write-Success "Build completed successfully!"
    Write-Success "========================================"
    Write-Host "`nImage Tags:"
    Write-Host "  - $VersionTag"
    if ($PushLatest) {
        Write-Host "  - $LatestTag"
    }
    Write-Host ""
    
    if (-not $SkipPush) {
        Write-Info "To pull and run this image:"
        Write-Host "  docker pull $VersionTag"
        Write-Host "  docker run --env-file .env $VersionTag"
    }
    
} catch {
    Write-Failure "`n✗ Error: $_"
    exit 1
} finally {
    Pop-Location
}

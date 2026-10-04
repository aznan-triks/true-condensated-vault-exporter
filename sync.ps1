#Requires -Version 5.1
<#
.SYNOPSIS
    Check, commit, and push changes on the current Git branch.
.DESCRIPTION
    Uses the currently checked-out branch and the existing Git credential setup.
    It never switches branches or hard-codes a GitHub account or author identity.
#>

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$GitArgs)
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed with exit code $LASTEXITCODE."
    }
}

function Stop-WithMessage {
    param([string]$Message)
    Write-Host "`nERROR: $Message" -ForegroundColor Red
    Write-Host 'If GitHub authentication failed, reconnect GitHub in your Git client.' -ForegroundColor Yellow
    Read-Host 'Press Enter to close'
    exit 1
}

try {
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
        throw 'Could not determine the current branch. Check out a branch before running this script.'
    }

    Write-Host '==========================================================' -ForegroundColor Cyan
    Write-Host '  Vault Exporter — Git sync' -ForegroundColor Cyan
    Write-Host "  Current branch: $branch" -ForegroundColor Cyan
    Write-Host '==========================================================' -ForegroundColor Cyan

    $status = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'Could not read Git status.' }

    if ($status.Count -gt 0) {
        Write-Host "`nLocal changes:" -ForegroundColor Yellow
        & git status --short

        $runCheck = Read-Host "Run 'npm run check' before committing? (Y/n; default Y)"
        if ($runCheck -notin @('n', 'N')) {
            & npm run check
            if ($LASTEXITCODE -ne 0) { throw "'npm run check' failed with exit code $LASTEXITCODE." }
        }

        Invoke-Git -GitArgs @('add', '-A')
        & git diff --cached --quiet
        $diffExitCode = $LASTEXITCODE
        if ($diffExitCode -eq 1) {
            $defaultMessage = 'update: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
            $message = Read-Host "Commit message (leave blank for '$defaultMessage')"
            if ([string]::IsNullOrWhiteSpace($message)) { $message = $defaultMessage }
            Invoke-Git -GitArgs @('commit', '-m', $message)
        } elseif ($diffExitCode -ne 0) {
            throw 'Could not inspect staged changes.'
        } else {
            Write-Host '[OK] No staged changes to commit.' -ForegroundColor Green
        }
    } else {
        Write-Host '[OK] Working tree is clean.' -ForegroundColor Green
    }

    Write-Host "`nChecking origin/$branch..." -ForegroundColor Yellow
    & git ls-remote --exit-code --heads origin $branch *> $null
    $remoteCheck = $LASTEXITCODE
    if ($remoteCheck -eq 0) {
        Invoke-Git -GitArgs @('pull', '--rebase', 'origin', $branch)
    } elseif ($remoteCheck -eq 2) {
        Write-Host "[INFO] origin/$branch does not exist yet; it will be created on push." -ForegroundColor DarkYellow
    } else {
        throw "Could not check origin/$branch (git exit code $remoteCheck)."
    }

    Invoke-Git -GitArgs @('push', '--set-upstream', 'origin', $branch)
    Write-Host "`n[OK] Pushed successfully to origin/$branch." -ForegroundColor Green
    Read-Host 'Press Enter to close'
} catch {
    Stop-WithMessage $_.Exception.Message
}

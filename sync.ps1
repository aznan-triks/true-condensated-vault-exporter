#Requires -Version 5.1
<#
.SYNOPSIS
    Script de synchronisation Git avec GitHub pour true-condensated-vault-exporter.
.DESCRIPTION
    1. Bascule l'authentification GitHub CLI sur le compte aznan-triks.
    2. Recupere les modifications distantes (git pull --rebase).
    3. Verifie l'integrite du projet si demande (npm run check).
    4. Ajoute, commite et pousse les modifications locales vers origin/main.
#>

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Se positionner dans le repertoire du script
Set-Location $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Synchronisation Git - true-condensated-vault-exporter" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Bascule GitHub CLI vers aznan-triks
$targetUser = "aznan-triks"
Write-Host "[1/5] Bascule du compte GitHub vers '$targetUser'..." -ForegroundColor Yellow

$ghInstalled = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghInstalled) {
    Write-Host "[ATTENTION] GitHub CLI (gh) n'a pas ete trouve dans le PATH." -ForegroundColor DarkYellow
} else {
    try {
        & gh auth switch --hostname github.com --user $targetUser
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Compte GitHub actif : $targetUser" -ForegroundColor Green
        } else {
            Write-Host "[ATTENTION] 'gh auth switch' a retourne le code $LASTEXITCODE" -ForegroundColor DarkYellow
        }
    } catch {
        Write-Host "[ATTENTION] Erreur lors de l'appel a gh auth switch : $_" -ForegroundColor DarkYellow
    }
}

# 2. Verification de l'auteur Git local
$currentGitEmail = (& git config user.email)
if ($currentGitEmail -ne "268495225+aznan-triks@users.noreply.github.com") {
    & git config user.name "A.T 3&0"
    & git config user.email "268495225+aznan-triks@users.noreply.github.com"
    Write-Host "[OK] Auteur Git local configure sur 'A.T 3&0' (aznan-triks)." -ForegroundColor Green
}

# 3. Synchronisation avec le depot distant
Write-Host ""
Write-Host "[2/5] Recuperation des nouveautes distantes (git pull --rebase)..." -ForegroundColor Yellow
try {
    & git pull --rebase origin main
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Depot local synchronise avec origin/main." -ForegroundColor Green
    }
} catch {
    Write-Host "[ATTENTION] Le pull/rebase a signale une anomalie : $_" -ForegroundColor DarkYellow
}

# 4. Detection des changements locaux
Write-Host ""
Write-Host "[3/5] Verification des modifications locales..." -ForegroundColor Yellow
$status = (& git status --porcelain)

if (-not $status) {
    Write-Host "[OK] Aucun changement local a commiter. Tout est a jour !" -ForegroundColor Green
} else {
    Write-Host "Modifications detectees :" -ForegroundColor Cyan
    & git status -s
    Write-Host ""

    $runCheck = Read-Host "Executer 'npm run check' avant d'envoyer ? (O/n, defaut: O)"
    if ($runCheck -ne "n" -and $runCheck -ne "N") {
        Write-Host "Execution des verifications (npm run check)..." -ForegroundColor Yellow
        & npm run check
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERREUR] Les tests ou le build ont echoue. Envoi annule." -ForegroundColor Red
            Write-Host ""
            Read-Host "Appuyez sur Entree pour quitter..."
            exit 1
        }
        Write-Host "[OK] Verifications reussies !" -ForegroundColor Green
    }

    $defaultMsg = "update: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
    $commitMsg = Read-Host "Message de commit (laisser vide pour '$defaultMsg')"
    if ([string]::IsNullOrWhiteSpace($commitMsg)) {
        $commitMsg = $defaultMsg
    }

    Write-Host ""
    Write-Host "[4/5] Ajout et commit des modifications..." -ForegroundColor Yellow
    & git add -A
    & git commit -m "$commitMsg"
    Write-Host "[OK] Commit cree : $commitMsg" -ForegroundColor Green
}

# 5. Push vers GitHub
Write-Host ""
Write-Host "[5/5] Envoi vers GitHub (origin/main)..." -ForegroundColor Yellow
& git push origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  SYNCHRONISATION REUSSIE AVEC SUCCES !" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[ERREUR] Erreur lors de l'envoi (push) vers GitHub." -ForegroundColor Red
}

Write-Host ""
Read-Host "Appuyez sur Entree pour fermer cette fenetre..."
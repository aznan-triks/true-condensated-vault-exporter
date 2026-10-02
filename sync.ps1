#Requires -Version 5.1
<#
.SYNOPSIS
    Script de synchronisation Git avec GitHub pour true-condensated-vault-exporter.
.DESCRIPTION
    1. Bascule l'authentification GitHub CLI sur le compte requis (aznan-triks).
    2. Récupère les modifications distantes (git pull --rebase).
    3. Optionnellement vérifie l'intégrité (npm run check).
    4. Ajoute, commite et pousse les modifications locales vers origin/main.
#>

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Se positionner dans le dossier du script
Set-Location $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Synchronisation Git — true-condensated-vault-exporter" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Bascule GitHub CLI vers aznan-triks
$targetUser = "aznan-triks"
Write-Host "[1/5] Vérification et bascule du compte GitHub vers '$targetUser'..." -ForegroundColor Yellow

$ghInstalled = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghInstalled) {
    Write-Host "⚠️ 'gh' (GitHub CLI) n'est pas trouvé dans le PATH. Poursuite avec l'authentification Git standard..." -ForegroundColor DarkYellow
} else {
    try {
        & gh auth switch --hostname github.com --user $targetUser 2>&1 | Out-Null
        Write-Host "✓ Compte GitHub actif défini sur '$targetUser'." -ForegroundColor Green
    } catch {
        Write-Host "⚠️ Impossible de basculer automatiquement via 'gh auth switch' : $_" -ForegroundColor DarkYellow
    }
}

# 2. Vérification de la configuration de l'auteur Git local
$currentGitUser = (& git config user.name)
$currentGitEmail = (& git config user.email)
if ($currentGitEmail -ne "268495225+aznan-triks@users.noreply.github.com") {
    & git config user.name "A.T 3&0"
    & git config user.email "268495225+aznan-triks@users.noreply.github.com"
    Write-Host "✓ Auteur Git local configuré sur 'A.T 3&0' (aznan-triks)." -ForegroundColor Green
}

# 3. Synchronisation avec le dépôt distant (fetch & rebase)
Write-Host ""
Write-Host "[2/5] Récupération des nouveautés distantes (pull rebase)..." -ForegroundColor Yellow
try {
    & git pull --rebase origin main
    Write-Host "✓ Dépôt local synchronisé avec origin/main." -ForegroundColor Green
} catch {
    Write-Host "⚠️ Erreur lors du pull/rebase (possible conflit ou absence de branche distante) : $_" -ForegroundColor DarkYellow
}

# 4. Détection des changements locaux
Write-Host ""
Write-Host "[3/5] Examen des modifications locales..." -ForegroundColor Yellow
$status = (& git status --porcelain)

if (-not $status) {
    Write-Host "✓ Aucun changement local à commiter. Tout est à jour !" -ForegroundColor Green
} else {
    Write-Host "Changements détectés :" -ForegroundColor Cyan
    & git status -s
    Write-Host ""

    # Option de contrôle npm
    $runCheck = Read-Host "Exécuter 'npm run check' avant d'envoyer ? (O/n, défaut: O)"
    if ($runCheck -ne "n" -and $runCheck -ne "N") {
        Write-Host "Exécution de 'npm run check'..." -ForegroundColor Yellow
        & npm run check
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Les tests ou le build ont échoué. Annulation de l'envoi." -ForegroundColor Red
            Read-Host "Appuyez sur Entrée pour quitter..."
            exit 1
        }
        Write-Host "✓ Contrôle 'npm run check' réussi !" -ForegroundColor Green
    }

    # Message de commit
    $defaultMsg = "update: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
    $commitMsg = Read-Host "Message de commit (laisser vide pour '$defaultMsg')"
    if ([string]::IsNullOrWhiteSpace($commitMsg)) {
        $commitMsg = $defaultMsg
    }

    Write-Host ""
    Write-Host "[4/5] Ajout et commit des modifications..." -ForegroundColor Yellow
    & git add -A
    & git commit -m "$commitMsg"
    Write-Host "✓ Commit créé avec succès." -ForegroundColor Green
}

# 5. Push vers GitHub
Write-Host ""
Write-Host "[5/5] Envoi vers GitHub (origin/main)..." -ForegroundColor Yellow
& git push origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  ✓ SYNCHRONISATION TERMINÉE AVEC SUCCÈS !" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Erreur lors de l'envoi (push) vers GitHub." -ForegroundColor Red
}

Write-Host ""
Read-Host "Appuyez sur Entrée pour fermer cette fenêtre..."

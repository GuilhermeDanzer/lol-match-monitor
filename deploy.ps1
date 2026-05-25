# Deploy local - Windows (PowerShell)
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "[deploy] Preparando Bot e Site..."

if (-not (Test-Path ".git")) {
    Write-Host "[deploy] ERRO: esta pasta nao e um repositorio Git."
    Write-Host "        Rode na raiz do projeto:"
    Write-Host "          git init"
    Write-Host "          git remote add origin https://github.com/SEU_USUARIO/lol-match-monitor.git"
    Write-Host "          git add ."
    Write-Host "          git commit -m ""Primeiro commit"""
    Write-Host "          git branch -M main"
    Write-Host "          git push -u origin main"
    exit 1
}

$statusOutput = git status -s 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[deploy] ERRO ao executar git status:"
    Write-Host $statusOutput
    exit 1
}

if (-not $statusOutput) {
    Write-Host "[deploy] Nenhuma alteracao detectada. Projeto ja esta atualizado."
    exit 0
}

git add .

$commitMsg = Read-Host "Digite o que mudou (ou Enter para mensagem automatica)"
if ([string]::IsNullOrWhiteSpace($commitMsg)) {
    $commitMsg = "Deploy automatico - $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
}

git commit -m "$commitMsg"

$remotes = git remote 2>&1
if ($LASTEXITCODE -ne 0 -or -not $remotes) {
    Write-Host "[deploy] ERRO: nenhum remote configurado."
    Write-Host "        git remote add origin https://github.com/SEU_USUARIO/lol-match-monitor.git"
    exit 1
}

Write-Host "[deploy] Enviando codigo para o GitHub..."
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "[deploy] ERRO no push. Se for o primeiro envio, tente:"
    Write-Host "        git branch -M main"
    Write-Host "        git push -u origin main"
    exit 1
}

Write-Host "[deploy] Pronto! Vercel (front) e Railway (back) devem iniciar o build."

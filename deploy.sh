#!/bin/bash

set -e

echo "🚀 Preparando para lançar o Bot e o Site..."

# Verifica se há alterações
if [[ -z $(git status -s) ]]; then
  echo "✅ Nenhuma alteração detectada. Seu projeto já está na última versão."
  exit 0
fi

# Adiciona todas as pastas (front e back)
git add .

# Pede uma mensagem de commit. Se der só Enter, usa a data atual.
read -p "📝 Digite o que mudou (ou Enter para mensagem automática): " commit_msg

if [ -z "$commit_msg" ]; then
  commit_msg="Deploy automático - $(date +'%d/%m/%Y %H:%M')"
fi

git commit -m "$commit_msg"

# Empurra para a branch principal
echo "☁️ Enviando código para o GitHub..."
git push origin main

echo "🎉 Pronto! A Vercel (Front) e a Railway (Back) já estão buildando a nova versão."

#!/bin/bash

echo "🚀 Démarrage du Bot WhatsApp Refactorisé"
echo "========================================"

# Vérifier les dépendances
if [ ! -d "node_modules" ]; then
    echo "📦 Installation des dépendances..."
    npm install
fi

# Vérifier le fichier .env
if [ ! -f ".env" ]; then
    echo "⚠️  Fichier .env manquant!"
    echo "Copiez .env.example vers .env et configurez vos clés API"
    exit 1
fi

# Vérifier la clé OpenAI
if ! grep -q "OPENAI_API_KEY=sk-" .env; then
    echo "⚠️  Clé OpenAI non configurée dans .env!"
    exit 1
fi

echo "✅ Configuration vérifiée"
echo ""
echo "📱 Démarrage du serveur..."
echo ""
echo "🌐 Interface disponible sur: http://localhost:3000"
echo ""
echo "📋 Fonctionnalités:"
echo "   • Lancer/Arrêter Puppeteer WhatsApp"
echo "   • Gérer les contacts (activer/désactiver)"
echo "   • Activer/Désactiver auto-reply par contact"
echo "   • Activer/Désactiver auto-correction par contact"
echo "   • Définir un contexte temporaire"
echo "   • Commandes 'paf' toujours actives"
echo ""
echo "⚠️  Note: Le bot ne démarre PAS automatiquement"
echo "   Utilisez l'interface web pour le lancer"
echo ""
echo "Appuyez sur Ctrl+C pour arrêter"
echo "========================================"

# Démarrer le serveur
node src/server-refactored.js
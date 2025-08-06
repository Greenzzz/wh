#!/bin/bash

echo "📊 Statut de l'analyse WhatsApp"
echo "================================"

# Vérifier si le processus tourne
if pgrep -f "analyzer.js" > /dev/null; then
    echo "✅ Analyse en cours..."
    
    # Compter les chunks traités
    PROCESSED=$(grep -c "Traitement chunk" analyzer.log 2>/dev/null || echo 0)
    echo "📦 Chunks traités: $PROCESSED/154"
    
    # Calculer le pourcentage
    PERCENT=$((PROCESSED * 100 / 154))
    echo "📈 Progression: $PERCENT%"
    
    # Estimer le temps restant (2 sec par chunk + traitement)
    REMAINING=$((154 - PROCESSED))
    TIME_LEFT=$((REMAINING * 10))
    echo "⏱️  Temps estimé restant: $((TIME_LEFT / 60)) minutes"
else
    echo "⚠️  L'analyse n'est pas en cours"
    
    # Vérifier si les fichiers de résultats existent
    if [ -f "src/marion_analysis.json" ]; then
        echo "✅ Fichiers de résultats trouvés!"
        echo ""
        echo "📁 Fichiers générés:"
        [ -f "src/marion_analysis.json" ] && echo "  ✓ marion_analysis.json"
        [ -f "src/marion_prompt.txt" ] && echo "  ✓ marion_prompt.txt"
        [ -f "src/analysis_report.md" ] && echo "  ✓ analysis_report.md"
    fi
fi

echo ""
echo "📝 Dernières lignes du log:"
echo "----------------------------"
tail -5 analyzer.log 2>/dev/null || echo "Pas de log disponible"
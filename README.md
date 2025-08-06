# wh

Bot automatique pour messagerie avec intelligence artificielle.

## Fonctionnalités

- 🤖 Réponses automatiques intelligentes par contact
- ✏️ Auto-correction des messages sortants
- 💬 Commandes "paf" pour accès direct à ChatGPT
- 📅 Intégration Google Calendar
- 🎯 Interface web de contrôle

## Installation

```bash
npm install
cp .env.example .env
# Configurer les clés API dans .env
```

## Utilisation

```bash
# Lancer le serveur
npm start

# Ou directement
node src/server-refactored.js
```

Puis ouvrir http://localhost:3000

## Configuration

- Ajouter des contacts via l'interface web
- Format des numéros : `33612345678@c.us`
- Activer/désactiver les fonctionnalités par contact
# Guide du Bot WhatsApp Refactorisé

## 🚀 Démarrage Rapide

```bash
# Installer les dépendances
npm install

# Démarrer le serveur refactorisé
node src/server-refactored.js

# Ou pour tester le bot seul
node test-bot-refactored.js
```

## 📋 Architecture Simplifiée

### 1. **bot-refactored.js** - Le Cœur du Bot
- Gestion claire des messages entrants/sortants
- Séparation des fonctionnalités (paf, auto-reply, auto-correct)
- Logs détaillés pour debug

### 2. **server-refactored.js** - API REST
- Routes simples et claires
- Gestion d'une seule instance du bot
- Synchronisation avec profileManager

### 3. **profileManager.js** - Gestion des Contacts
- Configuration par contact
- Features activables/désactivables
- Master Switch global

## 🔄 Flux des Messages

### Messages ENTRANTS (des contacts vers vous)
```
Message reçu → Vérifier "paf" → Vérifier Master Switch → Vérifier Contact Activé → Auto-Reply
```

### Messages SORTANTS (de vous vers contacts)
```
Message envoyé → Vérifier "paf" → Auto-Correction (si activée pour le contact)
```

## 🎯 Fonctionnalités

### 1. Commande "paf" - ChatGPT Direct
- **Utilisation**: `paf quelle est la météo aujourd'hui?`
- **Accès**: Google Calendar + Web Search
- **Fonctionne**: Pour TOUS les contacts, même désactivés

### 2. Auto-Reply - Réponses Automatiques
- **Activation**: Par contact dans l'interface
- **Contrôle**: Master Switch + Contact enabled + autoReply
- **Personnalisation**: Prompt par contact

### 3. Auto-Correction - Correction des Fautes
- **Activation**: Par contact ou global
- **Intelligent**: Garde le style SMS, corrige vraies fautes
- **Exclusions**: Messages "paf", réponses bot

## 🛠️ Configuration

### Format du Numéro WhatsApp
```
Format: [code_pays][numéro]@c.us
Exemple FR: 33612345678@c.us
Exemple US: 15551234567@c.us
```

### Structure Contact
```json
{
  "marie": {
    "enabled": true,
    "phoneNumber": "33612345678@c.us",
    "name": "Marie",
    "relationship": "girlfriend",
    "features": {
      "autoReply": true,
      "autoCorrect": true,
      "useGPT": true
    }
  }
}
```

## 🐛 Debug et Logs

### Logs Importants
- `[INCOMING]` - Message entrant traité
- `[OUTGOING]` - Message sortant traité
- `[PAF]` - Commande paf détectée
- `[AUTO-REPLY]` - Génération réponse auto
- `[AUTO-CORRECT]` - Correction appliquée
- `[SKIP]` - Message ignoré (avec raison)

### Problèmes Courants

**Bot ne répond pas**
1. Vérifier Master Switch activé
2. Vérifier contact enabled
3. Vérifier autoReply activé
4. Regarder les logs [SKIP]

**Auto-correction ne marche pas**
1. Vérifier autoCorrect du contact
2. Message ne doit pas commencer par "paf"
3. Message > 5 caractères

**"paf" ne fonctionne pas**
1. Vérifier clé OpenAI
2. Format: `paf [question]`
3. Regarder logs [PAF]

## 📱 Interface Web

### Page Principale (/)
- **Start/Stop Service**: Démarre/arrête Puppeteer
- **Enable/Pause Assistant**: Active/désactive les réponses
- **Smart Correction**: Toggle global auto-correction
- **Current Context**: Définir contexte temporaire

### Page Contacts (/contacts)
- **Add Contact**: Format WhatsApp obligatoire
- **Toggle Contact**: Activer/désactiver par contact
- **Features**: AR (AutoReply), SC (SmartCorrect), AI (GPT)
- **Settings**: Configuration avancée par contact

## 🔧 API Endpoints

### Contrôle du Bot
- `POST /api/bot/start` - Démarrer le bot
- `POST /api/bot/stop` - Arrêter le bot
- `POST /api/bot/restart` - Redémarrer
- `GET /api/status` - Status complet

### Comportement
- `POST /api/control` - Pause/Resume
- `POST /api/autocorrect` - Toggle correction
- `POST /api/context` - Définir contexte
- `DELETE /api/context` - Effacer contexte

### Contacts
- `GET /api/contacts` - Liste contacts
- `POST /api/contacts` - Ajouter contact
- `POST /api/contacts/:id/toggle` - Activer/désactiver
- `POST /api/contacts/:id/features` - Modifier features

## ✨ Améliorations vs Code Original

1. **Séparation Claire**: Messages entrants vs sortants
2. **Logs Détaillés**: Comprendre pourquoi un message est ignoré
3. **Pas de Boucles**: ProcessedMessages évite doublons
4. **État Simplifié**: Une source de vérité pour l'état
5. **Configuration Live**: Plus besoin de redémarrer
6. **Validation**: Numéros WhatsApp validés

## 🚨 Important

- **Master Switch OFF** = Bot complètement désactivé
- **Contact disabled** = Pas de réponse auto (paf fonctionne toujours)
- **autoReply OFF** = Pas de réponse auto pour ce contact
- **autoCorrect OFF** = Pas de correction pour ce contact

Le bot respecte cette hiérarchie de contrôle pour éviter les comportements non désirés.
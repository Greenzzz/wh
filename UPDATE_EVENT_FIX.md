# Fix: Déplacement d'événements Google Calendar

## Problème
Le bot disait déplacer les événements mais ne le faisait pas réellement.

## Solution Implémentée

### 1. Nouvelle action `update_event` dans Google Calendar Tool
- **Fichier**: `google-calendar-tool.js`
- **Fonction**: `updateEvent()` (lignes 301-419)
- **Capacités**:
  - Recherche l'événement par titre et date
  - Peut identifier l'événement par l'ancienne heure si plusieurs ont le même nom
  - Déplace l'événement à la nouvelle heure/date
  - Conserve les participants et autres détails

### 2. Paramètres pour update_event
- `title`: Nom de l'événement à déplacer
- `date`: Date actuelle de l'événement
- `newTime`: Nouvelle heure (format HH:MM)
- `oldTime`: (optionnel) Ancienne heure si ambiguïté
- `newDate`: (optionnel) Nouvelle date si changement de jour
- `duration`: (optionnel) Nouvelle durée
- `attendees`: (optionnel) Modifier les participants

### 3. Prompt système amélioré
Instructions explicites pour GPT-4.1 :
- "décaler/déplacer/changer l'heure" → action: "update_event"
- "ajouter/créer" → action: "create_event"
- "supprimer/annuler" → action: "delete_event"
- "voir/lister" → action: "list_events"

## Commandes Testables

### Créer un événement
```
paf ajoute un meeting avec Vincent à 19h
```

### Déplacer un événement
```
paf décale le meeting avec Vincent de 19h à 16h
```
ou
```
paf déplace le rdv avec Vincent à 16h
```

### Changer de jour
```
paf reporte le meeting avec Vincent à demain 14h
```

### Supprimer un événement
```
paf annule le meeting avec Vincent
```

## Tests Effectués
✅ Création d'événement test
✅ Déplacement de 14h à 16h
✅ Vérification du changement
✅ Suppression de l'événement

## État Actuel
- ✅ La fonction `update_event` est opérationnelle
- ✅ GPT-4.1 comprend les demandes de déplacement
- ✅ Les événements sont correctement mis à jour dans Google Calendar
- ✅ Les participants et détails sont conservés lors du déplacement

## Pour le Debug
Si un déplacement ne fonctionne pas, vérifier dans les logs :
- `[CALENDAR] Recherche de l'événement...` : L'événement est-il trouvé ?
- `[CALENDAR] Événement trouvé: ... (ID: ...)` : Le bon événement est identifié ?
- Message de confirmation ou d'erreur final
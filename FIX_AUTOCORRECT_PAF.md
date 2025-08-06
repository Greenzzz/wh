# Fix Auto-Correction des Réponses "paf"

## Problème
Les réponses de ChatGPT aux commandes "paf" étaient incorrectement corrigées par le système d'auto-correction, changeant par exemple la date correcte en une autre date.

## Solution Implémentée

### 1. Système de Marquage des Réponses
- Ajout d'un `Set` nommé `pafResponses` pour tracker les IDs des réponses ChatGPT
- Quand ChatGPT répond à une commande "paf", l'ID de la réponse est ajouté au Set
- Gestion de plusieurs formats d'ID possibles (id, _serialized)

### 2. Logique d'Auto-Correction Améliorée
Quand un message sortant est détecté, le système :
1. Vérifie si le message commence par "paf" → pas de correction
2. Vérifie si l'ID du message est dans `pafResponses` → pas de correction  
3. Sinon → correction normale si activée

### 3. Logging Amélioré
- Affichage des IDs de messages pour debug
- Affichage des IDs marqués dans le Set
- Comparaison des différents formats d'ID

## Code Modifié

### Marquage des réponses (ligne ~835)
```javascript
const responseMsg = await msg.reply(gptResponse);
if (responseMsg && responseMsg.id) {
    const msgId = responseMsg.id.id || responseMsg.id._serialized || responseMsg.id;
    pafResponses.add(msgId);
    console.log(`[GPT] Réponse "paf" marquée: ${msgId}`);
}
```

### Vérification auto-correction (ligne ~692)
```javascript
} else if (pafResponses.size > 0) {
    const possibleIds = [
        msg.id?.id,
        msg.id?._serialized,
        msg.id
    ].filter(id => id);
    
    const foundId = possibleIds.find(id => pafResponses.has(id));
    if (foundId) {
        console.log(`[AUTO-CORRECT] Message est une réponse ChatGPT - pas de correction`);
        pafResponses.delete(foundId);
        return; // Empêcher toute correction
    }
}
```

## Tests
1. Envoyer `paf on est quel jour ?`
2. ChatGPT répond avec la date correcte
3. Cette réponse NE DOIT PAS être corrigée
4. Les messages normaux doivent toujours être corrigés

## Debugging
Si le problème persiste, vérifier dans les logs :
- L'ID marqué lors de la réponse : `[GPT] Réponse "paf" marquée: XXX`
- L'ID vérifié lors de l'auto-correction : `[AUTO-CORRECT] Vérification IDs possibles: [XXX]`
- Les IDs doivent correspondre pour éviter la correction
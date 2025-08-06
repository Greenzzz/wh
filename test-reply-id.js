#!/usr/bin/env node

// Script de test pour vérifier le comportement des reply IDs

console.log('Test du système de marquage des réponses "paf"');
console.log('=' . repeat(50));

// Simuler un Set pour les réponses
const pafResponses = new Set();

// Simuler l'ajout d'une réponse
function simulateReply(msgId) {
    console.log(`\n📤 Envoi d'une réponse avec ID: ${msgId}`);
    
    if (msgId) {
        pafResponses.add(msgId);
        console.log(`✅ Réponse marquée comme "paf": ${msgId}`);
        console.log(`📊 Total de réponses marquées: ${pafResponses.size}`);
    } else {
        console.log('❌ Pas d\'ID de message disponible');
    }
}

// Simuler la vérification d'auto-correction
function checkAutoCorrect(msgId) {
    console.log(`\n🔍 Vérification auto-correction pour ID: ${msgId}`);
    
    if (pafResponses.has(msgId)) {
        console.log('✅ Message détecté comme réponse "paf" - PAS de correction');
        pafResponses.delete(msgId);
        console.log(`🗑️ ID supprimé du Set. Taille restante: ${pafResponses.size}`);
        return false; // Pas de correction
    } else {
        console.log('⚠️ Message non marqué - correction possible');
        return true; // Correction possible
    }
}

// Tests
console.log('\n📝 Test 1: Réponse normale à "paf"');
simulateReply('msg_123456');
checkAutoCorrect('msg_123456');

console.log('\n📝 Test 2: Message non marqué');
checkAutoCorrect('msg_999999');

console.log('\n📝 Test 3: Réponses multiples');
simulateReply('msg_aaa');
simulateReply('msg_bbb');
simulateReply('msg_ccc');
console.log(`\n📊 Réponses en attente: ${Array.from(pafResponses).join(', ')}`);

console.log('\n✅ Tests terminés');
console.log('=' . repeat(50));
console.log(`
⚠️ Note importante:
Si le bot corrige quand même les réponses "paf", vérifier:
1. Que msg.reply() retourne bien un objet avec un ID
2. Que l'ID utilisé dans message_create est le même
3. Que le timing entre reply et message_create est correct
`);
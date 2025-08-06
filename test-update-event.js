#!/usr/bin/env node

import { executeCalendarAction } from './google-calendar-tool.js';
import dotenv from 'dotenv';

dotenv.config();

async function testUpdateEvent() {
    console.log('🧪 Test de déplacement d\'événement Google Calendar\n');
    console.log('=' . repeat(50));
    
    const today = new Date().toISOString().split('T')[0];
    
    // Test 1: Lister les événements d'aujourd'hui
    console.log('\n📋 Étape 1: Lister les événements du jour');
    try {
        const listResult = await executeCalendarAction({
            action: 'list_events',
            date: today
        });
        console.log(listResult);
    } catch (error) {
        console.error('❌ Erreur liste:', error.message);
    }
    
    // Test 2: Créer un événement test
    console.log('\n➕ Étape 2: Créer un événement test à 14h');
    try {
        const createResult = await executeCalendarAction({
            action: 'create_event',
            title: 'Test Meeting pour déplacement',
            date: today,
            time: '14:00',
            duration: 60,
            description: 'Événement de test pour vérifier le déplacement'
        });
        console.log(createResult);
    } catch (error) {
        console.error('❌ Erreur création:', error.message);
    }
    
    // Attendre un peu
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 3: Déplacer l'événement
    console.log('\n🔄 Étape 3: Déplacer l\'événement de 14h à 16h');
    try {
        const updateResult = await executeCalendarAction({
            action: 'update_event',
            title: 'Test Meeting pour déplacement',
            date: today,
            oldTime: '14:00',
            newTime: '16:00'
        });
        console.log(updateResult);
    } catch (error) {
        console.error('❌ Erreur déplacement:', error.message);
    }
    
    // Test 4: Vérifier le déplacement
    console.log('\n✅ Étape 4: Vérifier le déplacement');
    try {
        const verifyResult = await executeCalendarAction({
            action: 'list_events',
            date: today
        });
        console.log(verifyResult);
    } catch (error) {
        console.error('❌ Erreur vérification:', error.message);
    }
    
    // Test 5: Nettoyer - supprimer l'événement test
    console.log('\n🗑️ Étape 5: Supprimer l\'événement test');
    try {
        const deleteResult = await executeCalendarAction({
            action: 'delete_event',
            title: 'Test Meeting pour déplacement',
            date: today
        });
        console.log(deleteResult);
    } catch (error) {
        console.error('❌ Erreur suppression:', error.message);
    }
    
    console.log('\n' + '=' . repeat(50));
    console.log('✅ Test terminé !');
    console.log('\n💡 Pour tester avec le bot:');
    console.log('1. Créer un meeting: "paf ajoute un rdv avec Vincent à 19h"');
    console.log('2. Le déplacer: "paf décale le rdv avec Vincent de 19h à 16h"');
}

testUpdateEvent().catch(console.error);
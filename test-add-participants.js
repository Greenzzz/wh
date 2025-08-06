#!/usr/bin/env node

import { executeCalendarAction } from './google-calendar-tool.js';
import dotenv from 'dotenv';

dotenv.config();

async function testAddParticipants() {
    console.log('🧪 Test d\'ajout de participants à un événement\n');
    console.log('=' . repeat(50));
    
    const today = new Date().toISOString().split('T')[0];
    
    // Étape 1: Créer un événement test sans participants
    console.log('\n➕ Étape 1: Créer un événement test à 15h SANS participants');
    try {
        const createResult = await executeCalendarAction({
            action: 'create_event',
            title: 'Meeting Test Participants',
            date: today,
            time: '15:00',
            duration: 60,
            description: 'Test pour ajout de participants'
        });
        console.log(createResult);
    } catch (error) {
        console.error('❌ Erreur création:', error.message);
    }
    
    // Attendre un peu
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Étape 2: Ajouter des participants
    console.log('\n👥 Étape 2: Ajouter Vincent et Marion comme participants');
    try {
        const updateResult = await executeCalendarAction({
            action: 'update_event',
            title: 'Meeting Test Participants',
            date: today,
            attendees: ['Vincent Aurez', 'Marion']
        });
        console.log(updateResult);
    } catch (error) {
        console.error('❌ Erreur ajout participants:', error.message);
    }
    
    // Étape 3: Modifier les participants ET l'heure
    console.log('\n🔄 Étape 3: Déplacer à 17h ET ajouter JB');
    try {
        const updateResult2 = await executeCalendarAction({
            action: 'update_event',
            title: 'Meeting Test Participants',
            date: today,
            oldTime: '15:00',
            newTime: '17:00',
            attendees: ['Vincent Aurez', 'Marion', 'JB']
        });
        console.log(updateResult2);
    } catch (error) {
        console.error('❌ Erreur modification:', error.message);
    }
    
    // Étape 4: Nettoyer
    console.log('\n🗑️ Étape 4: Supprimer l\'événement test');
    try {
        const deleteResult = await executeCalendarAction({
            action: 'delete_event',
            title: 'Meeting Test Participants',
            date: today
        });
        console.log(deleteResult);
    } catch (error) {
        console.error('❌ Erreur suppression:', error.message);
    }
    
    console.log('\n' + '=' . repeat(50));
    console.log('✅ Test terminé !');
    console.log('\n💡 Exemples de commandes pour le bot:');
    console.log('• "paf ajoute Marion au meeting de 19h avec Vincent"');
    console.log('• "paf mets JB et Paul dans le rdv de demain"');
    console.log('• "paf ajoute Vincent Aurez comme participant au meeting de 14h"');
}

testAddParticipants().catch(console.error);
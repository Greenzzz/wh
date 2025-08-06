import { executeCalendarAction } from './google-calendar-tool.js';
import dotenv from 'dotenv';

dotenv.config();

async function testContactAttribution() {
    console.log('🧪 Test d\'attribution de contacts\n');
    
    // Test 1: Créer un événement avec des participants par nom
    console.log('Test 1: Création d\'événement avec participants par nom');
    console.log('Commande: "paf créer un rdv avec Vincent Aurez demain à 14h"');
    
    const result1 = await executeCalendarAction({
        action: 'create_event',
        title: 'Test RDV avec Vincent',
        date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Demain
        time: '14:00',
        duration: 60,
        attendees: ['Vincent Aurez']
    });
    console.log('Résultat:', result1);
    console.log('---\n');
    
    // Test 2: Mettre à jour un événement en ajoutant des participants
    console.log('Test 2: Mise à jour d\'événement avec ajout de participants');
    console.log('Commande: "paf ajouter Marion et JB au rdv de demain"');
    
    const result2 = await executeCalendarAction({
        action: 'update_event',
        title: 'Test RDV avec Vincent',
        date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        attendees: ['Vincent Aurez', 'Marion', 'JB']
    });
    console.log('Résultat:', result2);
    console.log('---\n');
    
    // Test 3: Créer un événement avec plusieurs participants
    console.log('Test 3: Création d\'événement avec plusieurs participants');
    console.log('Commande: "paf meeting avec Nicolas Jouve et Vincent demain à 16h"');
    
    const result3 = await executeCalendarAction({
        action: 'create_event',
        title: 'Meeting équipe',
        date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        time: '16:00',
        duration: 90,
        attendees: ['Nicolas Jouve', 'Vincent']
    });
    console.log('Résultat:', result3);
    console.log('---\n');
    
    console.log('✅ Tests terminés');
}

// Lancer les tests
testContactAttribution().catch(console.error);
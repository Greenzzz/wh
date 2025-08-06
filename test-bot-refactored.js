import WhatsAppBot from './src/bot-refactored.js';
import profileManager from './src/profileManager.js';

console.log('🧪 Test du bot refactorisé\n');

async function testBot() {
    // Charger la configuration
    console.log('📋 Chargement de la configuration...');
    await profileManager.loadConfig();
    console.log(`✅ ${Object.keys(profileManager.config.contacts).length} contacts chargés`);
    
    // Afficher les contacts
    console.log('\n👥 Contacts configurés:');
    for (const [id, contact] of Object.entries(profileManager.config.contacts)) {
        console.log(`   - ${contact.name} (${id})`);
        console.log(`     📱 ${contact.phoneNumber}`);
        console.log(`     ✅ Activé: ${contact.enabled}`);
        console.log(`     🤖 Auto-reply: ${contact.features.autoReply}`);
        console.log(`     ✏️ Auto-correct: ${contact.features.autoCorrect}`);
        console.log('');
    }
    
    // Créer le bot
    console.log('🤖 Création du bot...');
    const bot = new WhatsAppBot();
    
    // Tester les méthodes
    console.log('\n🔧 Test des méthodes:');
    
    // Status
    const status = await bot.getStatus();
    console.log('📊 Status initial:', status);
    
    // Contexte temporaire
    await bot.setTemporaryContext('En réunion importante');
    console.log('✅ Contexte défini');
    
    // Auto-correction
    await bot.toggleAutoCorrect(false);
    console.log('✅ Auto-correction désactivée');
    
    // Pause/Resume
    await bot.pause();
    console.log('✅ Bot en pause');
    await bot.resume();
    console.log('✅ Bot repris');
    
    // Status final
    const finalStatus = await bot.getStatus();
    console.log('\n📊 Status final:', finalStatus);
    
    console.log('\n✅ Tous les tests passés!');
}

// Exécuter les tests
testBot().catch(error => {
    console.error('❌ Erreur lors des tests:', error);
    process.exit(1);
});
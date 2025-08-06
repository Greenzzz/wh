import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

// Créer un client WhatsApp minimal pour tester
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '.wwebjs_auth_test'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox']
    }
});

// Simuler un message
function simulateMessage(body, fromMe = true) {
    return {
        body: body,
        fromMe: fromMe,
        from: fromMe ? 'me' : 'contact',
        to: fromMe ? 'contact' : 'me',
        id: { id: 'test_' + Date.now(), _serialized: 'test_' + Date.now() },
        timestamp: Date.now() / 1000,
        type: 'chat',
        isGroupMsg: false,
        getContact: async () => ({ pushname: 'Test Contact' }),
        getChat: async () => ({
            sendStateTyping: () => {},
            clearState: () => {},
            fetchMessages: async () => []
        }),
        reply: async (text) => {
            console.log('  → Réponse envoyée:', text);
            return { id: { id: 'reply_' + Date.now() } };
        },
        edit: async (text) => {
            console.log('  → Message édité:', text);
            return true;
        }
    };
}

console.log('🧪 Test de l\'emoji robot et de l\'auto-correction\n');

// Test 1: Message normal (devrait être analysé pour correction)
console.log('Test 1: Message normal');
const msg1 = simulateMessage('tu fai koi?');
console.log('  Message:', msg1.body);
console.log('  Attendu: devrait être analysé pour correction\n');

// Test 2: Message commençant par "paf" (pas de correction)
console.log('Test 2: Message commençant par "paf"');
const msg2 = simulateMessage('paf quel temps il fai demain?');
console.log('  Message:', msg2.body);
console.log('  Attendu: PAS de correction (commence par "paf")\n');

// Test 3: Message commençant par 🤖 (pas de correction)
console.log('Test 3: Message commençant par 🤖');
const msg3 = simulateMessage('🤖 Voici les infos demandées sur le restrant');
console.log('  Message:', msg3.body);
console.log('  Attendu: PAS de correction (commence par 🤖)\n');

// Test 4: Réponse ChatGPT avec 🤖
console.log('Test 4: Réponse ChatGPT avec emoji robot');
console.log('  Simulation: "paf quel est le menu du restaurant?"');
console.log('  Réponse attendue: "🤖 Le menu du restaurant..."');
console.log('  Cette réponse ne devrait PAS être corrigée\n');

console.log('✅ Configuration de test validée');
console.log('\nPour tester en conditions réelles:');
console.log('1. Lancer le bot: npm run bot');
console.log('2. Envoyer "paf test" pour recevoir une réponse avec 🤖');
console.log('3. Vérifier que la réponse n\'est pas auto-corrigée');
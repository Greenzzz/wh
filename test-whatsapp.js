import pkg from 'whatsapp-web.js';
const { Client } = pkg;
import qrcode from 'qrcode-terminal';

console.log('Test WhatsApp Web JS...');

const client = new Client({
    puppeteer: {
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('QR reçu !');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client prêt !');
});

client.on('authenticated', () => {
    console.log('Authentifié !');
});

client.on('auth_failure', msg => {
    console.error('Erreur auth:', msg);
});

console.log('Initialisation du client...');
client.initialize().then(() => {
    console.log('Initialize appelé');
}).catch(error => {
    console.error('Erreur initialize:', error);
});
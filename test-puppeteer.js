import puppeteer from 'puppeteer';

console.log('Test de Puppeteer...');

try {
    console.log('Lancement du navigateur...');
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    console.log('Navigateur lancé !');
    
    const page = await browser.newPage();
    console.log('Nouvelle page créée');
    
    await page.goto('https://web.whatsapp.com');
    console.log('Navigation vers WhatsApp Web réussie');
    
    // Attendre 5 secondes
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    await browser.close();
    console.log('Test terminé avec succès !');
} catch (error) {
    console.error('Erreur:', error);
}
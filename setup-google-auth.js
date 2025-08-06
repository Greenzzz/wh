#!/usr/bin/env node

import { google } from 'googleapis';
import express from 'express';
import open from 'open';
import readline from 'readline';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

console.log('🔐 Configuration de l\'authentification Google Calendar\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function setup() {
    console.log('📝 Instructions pour obtenir les identifiants Google:\n');
    console.log('1. Allez sur https://console.cloud.google.com/');
    console.log('2. Créez un nouveau projet (ou sélectionnez-en un existant)');
    console.log('3. Dans le menu, allez dans "APIs & Services" > "Credentials"');
    console.log('4. Cliquez sur "+ CREATE CREDENTIALS" > "OAuth client ID"');
    console.log('5. Type d\'application: "Web application"');
    console.log('6. Nom: "WhatsApp Bot Calendar"');
    console.log('7. Authorized redirect URIs: http://localhost:3333/callback');
    console.log('8. Cliquez sur "CREATE"\n');
    
    console.log('Vous obtiendrez un Client ID et un Client Secret.\n');
    
    const clientId = await question('Collez votre Client ID: ');
    const clientSecret = await question('Collez votre Client Secret: ');
    
    const oauth2Client = new google.auth.OAuth2(
        clientId.trim(),
        clientSecret.trim(),
        'http://localhost:3333/callback'
    );
    
    // Générer l'URL d'autorisation
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events'
        ],
        prompt: 'consent' // Force le refresh token
    });
    
    console.log('\n🌐 Ouverture du navigateur pour l\'autorisation...');
    
    // Créer un serveur Express temporaire pour recevoir le callback
    const app = express();
    let server;
    
    const tokenPromise = new Promise((resolve, reject) => {
        app.get('/callback', async (req, res) => {
            const code = req.query.code;
            
            if (!code) {
                res.send('❌ Erreur: Pas de code d\'autorisation reçu');
                reject(new Error('No authorization code'));
                return;
            }
            
            try {
                const { tokens } = await oauth2Client.getToken(code);
                
                res.send(`
                    <html>
                        <body style="font-family: Arial; padding: 50px; text-align: center;">
                            <h1>✅ Autorisation réussie!</h1>
                            <p>Vous pouvez fermer cette fenêtre et retourner au terminal.</p>
                        </body>
                    </html>
                `);
                
                resolve(tokens);
            } catch (error) {
                res.send('❌ Erreur lors de l\'obtention du token');
                reject(error);
            }
        });
        
        server = app.listen(3333, () => {
            console.log('📡 Serveur temporaire démarré sur http://localhost:3333');
            open(authUrl);
        });
    });
    
    try {
        const tokens = await tokenPromise;
        
        console.log('\n✅ Tokens obtenus avec succès!\n');
        
        // Mettre à jour le fichier .env
        let envContent = '';
        try {
            envContent = await fs.readFile('.env', 'utf-8');
        } catch (e) {
            console.log('📝 Création du fichier .env...');
        }
        
        // Remplacer ou ajouter les variables
        const updateEnvVar = (name, value) => {
            const regex = new RegExp(`^${name}=.*$`, 'm');
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${name}=${value}`);
            } else {
                envContent += `\n${name}=${value}`;
            }
        };
        
        updateEnvVar('GOOGLE_CLIENT_ID', clientId.trim());
        updateEnvVar('GOOGLE_CLIENT_SECRET', clientSecret.trim());
        updateEnvVar('GOOGLE_REDIRECT_URI', 'http://localhost:3333/callback');
        updateEnvVar('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
        
        await fs.writeFile('.env', envContent.trim() + '\n');
        
        console.log('📁 Fichier .env mis à jour avec les identifiants Google');
        console.log('\n🎉 Configuration terminée! Votre bot peut maintenant accéder à Google Calendar.');
        console.log('\n📅 Exemples de commandes:');
        console.log('  - "paf montre mon agenda de demain"');
        console.log('  - "paf ajoute un rdv avec Paul demain à 15h"');
        console.log('  - "paf suis-je libre vendredi matin?"');
        
    } catch (error) {
        console.error('\n❌ Erreur:', error.message);
    } finally {
        server?.close();
        rl.close();
        process.exit();
    }
}

setup().catch(console.error);
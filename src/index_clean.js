import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Import du contexte
import context from '../context.json' assert { type: 'json' };

// Charger l'état du bot
const STATE_FILE = path.join(__dirname, 'bot_state.json');
let botPaused = false;
let autoCorrectEnabled = true;
let lastSentMessage = null;

async function loadBotState() {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf-8');
        const state = JSON.parse(data);
        botPaused = state.botPaused || false;
        autoCorrectEnabled = state.autoCorrectEnabled !== undefined ? state.autoCorrectEnabled : true;
        console.log(`État chargé: Bot ${botPaused ? 'en pause' : 'actif'}, Auto-correction ${autoCorrectEnabled ? 'activée' : 'désactivée'}`);
    } catch (error) {
        console.log('Pas d\'état précédent trouvé, utilisation des valeurs par défaut');
    }
}

async function saveBotState() {
    try {
        const state = {
            botPaused,
            autoCorrectEnabled,
            lastUpdated: new Date().toISOString()
        };
        await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Erreur sauvegarde état:', error);
    }
}

// Charger l'état au démarrage
await loadBotState();

// Fichier de mémoire pour stocker les informations importantes
const MEMORY_FILE = path.join(__dirname, 'memory.json');

// Structure de la mémoire
let memory = {
    conversations: {},
    important_info: {},
    current_context: null,
    last_updated: new Date().toISOString()
};

// Charger la mémoire existante
async function loadMemory() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf-8');
        memory = JSON.parse(data);
        console.log('Mémoire chargée avec succès');
    } catch (error) {
        console.log('Fichier memory.json non trouvé, création d\'une nouvelle mémoire');
        await saveMemory();
    }
}

// Sauvegarder la mémoire
async function saveMemory() {
    try {
        memory.last_updated = new Date().toISOString();
        await fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2));
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de la mémoire:', error);
    }
}

// Charger la mémoire au démarrage
await loadMemory();

// Configuration WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Numéros autorisés (format: numéro@c.us)
const authorizedNumbers = ['33685627672@c.us'];

// Histoires des conversations
const conversationHistory = new Map();
const conversationPhases = new Map();
let busyUntil = null;

// Obtenir le contexte temporel actuel
function getCurrentTimeContext() {
    const parisTime = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const hour = new Date().getHours();
    
    if (hour >= 9 && hour < 12) return 'matin';
    if (hour >= 12 && hour < 14) return 'midi';
    if (hour >= 14 && hour < 19) return 'aprem';
    if (hour >= 19 && hour < 23) return 'soir';
    return 'neutral';
}


// Fonction pour accès complet à ChatGPT avec web search
async function askChatGPT(query) {
    try {
        console.log(`[GPT] Question à ChatGPT: "${query}"`);
        
        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: [
                {
                    role: 'system',
                    content: `Tu es ChatGPT, assistant IA sur WhatsApp. Tu peux répondre à toutes les questions.
                    
CAPACITÉS:
- Tu as accès à la recherche web si nécessaire pour des informations récentes
- Tu peux répondre à des questions générales sans recherche web
- Tu peux aider avec du code, des explications, des conseils, etc.

INSTRUCTIONS:
- Détermine si tu as besoin de faire une recherche web ou non
- Si l'info est récente ou changeante (actualités, prix, météo), utilise la recherche web
- Si c'est une question générale, réponds directement
- Utilise des emojis pour rendre le message plus agréable 😊
- Structure ta réponse clairement
- Limite ta réponse à 800 caractères max (contrainte WhatsApp)
- Détecte la langue de la question et réponds dans la même langue`
                },
                {
                    role: 'user',
                    content: query
                }
            ],
            temperature: 0.7,
            max_tokens: 400
        });
        
        console.log('[GPT] Réponse complète OpenAI:', JSON.stringify(completion, null, 2));
        
        const response = completion.choices[0].message.content;
        console.log('[GPT] Contenu de la réponse:', response);
        
        if (!response || response.trim() === '') {
            console.log('[GPT] Réponse vide reçue');
            return "❌ ChatGPT n'a pas pu répondre";
        }
        
        return response;
        
    } catch (error) {
        console.error('[GPT] Erreur OpenAI:', error);
        console.error('[GPT] Type d\'erreur:', error.constructor.name);
        console.error('[GPT] Code d\'erreur:', error.code);
        throw error;
    }
}

// Détecter les fautes de frappe courantes
async function detectTypos(text, previousMessages = []) {
    console.log(`[AUTO-CORRECT] Analyse avec GPT-4 pour: "${text}"`);
    if (previousMessages.length > 0) {
        console.log(`[AUTO-CORRECT] Contexte: ${previousMessages.length} messages précédents`);
    }
    
    try {
        // Construire le contexte pour GPT-4
        let contextText = '';
        if (previousMessages.length > 0) {
            contextText = '\n\nCONTEXTE DE LA CONVERSATION:\n';
            previousMessages.forEach(msg => {
                contextText += `${msg.from}: ${msg.body}\n`;
            });
            contextText += `Moi: ${text} (← message à corriger)\n`;
        }
        
        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: [
                {
                    role: 'system',
                    content: `Tu es un système de correction automatique pour messages WhatsApp. Analyse le message et détermine s'il contient des fautes de frappe.

RÈGLE FONDAMENTALE:
- DÉTECTE LA LANGUE du message et RESTE dans cette langue
- NE JAMAIS TRADUIRE entre les langues
- Si c'est en anglais, corrige en anglais
- Si c'est en français, corrige en français
- Si c'est un mélange, garde le mélange

MISSION PRINCIPALE:
- Comprendre l'INTENTION du message même s'il est mal tapé
- Corriger UNIQUEMENT les fautes de frappe, pas le style
- Ne pas traduire ou modifier le sens

EXEMPLES EN FRANÇAIS:
- "tu fai koi" → "tu fais quoi"
- "jvai aller manger" → "je vais aller manger"
- "c bon pour toi?" → "c'est bon pour toi?"

EXEMPLES EN ANGLAIS:
- "wat r u doing" → "what are you doing"
- "thx alot" → "thanks a lot"
- "ur right" → "you're right"

RÈGLES IMPORTANTES:
- NE JAMAIS CORRIGER "paf" ou "Paf" au début d'un message
- NE PAS TRADUIRE les abréviations (wdyt reste wdyt, pas "tu en penses quoi")
- IGNORE les abréviations courantes intentionnelles:
  * Anglais: lol, brb, btw, fyi, asap, wdyt, imo, tbh, etc.
  * Français: tkt, jsp, mdr, lol, slt, etc.
- Garde le style informel et les abréviations volontaires
- NE CORRIGE QUE les vraies fautes de frappe

Réponds UNIQUEMENT avec un JSON dans ce format exact:
{
  "hasTypos": true/false,
  "correctedText": "texte corrigé ou texte original si pas de fautes",
  "confidence": 0-100
}

Ne corrige que si tu es sûr à plus de 70% que c'est une faute involontaire.${contextText ? '\n\nUtilise le contexte de la conversation pour mieux comprendre la langue et l\'intention.' : ''}`
                },
                {
                    role: 'user',
                    content: contextText ? `${contextText}\n\nCorrige uniquement le dernier message (celui marqué "← message à corriger")` : text
                }
            ],
            temperature: 0.3,
            max_tokens: 200
        });
        
        const responseText = completion.choices[0].message.content;
        console.log('[AUTO-CORRECT] Réponse GPT-4:', responseText);
        
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return result;
            }
        } catch (parseError) {
            console.error('[AUTO-CORRECT] Erreur parsing JSON:', parseError);
        }
        
        return { hasTypos: false, correctedText: text, confidence: 0 };
        
    } catch (error) {
        console.error('[AUTO-CORRECT] Erreur GPT-4:', error);
        return { hasTypos: false, correctedText: text, confidence: 0 };
    }
}

// Le reste du code principal continue ici...
// [Copier le reste du code depuis la ligne après detectTypos jusqu'à avant le serveur Express]

// Fonction pour vérifier le week-end
function isWeekend() {
    const parisDate = new Date().toLocaleString('fr-FR', { 
        timeZone: 'Europe/Paris',
        weekday: 'long'
    });
    const weekend = parisDate.includes('samedi') || parisDate.includes('dimanche');
    return weekend;
}

// [Continuer avec le reste du code du bot WhatsApp...]

// Gestion des commandes via stdin depuis le serveur principal
process.stdin.on('data', (data) => {
    const command = data.toString().trim();
    
    if (command === 'PAUSE') {
        botPaused = true;
        saveBotState();
        console.log('[BOT] Mis en pause');
    } else if (command === 'RESUME') {
        botPaused = false;
        saveBotState();
        console.log('[BOT] Reprise');
    } else if (command.startsWith('AUTOCORRECT:')) {
        const enabled = command.split(':')[1] === 'true';
        autoCorrectEnabled = enabled;
        saveBotState();
        console.log(`[BOT] Auto-correction: ${enabled ? 'activée' : 'désactivée'}`);
    } else if (command.startsWith('CONTEXT:')) {
        const context = command.split(':')[1];
        if (context === 'CLEAR') {
            memory.current_context = null;
            console.log('[BOT] Contexte effacé');
        } else {
            memory.current_context = {
                description: context,
                timestamp: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
            };
            console.log('[BOT] Contexte mis à jour:', context);
        }
        saveMemory();
    }
});

// Initialisation du client WhatsApp
console.log('Démarrage du bot WhatsApp...');
console.log('Contexte actuel:', getCurrentTimeContext());
client.initialize();

// [Ajouter ici tous les event handlers du client WhatsApp...]
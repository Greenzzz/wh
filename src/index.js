import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import fetch from 'node-fetch';
import { getGoogleCalendarTool, executeCalendarAction } from '../google-calendar-tool.js';
import profileManager from './profileManager.js';
// Express a été déplacé vers server.js

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// Configuration
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const authorizedNumbers = process.env.AUTHORIZED_NUMBERS ? 
    process.env.AUTHORIZED_NUMBERS.split(',').map(num => num.trim()) : [];

const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
const discordKeywords = process.env.DISCORD_KEYWORDS ? 
    process.env.DISCORD_KEYWORDS.split(',').map(word => word.trim().toLowerCase()) : [];

// Charger le contexte personnel
let context = {};
try {
    const contextFile = await fs.readFile(join(__dirname, '..', 'context.json'), 'utf-8');
    context = JSON.parse(contextFile);
} catch (error) {
    console.log('Fichier context.json non trouvé ou invalide, utilisation du contexte par défaut');
}

// Charger la mémoire
let memory = { conversations: {}, important_info: {}, last_updated: new Date().toISOString() };
try {
    const memoryFile = await fs.readFile(join(__dirname, 'memory.json'), 'utf-8');
    memory = JSON.parse(memoryFile);
} catch (error) {
    console.log('Fichier memory.json non trouvé, création d\'une nouvelle mémoire');
}

// Charger les données de l'analyse WhatsApp
let marionAnalysis = {};
let marionPrompt = '';
try {
    const analysisFile = await fs.readFile(join(__dirname, 'marion_analysis.json'), 'utf-8');
    marionAnalysis = JSON.parse(analysisFile);
    const promptFile = await fs.readFile(join(__dirname, 'marion_prompt.txt'), 'utf-8');
    marionPrompt = promptFile;
    console.log('✅ Données d\'analyse de Marion chargées avec succès');
} catch (error) {
    console.log('⚠️ Fichiers d\'analyse non trouvés, utilisation du prompt par défaut');
}

// Sauvegarder la mémoire
async function saveMemory() {
    try {
        memory.last_updated = new Date().toISOString();
        await fs.writeFile(join(__dirname, 'memory.json'), JSON.stringify(memory, null, 2));
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de la mémoire:', error);
    }
}

// Envoyer une notification Discord
async function sendDiscordNotification(message, from) {
    if (!discordWebhook) return;
    
    try {
        const contact = await from.getContact();
        const timestamp = new Date().toLocaleString('fr-FR');
        
        await fetch(discordWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: "📱 Message Important WhatsApp",
                    description: message,
                    color: 16711680, // Rouge
                    fields: [
                        { name: "De", value: contact.pushname || from.from, inline: true },
                        { name: "Heure", value: timestamp, inline: true }
                    ],
                    footer: { text: "WhatsApp Bot Notifier" }
                }]
            })
        });
        console.log('Notification Discord envoyée');
    } catch (error) {
        console.error('Erreur Discord:', error);
    }
}

// Vérifier si le message contient des mots-clés importants
function containsImportantKeywords(message) {
    const lowerMessage = message.toLowerCase();
    return discordKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Analyser le sentiment du message
function analyzeSentiment(message) {
    const lowerMessage = message.toLowerCase();
    
    // Mots négatifs
    const negativeWords = ['triste', 'mal', 'pleure', 'déprimé', 'énervé', 'fâché', 'déçu', 'nul', 'marre'];
    const positiveWords = ['heureux', 'content', 'super', 'génial', 'love', 'parfait', 'merci', 'cool'];
    const questionWords = ['?', 'quoi', 'comment', 'pourquoi', 'où', 'quand', 'qui'];
    
    const hasNegative = negativeWords.some(word => lowerMessage.includes(word));
    const hasPositive = positiveWords.some(word => lowerMessage.includes(word));
    const hasQuestion = questionWords.some(word => lowerMessage.includes(word));
    
    if (hasNegative) return 'negative';
    if (hasPositive) return 'positive';
    if (hasQuestion) return 'question';
    return 'neutral';
}


// Fonction pour accès complet à ChatGPT avec web search
async function askChatGPT(query, chatHistory = []) {
    try {
        console.log(`[GPT] Question à ChatGPT: "${query}"`);
        console.log(`[GPT] Historique: ${chatHistory.length} messages`);
        
        // Pour les commandes "paf", toujours donner TOUS les tools disponibles
        // et laisser GPT-4.1 décider lequel utiliser
        const tools = [
            {
                type: "function",
                function: {
                    name: "web_search",
                    description: "Rechercher des informations actuelles sur le web (restaurants, actualités, prix, météo, etc.)",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "La requête de recherche"
                            }
                        },
                        required: ["query"]
                    }
                }
            },
            getGoogleCalendarTool()
        ];
        
        // GPT-4.1 est intelligent, il choisira le bon tool automatiquement
        const hasTools = tools;
        
        // Obtenir la date et l'heure actuelles
        const now = new Date();
        const dateStr = now.toLocaleDateString('fr-FR', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        const timeStr = now.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        // Construire les messages avec l'historique
        const messages = [
            {
                role: 'system',
                content: `Tu es ChatGPT, assistant IA sur WhatsApp conversant avec Nico.

DATE ET HEURE ACTUELLES:
- Aujourd'hui: ${dateStr}
- Il est: ${timeStr}
- Format dates pour Google Calendar: YYYY-MM-DD

CAPACITÉS:
- Tu as accès à la fonction web_search pour chercher des infos actuelles
- Tu as accès à la fonction google_calendar pour gérer le calendrier de Nico
- GPT-4.1 a aussi des connaissances web natives jusqu'en 2025
- Tu as accès à l'historique de la conversation pour le contexte
- Google Calendar peut chercher automatiquement les contacts dans Google Contacts

INSTRUCTIONS CRITIQUES:
- Si on te demande d'ajouter/créer/programmer un rdv/meeting → UTILISE google_calendar avec action: "create_event"
- Si on te demande de DÉPLACER/DÉCALER/CHANGER L'HEURE/MODIFIER/AJOUTER DES PARTICIPANTS à un rdv → UTILISE google_calendar avec action: "update_event"
  * Pour déplacer: title (nom de l'événement), date (date actuelle), newTime (nouvelle heure)
  * Pour ajouter des participants: title, date, attendees (liste des noms/emails)
  * Optionnel: oldTime (si plusieurs événements du même nom), newDate (si changement de jour)
- Si on te demande de SUPPRIMER/ANNULER un rdv → UTILISE google_calendar avec action: "delete_event"
- Si on mentionne des personnes (ex: "meeting avec Vincent Aurez") → AJOUTE leurs NOMS dans attendees
- Google Calendar cherchera automatiquement leurs emails dans les contacts Google
- Exemples: ["Vincent Aurez", "Marion", "JB", "Nicolas Jouve"] → sera automatiquement converti en emails
- Si on te demande l'agenda/planning → UTILISE google_calendar avec action: "list_events"
- IMPORTANT: Utilise la date d'aujourd'hui (${now.toISOString().split('T')[0]}) comme référence pour "aujourd'hui", "demain", etc.
- Si tu utilises un tool, ATTENDS les résultats avant de répondre
- RÉPONDS DIRECTEMENT avec les informations complètes
- NE DIS JAMAIS "je vais chercher" ou "un instant"
- Pour les menus de restaurant, utilise web_search si disponible
- Utilise des emojis pour la lisibilité 😊
- Maximum 800 caractères (contrainte WhatsApp)
- Détecte la langue et réponds dans la même langue
- Tiens compte du contexte de la conversation`
            }
        ];
        
        // Ajouter l'historique (limité aux 5 derniers messages pour ne pas surcharger)
        const recentHistory = chatHistory.slice(-5);
        for (const msg of recentHistory) {
            messages.push({
                role: msg.fromMe ? 'assistant' : 'user',
                content: msg.body
            });
        }
        
        // Ajouter la question actuelle
        messages.push({
            role: 'user',
            content: query
        });
        
        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: messages,
            tools: hasTools,
            tool_choice: hasTools ? "auto" : undefined,
            temperature: 0.7,
            max_tokens: 800
        });
        
        console.log('[GPT] Réponse reçue');
        let responseMessage = completion.choices[0].message;
        let usedWebSearch = false;
        
        // Si GPT-4.1 demande d'utiliser des tools
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            console.log('[GPT] Tool calls demandés:', responseMessage.tool_calls);
            
            // Préparer les messages pour le second appel
            const updatedMessages = [...messages, responseMessage];
            
            // Traiter chaque tool call
            for (const toolCall of responseMessage.tool_calls) {
                if (toolCall.function.name === 'web_search') {
                    usedWebSearch = true;
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`[GPT] 🌐 Recherche web pour: "${args.query}"`);
                    
                    // Simuler une réponse de recherche web
                    // Note: GPT-4.1 pourrait avoir accès natif, mais on simule pour le fallback
                    updatedMessages.push({
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: `Recherche effectuée. GPT-4.1 a accès aux données web natives, utilisez vos connaissances intégrées pour répondre sur: ${args.query}`
                    });
                } else if (toolCall.function.name === 'google_calendar') {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`[GPT] 📅 Action Google Calendar: ${args.action}`);
                    
                    try {
                        const calendarResult = await executeCalendarAction(args);
                        updatedMessages.push({
                            tool_call_id: toolCall.id,
                            role: "tool",
                            content: calendarResult
                        });
                    } catch (error) {
                        console.error('[GPT] Erreur Google Calendar:', error);
                        updatedMessages.push({
                            tool_call_id: toolCall.id,
                            role: "tool",
                            content: "❌ Erreur lors de l'accès à Google Calendar"
                        });
                    }
                }
            }
            
            // Obtenir la réponse finale avec les résultats
            const finalCompletion = await openai.chat.completions.create({
                model: 'gpt-4.1',
                messages: updatedMessages,
                temperature: 0.7,
                max_tokens: 800
            });
            
            responseMessage = finalCompletion.choices[0].message;
        }
        
        let response = responseMessage.content;
        
        if (!response || response.trim() === '') {
            console.log('[GPT] Réponse vide reçue');
            return "❌ ChatGPT n'a pas pu répondre";
        }
        
        // Ajouter l'emoji 🌐 au début si une recherche web a été utilisée
        if (usedWebSearch && !response.includes('🌐')) {
            response = '🌐 ' + response;
            console.log('[GPT] Ajout de l\'emoji web search');
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
            model: 'gpt-4.1-mini',
            messages: [
                {
                    role: 'system',
                    content: `Tu es un système de correction automatique pour messages WhatsApp de Nicolas. Analyse le message et détermine s'il contient des fautes de frappe.

RÈGLE FONDAMENTALE:
- DÉTECTE LA LANGUE du message et RESTE dans cette langue
- NE JAMAIS TRADUIRE entre les langues
- Si c'est en anglais, corrige en anglais
- Si c'est en français, corrige en français
- Si c'est un mélange, garde le mélange

STYLE DE NICOLAS (ne PAS corriger):
- Expressions favorites: Bah, Ok, Oui, Ah, Oué, ça va, Du coup
- Abréviations courantes: tkt, jsp, stp, jpp, tqt, wdyt
- Façons de rire: Ahah, ahah, Lol, lol, Ahahah
- Messages courts (moyenne 10 caractères)
- NE PAS corriger: "oué" (c'est son style), "bah", expressions familières

MISSION PRINCIPALE:
- Comprendre l'INTENTION du message même s'il est mal tapé
- Corriger UNIQUEMENT les vraies fautes de frappe, pas le style personnel
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
- NE JAMAIS CORRIGER les messages qui commencent par l'emoji 🤖
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
            temperature: 0.1,
            max_tokens: 200
        });
        
        const response = JSON.parse(completion.choices[0].message.content);
        console.log(`[AUTO-CORRECT] Réponse GPT-4:`, response);
        
        // Ne corriger que si confiance > 70% et qu'il y a vraiment des fautes
        if (response.hasTypos && response.confidence > 70) {
            return {
                hasTypos: true,
                correctedText: response.correctedText
            };
        }
        
        return {
            hasTypos: false,
            correctedText: text
        };
        
    } catch (error) {
        console.error('[AUTO-CORRECT] Erreur GPT-4:', error);
        return {
            hasTypos: false,
            correctedText: text
        };
    }
}


// Réactions aux médias
const mediaReactions = {
    photo: ["waw 😍", "trop bien!", "stylé!", "😮", "canon!", "👌", "joli!"],
    video: ["je regarde", "2sec", "ah ouais!", "😂", "excellent", "mdr"],
    audio: ["j'écoute", "ok je mets le son", "👍", "2sec"],
    sticker: ["😂", "mdr", "😅", "ahah", "👍"],
    document: ["je regarde", "ok je dl", "merci", "👍", "reçu"]
};

// Délai de réponse aléatoire avec phases de conversation
function getRandomDelay(chatId) {
    // Initialiser ou récupérer la phase de conversation
    if (!conversationPhases.has(chatId)) {
        conversationPhases.set(chatId, {
            messageCount: 0,
            lastMessageTime: Date.now(),
            isInActivePhase: true
        });
    }
    
    const phase = conversationPhases.get(chatId);
    const timeSinceLastMessage = Date.now() - phase.lastMessageTime;
    
    // Si plus de 10 minutes depuis le dernier message, reset la phase
    if (timeSinceLastMessage > 10 * 60 * 1000) {
        phase.messageCount = 0;
        phase.isInActivePhase = true;
    }
    
    // Incrémenter le compteur
    phase.messageCount++;
    phase.lastMessageTime = Date.now();
    
    // Déterminer la phase actuelle
    if (phase.messageCount <= 15) {
        // Phase active : réponses rapides (1.5-10 sec)
        phase.isInActivePhase = true;
        const min = 1500;  // 1.5 secondes
        const max = 10000; // 10 secondes
        return Math.floor(Math.random() * (max - min + 1)) + min;
    } else if (phase.messageCount <= 20) {
        // Transition : parfois rapide, parfois lent
        const useSlowResponse = Math.random() < 0.5;
        if (useSlowResponse) {
            phase.isInActivePhase = false;
            const min = 30000;  // 30 secondes
            const max = 120000; // 2 minutes
            return Math.floor(Math.random() * (max - min + 1)) + min;
        } else {
            const min = 5000;   // 5 secondes
            const max = 15000;  // 15 secondes
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
    } else {
        // Phase occupée : UNE SEULE réponse lente puis retour en phase active
        phase.isInActivePhase = false;
        
        // Reset automatique pour le prochain message
        phase.messageCount = 0;
        console.log('Prochaine réponse sera en phase active après cette pause');
        
        const min = 60000;   // 1 minute
        const max = 300000;  // 5 minutes
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

// Déterminer l'heure actuelle
function getCurrentTimeContext() {
    const hour = new Date().getHours();
    if (hour < 9) return 'matin_tot';
    if (hour < 12) return 'matin';
    if (hour < 14) return 'midi';
    if (hour < 18) return 'aprem';
    if (hour < 22) return 'soir';
    return 'nuit';
}

// Déterminer si c'est le weekend (désactivé - entrepreneur)
function isWeekend() {
    return false; // Toujours en semaine pour un entrepreneur
}

// Créer le prompt système enrichi
async function createSystemPrompt(chatId, sentiment = 'neutral') {
    const timeContext = getCurrentTimeContext();
    const weekend = isWeekend();
    
    // Vérifier si le contexte temporaire est encore valide
    let currentContext = '';
    if (memory.current_context && new Date(memory.current_context.expiresAt) > new Date()) {
        currentContext = `\n🔴 CONTEXTE TEMPORAIRE IMPORTANT : ${memory.current_context.description}`;
    }
    
    // Ajouter le contexte custom de la homepage s'il existe
    if (context.customContext) {
        currentContext += `\n📝 CONTEXTE ADDITIONNEL : ${context.customContext}`;
    }
    
    // Charger le profil du contact
    const profile = await profileManager.getProfileByNumber(chatId);
    let basePrompt = '';
    
    if (profile) {
        // Charger les données du profil
        await profileManager.loadProfileData(profile.id);
        const prompt = profileManager.prompts.get(profile.id);
        
        if (prompt) {
            basePrompt = prompt;
        } else {
            basePrompt = profileManager.generateDefaultPrompt(profile);
        }
    } else {
        // Prompt par défaut si contact non configuré
        basePrompt = `Tu es Nicolas et tu parles à quelqu'un.`;
    }
    
    // Ajouter les éléments contextuels et dynamiques
    let prompt = `${basePrompt}

RÈGLE ABSOLUE : Tu ES Nicolas, pas un assistant. Si on te demande qui tu es, tu dis que tu es Nicolas. Si on te demande si tu es un bot/IA/ChatGPT, tu nies TOUJOURS et tu peux même t'énerver un peu genre "mais qu'est-ce que tu racontes??" ou "t'es sérieuse là?".

CONTEXTE ACTUEL :
- Période de la journée : ${timeContext}
- Je travaille sur mon entreprise (horaires flexibles)
${currentContext}

SENTIMENT DÉTECTÉ : ${sentiment}
${sentiment === 'negative' ? '- Marion semble triste/énervée, sois plus doux et attentionné' : ''}
${sentiment === 'positive' ? '- Marion est de bonne humeur, sois enjoué aussi' : ''}
${sentiment === 'question' ? '- Marion pose une question, réponds de manière directe' : ''}

Réponds de manière ULTRA naturelle, comme si tu tapais vite sur ton téléphone. Garde tes messages courts et utilise ton style habituel.`;

    return prompt;
}

// Initialisation du client WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: join(__dirname, '..', '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    }
});

// Ajouter des événements de débogage
client.on('loading_screen', (percent, message) => {
    console.log(`[LOADING] ${percent}% - ${message}`);
});

client.on('change_state', state => {
    console.log(`[STATE] État changé: ${state}`);
});

// Historique des conversations
const conversationHistory = new Map();

// État d'occupation
let isBusy = false;
let busyUntil = null;

// État du bot (actif/pause)
let botPaused = false;

// État de l'auto-correction (true par défaut, sauf si désactivé explicitement)
let autoCorrectEnabled = process.env.AUTO_CORRECT_ENABLED !== 'false';

// Compteur de messages pour les phases de conversation
const conversationPhases = new Map();

// Tracker les messages déjà édités pour éviter les boucles
const editedMessages = new Set();

// Tracker les réponses ChatGPT aux commandes "paf" pour éviter l'auto-correction
const pafResponses = new Set();

// Stocker le dernier message envoyé pour l'interface
let lastSentMessage = null;

// Fichier d'état partagé
const STATE_FILE = join(__dirname, 'bot-state.json');

// Vérifier l'état du bot
async function checkBotState() {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf-8');
        const state = JSON.parse(data);
        botPaused = state.paused || false;
        // Charger aussi l'état de l'auto-correction
        if (state.autoCorrectEnabled !== undefined) {
            autoCorrectEnabled = state.autoCorrectEnabled;
        }
    } catch {
        // Pas de fichier d'état, valeurs par défaut
        botPaused = false;
    }
}

// Sauvegarder l'état du bot
async function saveBotState() {
    try {
        await fs.writeFile(STATE_FILE, JSON.stringify({ 
            paused: botPaused,
            autoCorrectEnabled: autoCorrectEnabled 
        }, null, 2));
    } catch (error) {
        console.error('Erreur sauvegarde état:', error);
    }
}

// Événements WhatsApp
// Logs détaillés pour debug
client.on('loading_screen', (percent, message) => {
    console.log('[LOADING]', percent, message);
});

client.on('qr', (qr) => {
    console.log('[QR] QR Code reçu, scannez-le avec WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('[READY] ✅ Client WhatsApp connecté et prêt!');
    console.log(`[READY] Numéros autorisés: ${authorizedNumbers.join(', ')}`);
    console.log(`[READY] Discord webhook: ${discordWebhook ? 'Configuré' : 'Non configuré'}`);
});

client.on('authenticated', () => {
    console.log('[AUTH] ✅ Authentification réussie!');
});

client.on('auth_failure', msg => {
    console.error('[AUTH] ❌ Échec de l\'authentification:', msg);
});

client.on('disconnected', (reason) => {
    console.log('[DISCONNECT] Client déconnecté:', reason);
});

// Utiliser message_create pour capturer TOUS les messages (entrants et sortants)
client.on('message_create', async msg => {
    // Logger TOUS les messages pour debug
    console.log('\n=== NOUVEAU MESSAGE (message_create) ===');
    console.log(`From: ${msg.from}`);
    console.log(`To: ${msg.to}`);
    console.log(`FromMe: ${msg.fromMe}`);
    console.log(`Body: "${msg.body}"`);
    console.log(`Type: ${msg.type}`);
    console.log(`IsGroup: ${msg.isGroupMsg}`);
    console.log(`Author: ${msg.author}`);
    console.log(`msg.id:`, msg.id);
    console.log('================================\n');
    
    try {
        const contact = await msg.getContact();
        const chatId = msg.from;
        
        console.log(`[MESSAGE] Contact: ${contact.pushname || 'Unknown'}, ChatId: ${chatId}`);
        
        // Vérifier d'abord si le contact est activé pour les messages entrants
        if (!msg.fromMe) {
            console.log(`[DEBUG] Message entrant, vérification du profil...`);
            console.log(`[DEBUG] Recherche profil pour chatId: ${chatId}`);
            const profile = profileManager.getProfileByNumberSync(chatId);
            console.log(`[DEBUG] Profil trouvé:`, profile ? `${profile.name} (${profile.phoneNumber})` : 'NON');
            console.log(`[DEBUG] Master Switch:`, profileManager.config.globalSettings.masterSwitch);
            
            // Si pas de profil trouvé, vérifier le comportement par défaut
            if (!profile) {
                // Si pas de profil et comportement par défaut désactivé, ignorer
                if (!profileManager.config.globalSettings.defaultEnabled) {
                    console.log(`Message ignoré de ${contact.pushname || chatId} - Contact non configuré`);
                    return;
                }
            } else {
                // Vérifier si le contact est activé et si le master switch est actif
                if (!profile.enabled) {
                    console.log(`Message ignoré de ${contact.pushname || chatId} - Contact désactivé (enabled: ${profile.enabled})`);
                    return;
                }
                if (!profileManager.config.globalSettings.masterSwitch) {
                    console.log(`Message ignoré de ${contact.pushname || chatId} - Master Switch désactivé`);
                    return;
                }
                
                // Vérifier si la réponse automatique est activée pour ce contact
                if (!profile.features.autoReply) {
                    console.log(`Message ignoré de ${contact.pushname || chatId} - Réponse auto désactivée`);
                    return;
                }
                
                console.log(`[DEBUG] ✅ Toutes les vérifications passées pour ${profile.name}`);
            }
            
            // Si on arrive ici, le message sera traité plus bas
        }
        
        // Traiter d'abord les messages sortants (fromMe) pour l'auto-correction
        if (msg.fromMe) {
            console.log('[AUTO-CORRECT] Message sortant détecté!');
            console.log(`[AUTO-CORRECT] ID du message: ${msg.id?.id || msg.id?._serialized || 'ID non disponible'}`);
            
            // Stocker le dernier message envoyé (sauf commandes bot)
            if (!msg.body.toLowerCase().startsWith('bot ')) {
                lastSentMessage = {
                    id: msg.id.id,
                    body: msg.body,
                    to: msg.to,
                    timestamp: msg.timestamp,
                    toName: contact.pushname || msg.to
                };
                console.log(`[INTERFACE] Dernier message stocké: "${msg.body}" vers ${lastSentMessage.toName}`);
            }
            
            // Gérer l'auto-correction de tes propres messages (fonctionne même si bot en pause)
            if (!msg.isGroupMsg) {
                // NE PAS recharger la config à chaque message - trop coûteux!
                
                // Pour l'auto-correction, on doit vérifier les paramètres du DESTINATAIRE (msg.to)
                const recipientId = msg.to || chatId;
                console.log(`[AUTO-CORRECT-DEBUG] Recherche profil pour recipientId: "${recipientId}"`);
                
                const profile = profileManager.getProfileByNumberSync(recipientId);
                // Si pas de profil, utiliser les paramètres par défaut de globalSettings
                const shouldAutoCorrect = profile 
                    ? profile.features.autoCorrect 
                    : (profileManager.config.globalSettings.defaultFeatures.autoCorrect || autoCorrectEnabled);
                
                console.log(`[AUTO-CORRECT] Pas un groupe. AutoCorrect pour ${profile?.name || recipientId}: ${shouldAutoCorrect}`);
                if (profile) {
                    console.log(`[AUTO-CORRECT] Config du contact:`, {
                        id: profile.id,
                        phoneNumber: profile.phoneNumber,
                        enabled: profile.enabled,
                        autoCorrect: profile.features.autoCorrect,
                        autoReply: profile.features.autoReply
                    });
                } else {
                    console.log(`[AUTO-CORRECT] Aucun profil trouvé pour ${recipientId}`);
                    console.log(`[AUTO-CORRECT] Utilisation des paramètres par défaut:`, {
                        defaultAutoCorrect: profileManager.config.globalSettings.defaultFeatures.autoCorrect,
                        autoCorrectEnabled: autoCorrectEnabled,
                        shouldAutoCorrect: shouldAutoCorrect
                    });
                }
                
                // Ne pas corriger si le message commence par "paf", "🤖" ou si c'est une réponse "paf"
                if (msg.body.toLowerCase().startsWith('paf ') || msg.body.startsWith('🤖')) {
                    console.log('[AUTO-CORRECT] Message commence par "paf" ou "🤖" - pas de correction');
                    // Ne PAS faire return ici - on veut que le message continue vers ChatGPT !
                } else {
                    // Vérifier si c'est une réponse paf marquée
                    if (pafResponses.size > 0) {
                        const possibleIds = [
                            msg.id?.id,
                            msg.id?._serialized,
                            msg.id
                        ].filter(id => id);
                        
                        console.log('[AUTO-CORRECT] Vérification IDs possibles:', possibleIds);
                        console.log('[AUTO-CORRECT] IDs marqués:', Array.from(pafResponses));
                        
                        const foundId = possibleIds.find(id => pafResponses.has(id));
                        if (foundId) {
                            console.log(`[AUTO-CORRECT] Message est une réponse ChatGPT à "paf" (ID: ${foundId}) - pas de correction`);
                            pafResponses.delete(foundId); // Nettoyer après utilisation
                            return; // Empêcher toute correction
                        }
                    }
                    
                    // Si on arrive ici et que l'auto-correction est activée, on corrige
                    if (shouldAutoCorrect) {
                    console.log('[AUTO-CORRECT] Début analyse...');
                    
                    
                    // Récupérer les messages précédents pour le contexte
                    let previousMessages = [];
                    try {
                        const chat = await msg.getChat();
                        const messages = await chat.fetchMessages({ limit: 10 });
                        previousMessages = messages
                            .filter(m => m.timestamp < msg.timestamp)
                            .sort((a, b) => b.timestamp - a.timestamp)
                            .slice(0, 5)
                            .reverse()
                            .map(m => ({
                                from: m.fromMe ? 'Moi' : 'Contact',
                                body: m.body
                            }));
                    } catch (error) {
                        console.log('[AUTO-CORRECT] Impossible de récupérer le contexte');
                    }
                    
                    // Vérifier si le message a potentiellement des fautes
                    const typoCheck = await detectTypos(msg.body, previousMessages);
                    console.log(`[AUTO-CORRECT] Fautes détectées: ${typoCheck.hasTypos}`);
                    
                    if (typoCheck.hasTypos && msg.body.length > 5 && !msg.body.toLowerCase().startsWith('bot ') && !msg.body.toLowerCase().startsWith('paf ') && !msg.body.startsWith('🤖')) {
                    const correctedText = typoCheck.correctedText;
                    console.log(`[AUTO-CORRECT] Texte corrigé: "${correctedText}"`);
                    
                    // Si le texte corrigé est différent, corriger le message
                    if (correctedText !== msg.body && correctedText.length > 0) {
                        try {
                            console.log('[AUTO-CORRECT] Correction nécessaire...');
                            const chat = await msg.getChat();
                            
                            // Utiliser l'API interne WhatsApp qui fonctionne
                            console.log('[AUTO-CORRECT] Tentative d\'édition avec Store.EditMessage...');
                            
                            try {
                                const page = await client.pupPage;
                                const result = await page.evaluate(async (msgId, serializedId, newText) => {
                                    try {
                                        // Trouver le message dans le Store
                                        const msg = window.Store.Msg.get(msgId) || window.Store.Msg.get(serializedId);
                                        if (!msg) {
                                            return { success: false, error: 'Message non trouvé dans Store' };
                                        }
                                        
                                        // Vérifier l'âge du message (15 minutes max)
                                        const now = new Date().getTime();
                                        const msgTime = msg.t * 1000;
                                        const timeDiff = now - msgTime;
                                        
                                        if (timeDiff > 900000) {
                                            return { success: false, error: 'Message trop ancien (> 15 minutes)' };
                                        }
                                        
                                        // Méthode 1: sendMessageEdit directe
                                        if (window.Store.EditMessage.sendMessageEdit) {
                                            try {
                                                await window.Store.EditMessage.sendMessageEdit(msg, newText, {});
                                                return { success: true, method: 'sendMessageEdit' };
                                            } catch (e) {
                                                console.log('[BROWSER] Erreur sendMessageEdit:', e.message);
                                            }
                                        }
                                        
                                        // Méthode 2: createEditMsgData + addAndSendMessageEdit
                                        if (window.Store.EditMessage.createEditMsgData && window.Store.EditMessage.addAndSendMessageEdit) {
                                            try {
                                                const newMsg = await window.Store.EditMessage.createEditMsgData(msg, newText, {});
                                                if (newMsg) {
                                                    await window.Store.EditMessage.addAndSendMessageEdit(msg, newMsg);
                                                    return { success: true, method: 'createEditMsgData + addAndSendMessageEdit' };
                                                }
                                            } catch (e) {
                                                console.log('[BROWSER] Erreur méthode alternative:', e.message);
                                            }
                                        }
                                        
                                        return { success: false, error: 'Aucune méthode d\'édition disponible' };
                                    } catch (e) {
                                        return { success: false, error: e.message };
                                    }
                                }, msg.id.id, msg.id._serialized, correctedText);
                                
                                if (result.success) {
                                    console.log(`[AUTO-CORRECT] ✅ Message édité avec succès (${result.method})`);
                                    console.log(`[AUTO-CORRECT] "${msg.body}" → "${correctedText}"`);
                                } else {
                                    console.log('[AUTO-CORRECT] ❌ Échec de l\'édition:', result.error);
                                    
                                    // Fallback: essayer msg.edit() au cas où
                                    console.log('[AUTO-CORRECT] Tentative avec msg.edit()...');
                                    const editResult = await msg.edit(correctedText);
                                    console.log('[AUTO-CORRECT] Résultat msg.edit():', editResult);
                                }
                            } catch (error) {
                                console.log('[AUTO-CORRECT] ❌ Erreur globale:', error.message);
                            }
                        } catch (error) {
                            console.error('[AUTO-CORRECT] Erreur lors de la correction:', error);
                        }
                    }
                    } else {
                        console.log('[AUTO-CORRECT] Auto-correction désactivée pour ce contact');
                    }
                }
            }
            
            // Si c'est un message sortant normal (pas une commande et pas "paf"), on arrête ici
            if (msg.fromMe && !msg.body.toLowerCase().startsWith('bot ') && !msg.body.toLowerCase().startsWith('paf ')) {
                console.log('[SKIP] Message sortant normal - pas une commande');
                return;
            }
        }
        
        // Détection de "paf" pour accès à ChatGPT (fonctionne pour tous)
        if (msg.body.toLowerCase().startsWith('paf ')) {
            const question = msg.body.replace(/^paf /i, '').trim();
            
            if (!question) {
                return; // Pas de réponse si pas de question
            }
            
            console.log(`[GPT] Question rapide: "${question}"`);
            
            const chat = await msg.getChat();
            chat.sendStateTyping();
            
            // Récupérer l'historique de la conversation
            const allMessages = await chat.fetchMessages({ limit: 10 });
            const chatHistory = allMessages.map(m => ({
                fromMe: m.fromMe,
                body: m.body,
                timestamp: m.timestamp
            })).reverse(); // Inverser pour avoir l'ordre chronologique
            
            try {
                let gptResponse = await askChatGPT(question, chatHistory);
                // Ajouter l'emoji robot au début si pas déjà présent
                if (!gptResponse.startsWith('🤖')) {
                    gptResponse = '🤖 ' + gptResponse;
                }
                const responseMsg = await msg.reply(gptResponse);
                
                // Marquer cette réponse comme réponse "paf" pour éviter l'auto-correction
                console.log('[GPT] Vérification du message de réponse:', responseMsg ? 'Objet présent' : 'Null');
                if (responseMsg) {
                    console.log('[GPT] Structure responseMsg.id:', responseMsg.id);
                    if (responseMsg.id) {
                        const msgId = responseMsg.id.id || responseMsg.id._serialized || responseMsg.id;
                        console.log(`[GPT] ID extrait: ${msgId}`);
                        pafResponses.add(msgId);
                        console.log(`[GPT] Réponse "paf" marquée: ${msgId}`);
                        console.log(`[GPT] IDs marqués actuels: ${Array.from(pafResponses).join(', ')}`);
                    }
                }
                
                console.log('[GPT] Réponse envoyée');
            } catch (error) {
                console.error('[GPT] Erreur complète:', error);
                console.error('[GPT] Message d\'erreur:', error.message);
                console.error('[GPT] Stack:', error.stack);
                
                // Message d'erreur plus informatif
                let errorMessage = '❌ Erreur ChatGPT';
                if (error.message && error.message.includes('model')) {
                    errorMessage = '❌ Erreur: Modèle GPT indisponible';
                } else if (error.message) {
                    errorMessage = `❌ Erreur: ${error.message.substring(0, 50)}...`;
                }
                
                const errorMsg = await msg.reply(errorMessage);
                
                // Marquer aussi les messages d'erreur "paf" pour éviter l'auto-correction
                if (errorMsg && errorMsg.id) {
                    const msgId = errorMsg.id.id || errorMsg.id._serialized || errorMsg.id;
                    pafResponses.add(msgId);
                    console.log(`[GPT] Message d'erreur "paf" marqué: ${msgId}`);
                }
            }
            return;
        }
        
        // Ignorer les messages de groupe (sauf pour les commandes "paf")
        if (msg.isGroupMsg && !msg.body.toLowerCase().startsWith('paf ')) {
            console.log('[SKIP] Message de groupe ignoré');
            return;
        }

        // Gérer les commandes de contrôle via messages personnels
        // Détection des messages à soi-même : vérifier si c'est notre propre numéro
        const isSelfMessage = msg.fromMe && (
            msg.to === msg.from || 
            msg.to.includes('0000000000') || // Certains cas WhatsApp
            authorizedNumbers.some(num => msg.to === num) // Si on s'envoie à notre propre numéro autorisé
        );
        
        if (isSelfMessage || (msg.fromMe && msg.body.toLowerCase().startsWith('bot '))) {
            // Messages à soi-même ou commandes bot pour contrôler
            const command = msg.body.toLowerCase();
            console.log(`Commande détectée: "${command}" (from: ${msg.from}, to: ${msg.to})`);
            
            if (command === 'bot stop' || command === 'bot pause') {
                botPaused = true;
                await saveBotState();
                await msg.reply('🛑 Bot mis en pause');
                console.log('Bot mis en pause par commande');
                return;
            }
            
            if (command === 'bot start' || command === 'bot resume') {
                botPaused = false;
                await saveBotState();
                await msg.reply('✅ Bot réactivé');
                console.log('Bot réactivé par commande');
                return;
            }
            
            if (command === 'bot status') {
                await msg.reply(`Bot status: ${botPaused ? '⏸️ En pause' : '✅ Actif'}`);
                return;
            }
            
            if (command.startsWith('bot context ')) {
                // Extraire le contexte après "bot context "
                const newContext = msg.body.substring(12);
                
                // Ajouter le contexte temporaire
                if (!context.activites_actuelles) {
                    context.activites_actuelles = [];
                }
                
                // Remplacer le premier élément ou ajouter
                context.activites_actuelles[0] = `[CONTEXTE ACTUEL] ${newContext}`;
                
                // Sauvegarder aussi dans la mémoire pour persistance courte
                if (!memory.current_context) {
                    memory.current_context = {};
                }
                memory.current_context = {
                    description: newContext,
                    timestamp: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // Expire dans 4h
                };
                await saveMemory();
                
                await msg.reply(`📍 Contexte mis à jour: "${newContext}"`);
                console.log(`Nouveau contexte: ${newContext}`);
                return;
            }
            
            if (command === 'bot context clear') {
                // Effacer le contexte temporaire
                if (context.activites_actuelles && context.activites_actuelles.length > 0) {
                    context.activites_actuelles = context.activites_actuelles.filter(
                        act => !act.startsWith('[CONTEXTE ACTUEL]')
                    );
                }
                if (memory.current_context) {
                    delete memory.current_context;
                    await saveMemory();
                }
                await msg.reply('🧹 Contexte temporaire effacé');
                return;
            }
            
            if (command === 'bot help') {
                await msg.reply(`Commandes disponibles:
• bot stop/pause - Met le bot en pause
• bot start/resume - Réactive le bot
• bot status - Affiche le statut
• bot context [description] - Ajoute un contexte temporaire
• bot context clear - Efface le contexte temporaire
• bot paf [question] - Pose une question à ChatGPT
• bot help - Affiche cette aide

Exemple: bot context je suis au bar avec Vincent`);
                return;
            }
            
            if (command.startsWith('bot paf ')) {
                // Commande avec bot paf (ancienne méthode)
                const question = msg.body.replace(/^bot paf /i, '').trim();
                
                if (!question) {
                    await msg.reply('❌ Veuillez poser une question');
                    return;
                }
                
                console.log(`[GPT] Question via bot paf: "${question}"`);
                
                // Indiquer que le bot cherche (silencieusement)
                const chat = await msg.getChat();
                chat.sendStateTyping();
                
                // Récupérer l'historique du groupe
                const allMessages = await chat.fetchMessages({ limit: 10 });
                const chatHistory = allMessages.map(m => ({
                    fromMe: m.fromMe,
                    body: m.body,
                    timestamp: m.timestamp
                })).reverse();
                
                try {
                    // Poser la question à ChatGPT avec l'historique
                    let gptResponse = await askChatGPT(question, chatHistory);
                    // Ajouter l'emoji robot au début si pas déjà présent
                    if (!gptResponse.startsWith('🤖')) {
                        gptResponse = '🤖 ' + gptResponse;
                    }
                    
                    // Envoyer la réponse directement
                    const responseMsg = await msg.reply(gptResponse);
                    
                    // Marquer cette réponse comme réponse "paf" pour éviter l'auto-correction
                    if (responseMsg && responseMsg.id) {
                        const msgId = responseMsg.id.id || responseMsg.id._serialized || responseMsg.id;
                        pafResponses.add(msgId);
                        console.log(`[GPT] Réponse "bot paf" marquée: ${msgId}`);
                        console.log(`[GPT] IDs marqués actuels: ${Array.from(pafResponses).join(', ')}`);
                    }
                    
                    console.log('[GPT] Réponse envoyée');
                } catch (error) {
                    console.error('[GPT] Erreur:', error);
                    const errorMsg = await msg.reply('❌ Erreur ChatGPT');
                    
                    // Marquer aussi les messages d'erreur "bot paf" pour éviter l'auto-correction
                    if (errorMsg && errorMsg.id) {
                        const msgId = errorMsg.id.id || errorMsg.id._serialized || errorMsg.id;
                        pafResponses.add(msgId);
                        console.log(`[GPT] Message d'erreur "bot paf" marqué: ${msgId}`);
                    }
                }
                return;
            }
        }
        
        // FIN DES COMMANDES SPECIALES - Maintenant traiter les messages normaux
        
        // Ne traiter que les messages entrants qui ont passé les vérifications
        if (!msg.fromMe) {
            // Suite du traitement pour les messages entrants
            // L'ancienne variable botPaused n'est plus utilisée - on se fie au Master Switch du profileManager

            console.log(`[PROCESSING] Traitement du message entrant de ${contact.pushname || chatId}: ${msg.body}`);
        
        

        // Vérifier si c'est un message important pour Discord
        if (containsImportantKeywords(msg.body)) {
            await sendDiscordNotification(msg.body, msg);
        }

        // Analyser le sentiment
        const sentiment = analyzeSentiment(msg.body);
        console.log(`Sentiment détecté: ${sentiment}`);

        // Gérer les médias
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            let mediaType = 'document';
            
            if (msg.type === 'image') mediaType = 'photo';
            else if (msg.type === 'video') mediaType = 'video';
            else if (msg.type === 'audio' || msg.type === 'ptt') mediaType = 'audio';
            else if (msg.type === 'sticker') mediaType = 'sticker';
            
            console.log(`Média reçu: ${mediaType}`);
            
            // Réaction rapide au média
            const reactions = mediaReactions[mediaType] || mediaReactions.document;
            const reaction = reactions[Math.floor(Math.random() * reactions.length)];
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            await msg.reply(reaction);
            
            // Sauvegarder dans la mémoire
            if (!memory.conversations[chatId]) {
                memory.conversations[chatId] = [];
            }
            memory.conversations[chatId].push({
                type: 'media',
                mediaType: mediaType,
                timestamp: new Date().toISOString(),
                reaction: reaction
            });
            await saveMemory();
            
            return;
        }

        // Délai aléatoire court avant de commencer à taper
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

        // Indiquer que le bot est en train d'écrire
        const chat = await msg.getChat();
        chat.sendStateTyping();

        // Récupérer l'historique de conversation
        if (!conversationHistory.has(chatId)) {
            conversationHistory.set(chatId, []);
        }
        const history = conversationHistory.get(chatId);

        // Ajouter le message à l'historique
        history.push({ role: 'user', content: msg.body });

        // Limiter l'historique à 15 messages
        if (history.length > 15) {
            history.splice(0, history.length - 15);
        }

        // Sauvegarder les infos importantes
        if (msg.body.toLowerCase().includes('anniversaire') || 
            msg.body.toLowerCase().includes('travail') ||
            msg.body.toLowerCase().includes('famille')) {
            if (!memory.important_info.marion) {
                memory.important_info.marion = {};
            }
            memory.important_info.marion.sujets_recents = memory.important_info.marion.sujets_recents || [];
            memory.important_info.marion.sujets_recents.push({
                message: msg.body,
                timestamp: new Date().toISOString()
            });
            await saveMemory();
        }

        // Déterminer si on est en mode occupé
        const isCurrentlyBusy = busyUntil && new Date() < busyUntil;
        
        // Si on dit qu'on est occupé, activer le mode pour 30 minutes
        if (msg.body.toLowerCase().includes('suis occupé') || 
            msg.body.toLowerCase().includes('en réunion') ||
            msg.body.toLowerCase().includes('je conduis')) {
            busyUntil = new Date(Date.now() + 30 * 60 * 1000);
            isCurrentlyBusy = true;
        }

        // Préparer les messages pour l'API OpenAI
        const systemPrompt = await createSystemPrompt(chatId, sentiment);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history
        ];

        // Si on est occupé, ajouter une instruction
        if (isCurrentlyBusy) {
            messages[0].content += '\n\nIMPORTANT: Tu es actuellement occupé, réponds TRÈS court (1-3 mots max) ou juste un emoji.';
            // Forcer le passage en phase occupée
            if (conversationPhases.has(chatId)) {
                conversationPhases.get(chatId).messageCount = 21;
            }
        }

        // Appeler l'API OpenAI
        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: messages,
            temperature: 0.9,
            max_tokens: 100
        });

        let response = completion.choices[0].message.content;

        // Pour l'instant, pas de typos ajoutés (fonction manquante)
        // response = addTypos(response);

        // Ajouter la réponse à l'historique
        history.push({ role: 'assistant', content: response });

        // Délai aléatoire avant de répondre
        let delay = getRandomDelay(chatId);
        
        // Si contexte spécifique, ajuster le délai
        if (memory.current_context && new Date(memory.current_context.expiresAt) > new Date()) {
            const ctx = memory.current_context.description.toLowerCase();
            if (ctx.includes('conduis') || ctx.includes('voiture') || ctx.includes('route')) {
                // En voiture : délais très longs
                delay = Math.max(delay, 120000 + Math.random() * 180000); // 2-5 minutes min
            } else if (ctx.includes('réunion') || ctx.includes('meeting')) {
                // En réunion : délais longs
                delay = Math.max(delay, 60000 + Math.random() * 120000); // 1-3 minutes min
            } else if (ctx.includes('ciné') || ctx.includes('film')) {
                // Au cinéma : très peu de réponses
                delay = Math.max(delay, 300000 + Math.random() * 300000); // 5-10 minutes min
            }
        }
        
        console.log(`Délai de réponse: ${delay/1000}s (Phase: ${conversationPhases.get(chatId)?.isInActivePhase ? 'active' : 'occupée'})`);
        await new Promise(resolve => setTimeout(resolve, delay));

        // Parfois, arrêter de taper et reprendre (plus naturel)
        // Seulement si le délai était court (< 30 sec)
        if (Math.random() < 0.3 && delay < 30000) {
            chat.clearState();
            await new Promise(resolve => setTimeout(resolve, 1000));
            chat.sendStateTyping();
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        // Arrêter l'indicateur de frappe
        chat.clearState();

        // Envoyer la réponse
        await msg.reply(response);
        console.log(`Réponse envoyée à ${contact.pushname || chatId}: ${response}`);

        // Sauvegarder dans la mémoire
        if (!memory.conversations[chatId]) {
            memory.conversations[chatId] = [];
        }
        memory.conversations[chatId].push({
            user: msg.body,
            assistant: response,
            timestamp: new Date().toISOString(),
            sentiment: sentiment
        });
        
        // Garder seulement les 50 derniers échanges
        if (memory.conversations[chatId].length > 50) {
            memory.conversations[chatId] = memory.conversations[chatId].slice(-50);
        }
        
        await saveMemory();
        
        } // Fin du bloc if (!msg.fromMe)
        
    } // Fin du bloc try
    
    } catch (error) {
        console.error('Erreur lors du traitement du message:', error);
        
        // En cas d'erreur, utiliser une excuse du contexte
        try {
            const excuses = context.directives?.excuses_communes || ['mon tel beugue'];
            const excuse = excuses[Math.floor(Math.random() * excuses.length)];
            await msg.reply(excuse);
        } catch (replyError) {
            console.error('Impossible d\'envoyer le message d\'erreur:', replyError);
        }
    }
});

// Capturer aussi l'événement message_sent pour les messages sortants
client.on('message_sent', async msg => {
    console.log('\n=== MESSAGE ENVOYÉ (message_sent) ===');
    console.log(`To: ${msg.to}`);
    console.log(`Body: "${msg.body}"`);
    console.log('===================================\n');
});


// Recharger le contexte toutes les 5 minutes (pas besoin pour les contacts, on a le signal RELOAD_CONFIG)
setInterval(async () => {
    try {
        const contextFile = await fs.readFile(join(__dirname, '..', 'context.json'), 'utf-8');
        context = JSON.parse(contextFile);
        console.log('[CONFIG] Contexte rechargé');
    } catch (error) {
        console.error('[CONFIG] Erreur lors du rechargement du contexte:', error);
    }
}, 5 * 60 * 1000); // 5 minutes

// Vérifier l'état du bot toutes les 30 secondes (au lieu de 5)
setInterval(async () => {
    await checkBotState();
}, 30000);

// Sauvegarder la mémoire toutes les 10 minutes
setInterval(async () => {
    await saveMemory();
    console.log('Mémoire sauvegardée automatiquement');
}, 10 * 60 * 1000);

// Gestion de l'arrêt propre
process.on('SIGINT', async () => {
    console.log('\nArrêt du bot...');
    await saveMemory();
    await client.destroy();
    process.exit(0);
});

// Démarrer le client
console.log('========================================');
console.log('🚀 Démarrage du bot WhatsApp...');
console.log('🕐 Contexte actuel:', getCurrentTimeContext());
console.log('📦 Node version:', process.version);
console.log('🖥️  Platform:', process.platform);
console.log('========================================');

// Charger la configuration des contacts au démarrage
profileManager.loadConfig().then(() => {
    console.log('✅ Configuration des contacts chargée');
    console.log(`📱 Contacts configurés: ${Object.keys(profileManager.config.contacts).join(', ')}`);
    console.log(`🔄 Master Switch: ${profileManager.config.globalSettings.masterSwitch ? 'Activé' : 'Désactivé'}`);
}).catch(error => {
    console.error('❌ Erreur chargement contacts:', error);
});

console.log('[INIT] Initialisation du client WhatsApp...');
console.log('[INIT] Auth strategy path:', join(__dirname, '..', '.wwebjs_auth'));
console.log('[INIT] Puppeteer config:', JSON.stringify({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }));

// Ajouter un timeout pour détecter si l'initialisation se bloque
const initTimeout = setTimeout(() => {
    console.error('[INIT] ⏱️ Timeout: L\'initialisation prend trop de temps (30s)');
    console.log('[INIT] Vérifiez que Puppeteer peut se lancer correctement');
}, 30000);

client.initialize().then(() => {
    clearTimeout(initTimeout);
    console.log('[INIT] ✅ Client initialize() appelé avec succès');
}).catch(error => {
    clearTimeout(initTimeout);
    console.error('[INIT] ❌ Erreur lors de l\'initialisation:', error);
    console.error('[INIT] Stack trace:', error.stack);
});

// Nettoyer l'historique des conversations toutes les 2 heures
setInterval(() => {
    conversationHistory.clear();
    conversationPhases.clear();
    busyUntil = null;
    pafResponses.clear(); // Nettoyer aussi les réponses "paf" marquées
    console.log('Historique des conversations, phases et réponses paf nettoyés');
}, 2 * 60 * 60 * 1000);

// Gestion des commandes via stdin depuis le serveur principal
process.stdin.on('data', async (data) => {
    const command = data.toString().trim();
    
    if (command === 'PAUSE') {
        // Utiliser le master switch du profileManager
        await profileManager.toggleMasterSwitch(false);
        botPaused = true;
        saveBotState();
        console.log('[BOT] Mis en pause (Master Switch désactivé)');
    } else if (command === 'RESUME') {
        // Utiliser le master switch du profileManager
        await profileManager.toggleMasterSwitch(true);
        botPaused = false;
        saveBotState();
        console.log('[BOT] Reprise (Master Switch activé)');
    } else if (command === 'RELOAD_CONFIG') {
        // Recharger la configuration des contacts
        try {
            await profileManager.loadConfig();
            console.log('[BOT] ✅ Configuration des contacts rechargée');
            // Afficher un résumé des contacts
            const contacts = Object.entries(profileManager.config.contacts);
            contacts.forEach(([id, contact]) => {
                console.log(`[BOT] - ${contact.name}: enabled=${contact.enabled}, autoCorrect=${contact.features.autoCorrect}, autoReply=${contact.features.autoReply}`);
            });
        } catch (error) {
            console.error('[BOT] ❌ Erreur rechargement config:', error);
        }
    } else if (command.startsWith('AUTOCORRECT:')) {
        const enabled = command.split(':')[1] === 'true';
        autoCorrectEnabled = enabled;
        saveBotState();
        console.log(`[BOT] Auto-correction globale: ${enabled ? 'activée' : 'désactivée'}`);
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

// Fin du code principal
// Les routes Express ont été déplacées vers server.js

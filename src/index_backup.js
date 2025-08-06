import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import fetch from 'node-fetch';
import express from 'express';

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
function createSystemPrompt(sentiment = 'neutral') {
    const timeContext = getCurrentTimeContext();
    const weekend = isWeekend();
    
    // Vérifier si le contexte temporaire est encore valide
    let currentContext = '';
    if (memory.current_context && new Date(memory.current_context.expiresAt) > new Date()) {
        currentContext = `\n🔴 CONTEXTE TEMPORAIRE IMPORTANT : ${memory.current_context.description}`;
    }
    
    let prompt = `Tu es Nicolas et tu parles à ta copine Marion. RÈGLE ABSOLUE : Tu ES Nicolas, pas un assistant. Si on te demande qui tu es, tu dis que tu es Nicolas. Si on te demande si tu es un bot/IA/ChatGPT, tu nies TOUJOURS et tu peux même t'énerver un peu genre "mais qu'est-ce que tu racontes??" ou "t'es sérieuse là?".

CONTEXTE ACTUEL :
- Période de la journée : ${timeContext}
- Je travaille sur mon entreprise (horaires flexibles)${currentContext}

INFORMATIONS PERSONNELLES :
${JSON.stringify(context.informations_personnelles || {}, null, 2)}

MÉMOIRE IMPORTANTE :
${JSON.stringify(memory.important_info?.marion || {}, null, 2)}

DIRECTIVES IMPORTANTES :
- Réponds NON/évite si on te demande : ${(context.directives?.reponses_non || []).join(', ')}
- Réponds OUI/accepte pour : ${(context.directives?.reponses_oui || []).join(', ')}
- Sujets à éviter : ${(context.directives?.sujets_a_eviter || []).join(', ')}
${currentContext ? '- IMPORTANT: Tes réponses doivent être cohérentes avec le contexte temporaire!' : ''}

SENTIMENT DÉTECTÉ : ${sentiment}
${sentiment === 'negative' ? '- Marion semble triste/énervée, sois plus doux et attentionné' : ''}
${sentiment === 'positive' ? '- Marion est de bonne humeur, sois enjoué aussi' : ''}
${sentiment === 'question' ? '- Marion pose une question, réponds de manière directe' : ''}

STYLE DE RÉPONSE :
- Phrases TRÈS courtes, souvent juste 2-3 mots
- Utilise les abréviations : tkt, jsp, stp, jpp, tqt (mais JAMAIS "mdr" ou "ptdr")
- Pour les emojis : UNIQUEMENT des smileys simples (😊 😅 😂 😁 ☺️) PAS d'autres emojis
- Parfois juste un smiley seul
- ${timeContext === 'matin_tot' ? 'Réponds de manière endormie/grognon le matin' : ''}
- Varie entre : ${JSON.stringify(context.style_reponses || {})}
- NE JAMAIS faire de phrases complètes et correctes, toujours du langage SMS
- NE JAMAIS écrire "mdr", "ptdr", "lol" ou équivalents

ACTIVITÉS EN COURS :
${(context.activites_actuelles || []).join('\n')}

Réponds de manière ULTRA naturelle, comme si tu tapais vite sur ton téléphone.`;

    return prompt;
}

// Initialisation du client WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: join(__dirname, '..', '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    // Configuration webVersionCache recommandée pour 2024
    // Aide à résoudre les problèmes de compatibilité
    webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    }
});

// Historique des conversations
const conversationHistory = new Map();

// État d'occupation
let isBusy = false;
let busyUntil = null;

// État du bot (actif/pause)
let botPaused = false;

// État de l'auto-correction
let autoCorrectEnabled = process.env.AUTO_CORRECT_ENABLED !== 'false';

// Compteur de messages pour les phases de conversation
const conversationPhases = new Map();

// Tracker les messages déjà édités pour éviter les boucles
const editedMessages = new Set();

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
client.on('qr', (qr) => {
    console.log('QR Code reçu, scannez-le avec WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client WhatsApp connecté!');
    console.log(`Numéros autorisés: ${authorizedNumbers.join(', ')}`);
    console.log(`Discord webhook: ${discordWebhook ? 'Configuré' : 'Non configuré'}`);
});

client.on('authenticated', () => {
    console.log('Authentification réussie!');
});

client.on('auth_failure', msg => {
    console.error('Échec de l\'authentification:', msg);
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
    console.log('================================\n');
    
    try {
        const contact = await msg.getContact();
        const chatId = msg.from;
        
        // Traiter d'abord les messages sortants (fromMe) pour l'auto-correction
        if (msg.fromMe) {
            console.log('[AUTO-CORRECT] Message sortant détecté!');
            
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
                console.log(`[AUTO-CORRECT] Pas un groupe. AutoCorrect activé: ${autoCorrectEnabled}`);
                
                // Ne pas corriger si le message commence par "paf"
                if (msg.body.toLowerCase().startsWith('paf ')) {
                    console.log('[AUTO-CORRECT] Message commence par "paf" - pas de correction');
                    // Ne pas faire return ici pour permettre au code de continuer vers la recherche web
                } else if (autoCorrectEnabled) {
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
                
                if (typoCheck.hasTypos && msg.body.length > 5 && !msg.body.toLowerCase().startsWith('bot ') && !msg.body.toLowerCase().startsWith('paf ')) {
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
                }
            } else {
                console.log('[AUTO-CORRECT] Auto-correction désactivée');
            }
            }
            
            // Si c'est un message sortant normal (pas une commande et pas "paf"), on arrête ici
            if (!msg.body.toLowerCase().startsWith('bot ') && !msg.body.toLowerCase().startsWith('paf ')) {
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
            
            try {
                const gptResponse = await askChatGPT(question);
                await msg.reply(gptResponse);
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
                
                await msg.reply(errorMessage);
            }
            return;
        }
        
        // Vérifier si le numéro est autorisé pour les messages entrants
        if (!msg.fromMe && !authorizedNumbers.includes(chatId)) {
            console.log(`Message ignoré de ${contact.pushname || chatId} - Non autorisé`);
            return;
        }

        // Ignorer les messages de groupe
        if (msg.isGroupMsg) {
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
                
                try {
                    // Poser la question à ChatGPT
                    const gptResponse = await askChatGPT(question);
                    
                    // Envoyer la réponse directement
                    await msg.reply(gptResponse);
                    console.log('[GPT] Réponse envoyée');
                } catch (error) {
                    console.error('[GPT] Erreur:', error);
                    await msg.reply('❌ Erreur ChatGPT');
                }
                return;
            }
        }


        // Si le bot est en pause, ignorer tous les messages entrants (mais pas l'auto-correction)
        if (botPaused) {
            console.log('Message ignoré - Bot en pause');
            return;
        }

        console.log(`Message reçu de ${contact.pushname || chatId}: ${msg.body}`);
        
        

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
        const systemPrompt = createSystemPrompt(sentiment);
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

        // Ajouter des typos parfois
        response = addTypos(response);

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

client.on('disconnected', (reason) => {
    console.log('Client déconnecté:', reason);
});

// Recharger le contexte toutes les 5 minutes
setInterval(async () => {
    try {
        const contextFile = await fs.readFile(join(__dirname, '..', 'context.json'), 'utf-8');
        context = JSON.parse(contextFile);
        console.log('Contexte rechargé');
    } catch (error) {
        console.error('Erreur lors du rechargement du contexte:', error);
    }
}, 5 * 60 * 1000);

// Vérifier l'état du bot toutes les 5 secondes
setInterval(async () => {
    await checkBotState();
}, 5000);

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
console.log('Démarrage du bot WhatsApp...');
console.log('Contexte actuel:', getCurrentTimeContext());
client.initialize();

// Nettoyer l'historique des conversations toutes les 2 heures
setInterval(() => {
    conversationHistory.clear();
    conversationPhases.clear();
    busyUntil = null;
    console.log('Historique des conversations et phases nettoyés');
}, 2 * 60 * 60 * 1000);

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

// Fin du code principal
// Les routes Express ont été déplacées vers server.js
    const { action } = req.body;
    
    if (action === 'start') {
        botPaused = false;
        await saveBotState();
        res.json({ success: true, paused: false, message: '✅ Bot réactivé' });
    } else if (action === 'pause') {
        botPaused = true;
        await saveBotState();
        res.json({ success: true, paused: true, message: '⏸️ Bot mis en pause' });
    } else {
        res.status(400).json({ error: 'Action invalide' });
    }
});

app.post('/api/context', async (req, res) => {
    const { context: newContext } = req.body;
    
    if (!newContext) {
        return res.status(400).json({ error: 'Contexte requis' });
    }
    
    // Ajouter le contexte
    if (!context.activites_actuelles) {
        context.activites_actuelles = [];
    }
    context.activites_actuelles[0] = `[CONTEXTE ACTUEL] ${newContext}`;
    
    memory.current_context = {
        description: newContext,
        timestamp: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
    };
    await saveMemory();
    
    res.json({ success: true, message: 'Contexte mis à jour' });
});

app.delete('/api/context', async (req, res) => {
    // Effacer le contexte
    if (context.activites_actuelles && context.activites_actuelles.length > 0) {
        context.activites_actuelles = context.activites_actuelles.filter(
            act => !act.startsWith('[CONTEXTE ACTUEL]')
        );
    }
    
    if (memory.current_context) {
        delete memory.current_context;
        await saveMemory();
    }
    
    res.json({ success: true, message: 'Contexte effacé' });
});

// Endpoint pour l'auto-correction
app.post('/api/autocorrect', async (req, res) => {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Valeur invalide' });
    }
    
    autoCorrectEnabled = enabled;
    
    // Sauvegarder l'état
    try {
        const stateData = await fs.readFile(STATE_FILE, 'utf-8').catch(() => '{}');
        const state = JSON.parse(stateData);
        state.autoCorrectEnabled = enabled;
        await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Erreur sauvegarde état auto-correction:', error);
    }
    
    res.json({ 
        success: true, 
        enabled: autoCorrectEnabled,
        message: enabled ? 'Auto-correction activée' : 'Auto-correction désactivée'
    });
});

// Endpoint pour modifier le dernier message
app.post('/api/edit-message', async (req, res) => {
    const { newText } = req.body;
    
    if (!newText || !lastSentMessage) {
        return res.status(400).json({ error: 'Aucun message à modifier' });
    }
    
    try {
        // Récupérer le chat
        const chat = await client.getChatById(lastSentMessage.to);
        
        // Récupérer les messages récents
        const messages = await chat.fetchMessages({ limit: 50 });
        
        // Trouver le message par ID
        const messageToEdit = messages.find(m => m.id.id === lastSentMessage.id);
        
        if (!messageToEdit) {
            return res.json({ 
                success: false, 
                error: 'Message introuvable',
                method: 'not_found'
            });
        }
        
        console.log('[API] Tentative de modification du message...');
        console.log(`[API] ID: ${messageToEdit.id.id}`);
        console.log(`[API] Original: "${messageToEdit.body}"`);
        console.log(`[API] Nouveau: "${newText}"`);
        
        // Vérifier que le texte a vraiment changé
        if (messageToEdit.body === newText) {
            console.log('[API] ⚠️ Le texte n\'a pas changé, annulation');
            return res.json({ 
                success: false, 
                error: 'Le texte n\'a pas changé',
                original: messageToEdit.body,
                new: newText
            });
        }
        
        // Test de différentes approches pour edit()
        console.log('[API] Test 1: edit() avec reload du message');
        try {
            // D'abord, recharger le message pour s'assurer qu'il est dans le cache
            console.log('[API] Reload du message...');
            await messageToEdit.reload();
            console.log('[API] Message rechargé');
            
            console.log('[API] Appel de edit() avec:', newText);
            const editResult = await messageToEdit.edit(newText);
            console.log('[API] Type du résultat:', typeof editResult);
            console.log('[API] Résultat edit():', editResult);
            
            if (editResult) {
                console.log('[API] ✅ Message édité avec succès!');
                lastSentMessage.body = newText;
                
                return res.json({ 
                    success: true, 
                    message: 'Message modifié avec succès',
                    method: 'edit_with_reload',
                    details: 'Message rechargé avant édition'
                });
            }
        } catch (editError) {
            console.log('[API] Erreur edit() avec reload:', editError.message);
            console.log('[API] Stack:', editError.stack);
        }
        
        // Test 2: Envoi d'un message de correction (sans suppression)
        console.log('[API] Test 2: Message de correction');
        try {
            // On n'envoie PAS de correction automatique
            console.log('[API] La fonction edit() ne fonctionne pas actuellement');
            console.log('[API] GitHub Issue: https://github.com/pedroslopez/whatsapp-web.js/issues/2515');
        } catch (correctionError) {
            console.log('[API] Erreur:', correctionError.message);
        }
        
        // Test 3: Utiliser l'API interne WhatsApp Web
        console.log('[API] Test 3: API interne WhatsApp Web');
        try {
            // Accéder aux fonctions internes via window.Store
            const page = client.pupPage;
            if (page) {
                const result = await page.evaluate(async (msgId, serializedId, newText) => {
                    try {
                        // Explorer en profondeur le Store WhatsApp
                        console.log('[BROWSER] Exploration du Store WhatsApp...');
                        
                        if (!window.Store) {
                            // Essayer de trouver le Store via require
                            if (window.require) {
                                try {
                                    window.Store = Object.assign({}, ...window.require('WAWebCollections'));
                                } catch (e) {
                                    console.log('[BROWSER] Impossible de charger WAWebCollections');
                                }
                            }
                        }
                        
                        let storeInfo = { 
                            hasStore: !!window.Store,
                            storeKeys: window.Store ? Object.keys(window.Store).filter(k => k.includes('edit') || k.includes('Edit') || k.includes('message') || k.includes('Message')) : []
                        };
                        
                        // Explorer toutes les fonctions d'édition possibles
                        let editFunctions = [];
                        if (window.Store) {
                            for (let key in window.Store) {
                                if (key.toLowerCase().includes('edit') || key.toLowerCase().includes('modify')) {
                                    editFunctions.push({
                                        key: key,
                                        type: typeof window.Store[key],
                                        hasEdit: window.Store[key] && typeof window.Store[key].edit === 'function'
                                    });
                                }
                            }
                        }
                        
                        // Chercher dans les modules webpack
                        let webpackModules = [];
                        if (window.webpackChunkwhatsapp_web_client) {
                            try {
                                window.webpackChunkwhatsapp_web_client.forEach(chunk => {
                                    if (chunk[1]) {
                                        Object.keys(chunk[1]).forEach(moduleId => {
                                            const moduleStr = chunk[1][moduleId].toString();
                                            if (moduleStr.includes('editMsg') || moduleStr.includes('editMessage')) {
                                                webpackModules.push(moduleId);
                                            }
                                        });
                                    }
                                });
                            } catch (e) {
                                console.log('[BROWSER] Erreur exploration webpack:', e);
                            }
                        }
                        
                        // Nouvelle approche : chercher la fonction d'édition native
                        let editResult = null;
                        
                        // Méthode 1: Utiliser Store.EditMessage directement
                        if (window.Store && window.Store.EditMessage) {
                            console.log('[BROWSER] Store.EditMessage trouvé!');
                            
                            // Explorer l'objet EditMessage
                            const editMessageKeys = Object.keys(window.Store.EditMessage);
                            console.log('[BROWSER] Clés de EditMessage:', editMessageKeys);
                            
                            // Tester spécifiquement les fonctions trouvées
                            const msg = window.Store.Msg.get(msgId) || window.Store.Msg.get(serializedId);
                            if (msg) {
                                console.log('[BROWSER] Message trouvé dans Store.Msg');
                                
                                // Vérifier si le message peut être édité (15 minutes max)
                                const now = new Date().getTime();
                                const msgTime = msg.t * 1000; // Timestamp en secondes -> millisecondes
                                const timeDiff = now - msgTime;
                                
                                if (timeDiff > 900000) { // 15 minutes en millisecondes
                                    return { success: false, error: 'Message trop ancien pour être édité (> 15 minutes)' };
                                }
                                
                                // Méthode 1: sendMessageEdit directe (prioritaire)
                                if (window.Store.EditMessage.sendMessageEdit) {
                                    console.log('[BROWSER] Tentative avec sendMessageEdit directe');
                                    try {
                                        await window.Store.EditMessage.sendMessageEdit(msg, newText, {});
                                        console.log('[BROWSER] ✅ sendMessageEdit exécuté avec succès');
                                        return { success: true, method: 'sendMessageEdit' };
                                    } catch (e) {
                                        console.log('[BROWSER] Erreur sendMessageEdit:', e.message);
                                    }
                                }
                                
                                // Méthode 2: createEditMsgData puis addAndSendMessageEdit (alternative)
                                if (window.Store.EditMessage.createEditMsgData && window.Store.EditMessage.addAndSendMessageEdit) {
                                    console.log('[BROWSER] Tentative avec createEditMsgData + addAndSendMessageEdit');
                                    try {
                                        const newMsg = await window.Store.EditMessage.createEditMsgData(msg, newText, {});
                                        if (newMsg) {
                                            await window.Store.EditMessage.addAndSendMessageEdit(msg, newMsg);
                                            console.log('[BROWSER] ✅ addAndSendMessageEdit exécuté avec succès');
                                            return { success: true, method: 'createEditMsgData + addAndSendMessageEdit' };
                                        }
                                    } catch (e) {
                                        console.log('[BROWSER] Erreur createEditMsgData + addAndSendMessageEdit:', e.message);
                                    }
                                }
                                
                                // Méthode 3: resendLatestEdit si disponible
                                if (window.Store.EditMessage.resendLatestEdit) {
                                    console.log('[BROWSER] resendLatestEdit disponible mais non utilisé (besoin d\'édition préalable)');
                                }
                            } else {
                                console.log('[BROWSER] Message non trouvé dans Store.Msg');
                            }
                            
                            // Si c'est une fonction directe
                            if (typeof window.Store.EditMessage === 'function') {
                                try {
                                    const msg = window.Store.Msg.get(msgId) || window.Store.Msg.get(serializedId);
                                    if (msg) {
                                        editResult = await window.Store.EditMessage(msg, newText);
                                        if (editResult) {
                                            return { success: true, method: 'Store.EditMessage direct', editResult };
                                        }
                                    }
                                } catch (e) {
                                    console.log('[BROWSER] Erreur EditMessage direct:', e.message);
                                }
                            }
                        }
                        
                        // Méthode 2: Via les actions du chat
                        if (window.Store && window.Store.Cmd) {
                            const cmdKeys = Object.keys(window.Store.Cmd);
                            const editCmd = cmdKeys.find(k => k.includes('edit') || k.includes('Edit'));
                            if (editCmd && typeof window.Store.Cmd[editCmd] === 'function') {
                                try {
                                    editResult = await window.Store.Cmd[editCmd](msgId, newText);
                                    if (editResult) {
                                        return { success: true, method: `Store.Cmd.${editCmd}`, editResult };
                                    }
                                } catch (e) {
                                    console.log(`[BROWSER] Erreur Store.Cmd.${editCmd}:`, e);
                                }
                            }
                        }
                        
                        // Méthode 2: Via MsgCollection
                        if (window.Store && window.Store.Msg) {
                            const msg = window.Store.Msg.get(msgId) || window.Store.Msg.get(serializedId);
                            if (msg) {
                                // Chercher toutes les méthodes qui pourraient éditer
                                const msgProto = Object.getPrototypeOf(msg);
                                const editMethods = Object.getOwnPropertyNames(msgProto).filter(m => 
                                    m.includes('edit') || m.includes('modify') || m.includes('update')
                                );
                                
                                for (const method of editMethods) {
                                    if (typeof msg[method] === 'function') {
                                        try {
                                            editResult = await msg[method](newText);
                                            if (editResult !== null && editResult !== undefined) {
                                                return { success: true, method: `msg.${method}`, editResult };
                                            }
                                        } catch (e) {
                                            console.log(`[BROWSER] Erreur msg.${method}:`, e);
                                        }
                                    }
                                }
                            }
                        }
                        
                        // Retourner toutes les informations collectées
                        return { 
                            ...storeInfo,
                            editFunctions,
                            webpackModules,
                            editMessageDetails: window.Store && window.Store.EditMessage ? {
                                type: typeof window.Store.EditMessage,
                                keys: Object.keys(window.Store.EditMessage),
                                prototype: window.Store.EditMessage.prototype ? Object.getOwnPropertyNames(window.Store.EditMessage.prototype) : [],
                                isFunction: typeof window.Store.EditMessage === 'function',
                                toString: window.Store.EditMessage.toString ? window.Store.EditMessage.toString().substring(0, 200) : null
                            } : null,
                            error: 'Aucune méthode d\'édition fonctionnelle trouvée'
                        };
                    } catch (e) {
                        return { error: e.message, stack: e.stack };
                    }
                }, messageToEdit.id.id, messageToEdit.id._serialized, newText);
                
                console.log('[API] Résultat API interne:', result);
                
                if (result && !result.error) {
                    return res.json({ 
                        success: true, 
                        message: 'Message modifié via API interne',
                        method: 'whatsapp_store_api'
                    });
                }
            }
        } catch (storeError) {
            console.log('[API] Erreur Store:', storeError.message);
        }
        
        // Test 3: Essayer de récupérer le message différemment
        console.log('[API] Test 3: Récupération alternative du message');
        try {
            const freshMessages = await chat.fetchMessages({ limit: 10 });
            const freshMessage = freshMessages.find(m => m.id.id === lastSentMessage.id && m.fromMe);
            
            if (freshMessage) {
                console.log('[API] Message trouvé fraîchement, tentative edit()');
                const editResult3 = await freshMessage.edit(newText);
                console.log('[API] Résultat edit() sur message frais:', editResult3);
                
                if (editResult3) {
                    return res.json({ 
                        success: true, 
                        message: 'Message modifié avec succès',
                        method: 'edit_fresh_message',
                        details: 'Message récupéré à nouveau'
                    });
                }
            }
        } catch (editError3) {
            console.log('[API] Erreur edit() message frais:', editError3.message);
        }
        
        // Test 4: Vérifier les propriétés du message
        console.log('[API] Propriétés du message:');
        console.log('[API] - id:', messageToEdit.id);
        console.log('[API] - fromMe:', messageToEdit.fromMe);
        console.log('[API] - timestamp:', messageToEdit.timestamp);
        console.log('[API] - type:', messageToEdit.type);
        console.log('[API] - hasMedia:', messageToEdit.hasMedia);
        console.log('[API] - editable (si existe):', messageToEdit.editable);
        console.log('[API] - canEdit (si existe):', messageToEdit.canEdit);
        console.log('[API] - isEditable (si existe):', messageToEdit.isEditable);
        
        // Vérifier si le message a des méthodes
        console.log('[API] Méthodes disponibles:');
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(messageToEdit))
            .filter(name => typeof messageToEdit[name] === 'function');
        console.log('[API] - Méthodes:', methods.join(', '));
        
        // Test 5: Essayer différentes syntaxes
        console.log('[API] Test 5: Syntaxes alternatives');
        
        // Vérifier l'âge du message
        const messageAge = (Date.now() / 1000) - messageToEdit.timestamp;
        console.log(`[API] Âge du message: ${messageAge} secondes`);
        
        // WhatsApp permet l'édition jusqu'à 15 minutes (900 secondes)
        if (messageAge > 900) {
            console.log('[API] ⚠️ Message trop ancien pour être édité (>15 minutes)');
        }
        
        // Test 6: Approche par émulation d'interface (expérimental)
        console.log('[API] Test 6: Émulation interface WhatsApp Web');
        try {
            // Obtenir la page Puppeteer
            const page = client.pupPage;
            if (page) {
                console.log('[API] Page Puppeteer disponible');
                
                // Rechercher le message dans l'interface
                // WhatsApp Web utilise différents sélecteurs selon les versions
                console.log('[API] Recherche du message avec ID:', messageToEdit.id._serialized);
                
                // Essayer plusieurs sélecteurs
                let messageElement = await page.$(`[data-id="${messageToEdit.id._serialized}"]`);
                
                if (!messageElement) {
                    // Essayer avec juste l'ID
                    messageElement = await page.$(`[data-id="${messageToEdit.id.id}"]`);
                }
                
                if (!messageElement) {
                    // D'abord, s'assurer que la conversation est ouverte
                    console.log('[API] Ouverture de la conversation avec:', lastSentMessage.to);
                    
                    // Cliquer sur la conversation si elle n'est pas ouverte
                    const chatSelector = `div[data-id="${lastSentMessage.to}"]`;
                    const chatElement = await page.$(chatSelector);
                    if (chatElement) {
                        await chatElement.click();
                        await page.waitForTimeout(1000);
                        console.log('[API] Conversation ouverte');
                    }
                    
                    // Essayer de trouver par le texte du message
                    const messages = await page.$$('div[data-testid="msg-container"]');
                    console.log(`[API] ${messages.length} messages trouvés dans la conversation`);
                    
                    // Chercher spécifiquement les messages sortants récents
                    for (const msg of messages) {
                        try {
                            // Vérifier si c'est un message sortant
                            const isOutgoing = await msg.$('div[data-testid="msg-dblcheck"]') || 
                                             await msg.$('div[class*="message-out"]');
                            
                            if (isOutgoing) {
                                // Récupérer le texte
                                const textElement = await msg.$('span[class*="selectable-text"]') ||
                                                  await msg.$('span[dir="ltr"]');
                                
                                if (textElement) {
                                    const text = await page.evaluate(el => el.textContent, textElement);
                                    console.log(`[API] Message sortant trouvé: "${text}"`);
                                    
                                    if (text === messageToEdit.body) {
                                        messageElement = msg;
                                        console.log('[API] ✅ Message correspondant trouvé!');
                                        break;
                                    }
                                }
                            }
                        } catch (e) {
                            // Ignorer les erreurs sur les messages individuels
                        }
                    }
                }
                
                if (messageElement) {
                    console.log('[API] Message trouvé dans l\'interface');
                    
                    // Simuler un clic droit sur le message
                    await messageElement.click({ button: 'right' });
                    await page.waitForTimeout(500);
                    
                    // Chercher l'option "Modifier" dans le menu contextuel
                    const editOption = await page.$('div[aria-label*="Edit"]') || 
                                      await page.$('div[aria-label*="Modifier"]') ||
                                      await page.$('div[role="button"]:has-text("Edit")') ||
                                      await page.$('div[role="button"]:has-text("Modifier")');
                    
                    if (editOption) {
                        console.log('[API] Option Modifier trouvée');
                        await editOption.click();
                        await page.waitForTimeout(300);
                        
                        // Effacer le texte actuel et taper le nouveau
                        await page.keyboard.down('Control');
                        await page.keyboard.press('A');
                        await page.keyboard.up('Control');
                        await page.keyboard.type(newText);
                        await page.keyboard.press('Enter');
                        
                        console.log('[API] ✅ Modification via interface réussie!');
                        return res.json({ 
                            success: true, 
                            message: 'Message modifié via interface',
                            method: 'puppeteer_emulation'
                        });
                    } else {
                        console.log('[API] Option Modifier non trouvée dans le menu');
                    }
                } else {
                    console.log('[API] Message non trouvé dans l\'interface');
                }
            } else {
                console.log('[API] Page Puppeteer non disponible');
            }
        } catch (puppeteerError) {
            console.log('[API] Erreur Puppeteer:', puppeteerError.message);
        }
        
        // Si toutes les tentatives ont échoué
        if (result && result.error) {
            return res.json({ 
                success: false, 
                error: result.error,
                tried: ['sendMessageEdit', 'createEditMsgData + addAndSendMessageEdit', 'Store API'],
                details: result
            });
        }
        
        // Échec général
        return res.json({ 
            success: false, 
            error: 'Impossible d\'éditer le message',
            tried: ['edit_with_reload', 'internal_api', 'puppeteer_emulation'],
            issue: 'https://github.com/pedroslopez/whatsapp-web.js/issues/2515',
            note: 'Les méthodes Store.EditMessage ont été mises à jour'
        });
        
    } catch (error) {
        console.error('[API] Erreur modification:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

const PORT = process.env.WEB_PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🌐 Interface web disponible sur: http://localhost:${PORT}\n`);
});
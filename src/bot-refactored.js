import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import profileManager from './profileManager.js';
import { getGoogleCalendarTool, executeCalendarAction } from '../google-calendar-tool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// Configuration
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// ============================================
// CLASSE PRINCIPALE DU BOT
// ============================================
class WhatsAppBot {
    constructor() {
        // État du bot
        this.isRunning = false;
        this.isPaused = false;
        this.autoCorrectEnabled = true;
        
        // WhatsApp client
        this.client = null;
        
        // Contexte temporaire
        this.temporaryContext = null;
        this.temporaryContextExpiry = null;
        
        // Tracking des messages
        this.pafResponses = new Set(); // Messages qui ne doivent pas être auto-corrigés
        this.processedMessages = new Set(); // Éviter les doublons
        
        // État de connexion
        this.isAuthenticated = false;
        this.isReady = false;
    }

    // ============================================
    // INITIALISATION
    // ============================================
    async initialize() {
        console.log('🚀 Initialisation du bot WhatsApp...');
        
        // Charger la configuration des contacts
        await profileManager.loadConfig();
        console.log('✅ Configuration des contacts chargée');
        
        // Créer le client WhatsApp
        this.client = new Client({
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
                ]
            }
        });

        // Configurer les événements
        this.setupEventHandlers();
        
        // Démarrer le client
        try {
            await this.client.initialize();
            this.isRunning = true;
            console.log('✅ Bot initialisé avec succès');
        } catch (error) {
            console.error('❌ Erreur lors de l\'initialisation:', error);
            throw error;
        }
    }

    // ============================================
    // GESTION DES ÉVÉNEMENTS WHATSAPP
    // ============================================
    setupEventHandlers() {
        // QR Code
        this.client.on('qr', (qr) => {
            console.log('📱 Scannez ce QR code avec WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        // Authentification réussie
        this.client.on('authenticated', () => {
            console.log('✅ Authentification réussie!');
            this.isAuthenticated = true;
        });

        // Client prêt
        this.client.on('ready', () => {
            console.log('✅ WhatsApp connecté et prêt!');
            this.isReady = true;
        });

        // Déconnexion
        this.client.on('disconnected', (reason) => {
            console.log('❌ WhatsApp déconnecté:', reason);
            this.isReady = false;
            this.isAuthenticated = false;
        });

        // Gestion des messages
        this.client.on('message_create', async (msg) => {
            await this.handleMessage(msg);
        });
    }

    // ============================================
    // GESTIONNAIRE PRINCIPAL DES MESSAGES
    // ============================================
    async handleMessage(msg) {
        try {
            // Éviter de traiter deux fois le même message
            const messageId = msg.id?.id || msg.id?._serialized;
            if (this.processedMessages.has(messageId)) {
                return;
            }
            this.processedMessages.add(messageId);

            // Log détaillé
            console.log('\n=== NOUVEAU MESSAGE ===');
            console.log(`From: ${msg.from}`);
            console.log(`To: ${msg.to}`);
            console.log(`FromMe: ${msg.fromMe}`);
            console.log(`Body: "${msg.body}"`);
            console.log(`Type: ${msg.type}`);
            console.log('====================\n');

            // Ignorer les messages de groupe
            if (msg.isGroupMsg) {
                console.log('[SKIP] Message de groupe ignoré');
                return;
            }

            const contact = await msg.getContact();
            const chatId = msg.fromMe ? msg.to : msg.from;

            // Traiter selon le type de message
            if (msg.fromMe) {
                await this.handleOutgoingMessage(msg, contact, chatId);
            } else {
                await this.handleIncomingMessage(msg, contact, chatId);
            }

        } catch (error) {
            console.error('❌ Erreur lors du traitement du message:', error);
        }
    }

    // ============================================
    // MESSAGES SORTANTS (fromMe = true)
    // ============================================
    async handleOutgoingMessage(msg, contact, chatId) {
        console.log('[OUTGOING] Traitement message sortant');

        // 1. Vérifier si c'est une commande "paf"
        if (msg.body.toLowerCase().startsWith('paf ')) {
            console.log('[PAF] Commande paf détectée');
            await this.handlePafCommand(msg, false);
            return;
        }

        // 2. Auto-correction (si activée)
        if (this.autoCorrectEnabled && !this.pafResponses.has(msg.id?.id)) {
            await this.handleAutoCorrection(msg, chatId);
        }
    }

    // ============================================
    // MESSAGES ENTRANTS (fromMe = false)
    // ============================================
    async handleIncomingMessage(msg, contact, chatId) {
        console.log('[INCOMING] Traitement message entrant');

        // 1. Vérifier si c'est une commande "paf"
        if (msg.body.toLowerCase().startsWith('paf ')) {
            console.log('[PAF] Commande paf détectée');
            await this.handlePafCommand(msg, true);
            return;
        }

        // 2. Vérifier si le bot est en pause (Master Switch)
        if (this.isPaused || !profileManager.config.globalSettings.masterSwitch) {
            console.log('[SKIP] Bot en pause ou Master Switch désactivé');
            return;
        }

        // 3. Vérifier si le contact est activé
        const profile = profileManager.getProfileByNumberSync(chatId);
        
        if (!profile) {
            // Pas de profil = comportement par défaut
            if (!profileManager.config.globalSettings.defaultEnabled) {
                console.log(`[SKIP] Contact non configuré et comportement par défaut désactivé`);
                return;
            }
        } else {
            // Vérifier si le contact est activé
            if (!profile.enabled || !profile.features.autoReply) {
                console.log(`[SKIP] Contact ${profile.name} désactivé ou autoReply désactivé`);
                return;
            }
        }

        // 4. Répondre automatiquement
        console.log('[AUTO-REPLY] Génération de la réponse automatique');
        await this.generateAutoReply(msg, contact, chatId, profile);
    }

    // ============================================
    // FONCTIONNALITÉ "PAF" - ACCÈS DIRECT À CHATGPT
    // ============================================
    async handlePafCommand(msg, isIncoming) {
        const question = msg.body.replace(/^paf /i, '').trim();
        
        if (!question) {
            console.log('[PAF] Pas de question fournie');
            return;
        }

        console.log(`[PAF] Question: "${question}"`);
        
        try {
            // Indiquer que le bot tape
            const chat = await msg.getChat();
            await chat.sendStateTyping();

            // Récupérer l'historique de conversation
            const messages = await chat.fetchMessages({ limit: 10 });
            const chatHistory = messages
                .filter(m => m.timestamp < msg.timestamp)
                .sort((a, b) => a.timestamp - b.timestamp)
                .slice(-5)
                .map(m => ({
                    fromMe: m.fromMe,
                    body: m.body
                }));

            // Appeler ChatGPT avec les outils disponibles
            const response = await this.callChatGPTWithTools(question, chatHistory);
            
            // Envoyer la réponse (sans reply/mention)
            await chat.sendMessage('🤖 ' + response);
            
            // Note: Plus besoin de marquer les réponses paf car on n'a plus replyMsg
            
            console.log('[PAF] Réponse envoyée');
            
        } catch (error) {
            console.error('[PAF] Erreur:', error);
            await msg.getChat().then(chat => chat.sendMessage('❌ Erreur ChatGPT'));
        }
    }

    // ============================================
    // AUTO-CORRECTION DES MESSAGES SORTANTS
    // ============================================
    async handleAutoCorrection(msg, recipientId) {
        // Si l'auto-correction globale est activée, elle s'applique à TOUS
        if (!this.autoCorrectEnabled) {
            console.log('[AUTO-CORRECT] Désactivé globalement');
            return;
        }

        // Pas besoin de vérifier par contact - si c'est activé globalement, ça marche pour tous
        console.log('[AUTO-CORRECT] Activé globalement - correction pour tous');

        console.log('[AUTO-CORRECT] Analyse du message...');

        try {
            // Récupérer le contexte de conversation
            const chat = await msg.getChat();
            const messages = await chat.fetchMessages({ limit: 10 });
            const previousMessages = messages
                .filter(m => m.timestamp < msg.timestamp)
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 5)
                .reverse()
                .map(m => ({
                    from: m.fromMe ? 'Moi' : 'Contact',
                    body: m.body
                }));

            // Détecter les fautes
            const correction = await this.detectTypos(msg.body, previousMessages);
            
            if (correction.hasTypos && correction.correctedText !== msg.body) {
                console.log(`[AUTO-CORRECT] Correction: "${msg.body}" → "${correction.correctedText}"`);
                
                // Éditer le message
                await this.editMessage(msg, correction.correctedText);
            } else {
                console.log('[AUTO-CORRECT] Aucune correction nécessaire');
            }
            
        } catch (error) {
            console.error('[AUTO-CORRECT] Erreur:', error);
        }
    }

    // ============================================
    // GÉNÉRATION DE RÉPONSE AUTOMATIQUE
    // ============================================
    async generateAutoReply(msg, contact, chatId, profile) {
        try {
            // Indiquer que le bot tape
            const chat = await msg.getChat();
            await chat.sendStateTyping();

            // Préparer le contexte
            const context = this.buildContext();
            const sentiment = this.analyzeSentiment(msg.body);
            
            // Générer le prompt
            const systemPrompt = this.generateSystemPrompt(profile, contact, sentiment, context);
            
            // Récupérer l'historique
            const messages = await chat.fetchMessages({ limit: 15 });
            const history = messages
                .filter(m => m.timestamp <= msg.timestamp)
                .sort((a, b) => a.timestamp - b.timestamp)
                .slice(-10)
                .map(m => ({
                    role: m.fromMe ? 'assistant' : 'user',
                    content: m.body
                }));

            // Appeler GPT
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...history
                ],
                temperature: 0.9,
                max_tokens: 150
            });

            const response = completion.choices[0].message.content;
            
            // Délais réalistes avec phases de conversation
            const delays = this.calculateDelay(response.length, chatId);
            
            // Phase 1: Temps de réflexion (pas d'indicateur)
            console.log(`[AUTO-REPLY] Attente: ${delays.thinkingDelay/1000}s`);
            await new Promise(resolve => setTimeout(resolve, delays.thinkingDelay));
            
            // Phase 2: Frappe du message
            console.log(`[AUTO-REPLY] Frappe: ${delays.typingDelay/1000}s`);
            await chat.sendStateTyping();
            await new Promise(resolve => setTimeout(resolve, delays.typingDelay));
            
            // Phase 3: Envoi du message (sans reply/mention)
            await chat.clearState();
            await chat.sendMessage(response);
            
            console.log(`[AUTO-REPLY] Réponse envoyée: "${response}"`);
            
        } catch (error) {
            console.error('[AUTO-REPLY] Erreur:', error);
            try {
                const errorChat = await msg.getChat();
                await errorChat.sendMessage("Désolé, mon téléphone bug un peu là");
            } catch (e) {
                console.error('[AUTO-REPLY] Impossible d\'envoyer le message d\'erreur:', e);
            }
        }
    }

    // ============================================
    // APPEL CHATGPT AVEC OUTILS (CALENDAR, WEB)
    // ============================================
    async callChatGPTWithTools(query, chatHistory) {
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

        const tools = [
            {
                type: "function",
                function: {
                    name: "web_search",
                    description: "Rechercher des informations actuelles sur le web",
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

        const messages = [
            {
                role: 'system',
                content: `Tu es ChatGPT sur WhatsApp. Date: ${dateStr}, Heure: ${timeStr}.
Tu as accès à la recherche web et au calendrier Google.
Réponds de manière concise (max 800 caractères).
Utilise des emojis pour la lisibilité.`
            },
            ...chatHistory.map(msg => ({
                role: msg.fromMe ? 'assistant' : 'user',
                content: msg.body
            })),
            { role: 'user', content: query }
        ];

        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: messages,
                tools: tools,
                tool_choice: "auto",
                temperature: 0.7,
                max_tokens: 800
            });

            let responseMessage = completion.choices[0].message;

            // Si GPT demande d'utiliser des outils
            if (responseMessage.tool_calls?.length > 0) {
                const updatedMessages = [...messages, responseMessage];

                for (const toolCall of responseMessage.tool_calls) {
                    if (toolCall.function.name === 'web_search') {
                        const args = JSON.parse(toolCall.function.arguments);
                        console.log(`[GPT] 🌐 Recherche web: "${args.query}"`);
                        
                        updatedMessages.push({
                            tool_call_id: toolCall.id,
                            role: "tool",
                            content: `Utilise tes connaissances pour répondre sur: ${args.query}`
                        });
                    } else if (toolCall.function.name === 'google_calendar') {
                        const args = JSON.parse(toolCall.function.arguments);
                        console.log(`[GPT] 📅 Google Calendar: ${args.action}`);
                        
                        try {
                            const result = await executeCalendarAction(args);
                            updatedMessages.push({
                                tool_call_id: toolCall.id,
                                role: "tool",
                                content: result
                            });
                        } catch (error) {
                            updatedMessages.push({
                                tool_call_id: toolCall.id,
                                role: "tool",
                                content: "❌ Erreur Google Calendar"
                            });
                        }
                    }
                }

                // Obtenir la réponse finale
                const finalCompletion = await openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: updatedMessages,
                    temperature: 0.7,
                    max_tokens: 800
                });

                responseMessage = finalCompletion.choices[0].message;
            }

            return responseMessage.content || "❌ Pas de réponse";
            
        } catch (error) {
            console.error('[GPT] Erreur:', error);
            throw error;
        }
    }

    // ============================================
    // DÉTECTION DE FAUTES DE FRAPPE
    // ============================================
    async detectTypos(text, previousMessages = []) {
        console.log(`[TYPO-DETECT] Analyse: "${text}"`);

        try {
            const contextText = previousMessages.length > 0 
                ? '\n\nCONTEXTE:\n' + previousMessages.map(m => `${m.from}: ${m.body}`).join('\n')
                : '';

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Tu es un correcteur pour WhatsApp. 
RÈGLES:
- Corrige UNIQUEMENT les vraies fautes de frappe
- NE JAMAIS traduire ou changer la langue
- Garde le style SMS et les abréviations (tkt, mdr, etc)
- Ignore les messages commençant par "paf" ou contenant 🤖

Réponds en JSON:
{
  "hasTypos": true/false,
  "correctedText": "texte corrigé",
  "confidence": 0-100
}

Ne corrige que si confiance > 70%.${contextText}`
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                temperature: 0.1,
                max_tokens: 200
            });

            const response = JSON.parse(completion.choices[0].message.content);
            
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
            console.error('[TYPO-DETECT] Erreur:', error);
            return {
                hasTypos: false,
                correctedText: text
            };
        }
    }

    // ============================================
    // ÉDITION DE MESSAGE
    // ============================================
    async editMessage(msg, newText) {
        console.log('[AUTO-CORRECT] Tentative d\'édition avec Store.EditMessage...');
        
        try {
            const page = await this.client.pupPage;
            const result = await page.evaluate(async (msgId, serializedId, newText) => {
                try {
                    // Récupérer le message dans le store
                    let msg = window.Store.Msg.get(msgId);
                    if (!msg && serializedId) {
                        msg = window.Store.Msg.get(serializedId);
                    }
                    
                    if (!msg) {
                        console.log('[BROWSER] Message non trouvé dans le store');
                        return { success: false, error: 'Message non trouvé' };
                    }
                    
                    // Vérifier que c'est bien mon message et qu'il est récent
                    const timeDiff = Date.now() - (msg.t * 1000);
                    console.log(`[BROWSER] Âge du message: ${timeDiff/1000}s`);
                    
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
                } catch (err) {
                    console.error('[BROWSER] Erreur globale:', err);
                    return { success: false, error: err.message };
                }
            }, msg.id.id, msg.id._serialized, newText);
            
            if (result.success) {
                console.log(`[AUTO-CORRECT] ✅ Message édité avec succès (méthode: ${result.method})`);
            } else {
                console.log(`[AUTO-CORRECT] ❌ Échec de l'édition: ${result.error}`);
            }
            
            return result.success;
            
        } catch (error) {
            console.error('[AUTO-CORRECT] Erreur lors de l\'édition:', error);
            return false;
        }
    }

    // ============================================
    // UTILITAIRES
    // ============================================
    generateSystemPrompt(profile, contact, sentiment, context) {
        const basePrompt = profile 
            ? profileManager.generatePrompt(profile.id, sentiment, context)
            : `Tu es Nicolas. Réponds naturellement et brièvement.`;

        return `${basePrompt}

RÈGLE ABSOLUE: Tu ES Nicolas, pas un assistant. 
Si on te demande si tu es un bot/IA, nie catégoriquement.

Style: Messages courts, naturels, comme tapés rapidement sur téléphone.
${context.temporal ? `Contexte actuel: ${context.temporal}` : ''}`;
    }

    buildContext() {
        const context = {
            temporal: null
        };

        // Contexte temporaire
        if (this.temporaryContext && this.temporaryContextExpiry > Date.now()) {
            context.temporal = this.temporaryContext;
        }

        return context;
    }

    analyzeSentiment(message) {
        const lower = message.toLowerCase();
        
        const negative = ['triste', 'mal', 'pleure', 'déprimé', 'énervé', 'fâché'];
        const positive = ['heureux', 'content', 'super', 'génial', 'love', 'parfait'];
        
        if (negative.some(word => lower.includes(word))) return 'negative';
        if (positive.some(word => lower.includes(word))) return 'positive';
        if (lower.includes('?')) return 'question';
        
        return 'neutral';
    }

    calculateDelay(messageLength = 50, chatId) {
        // Système de phases de conversation (rapide -> occupé -> rapide)
        
        // Initialiser ou récupérer l'état de conversation
        if (!this.conversationStates) {
            this.conversationStates = new Map();
        }
        
        const now = Date.now();
        let state = this.conversationStates.get(chatId) || {
            phase: 'active',
            messageCount: 0,
            lastMessageTime: now,
            phaseStartTime: now
        };
        
        // Calculer le temps depuis le dernier message
        const timeSinceLastMessage = now - state.lastMessageTime;
        
        // Si plus de 10 minutes sans message, reset à phase active
        if (timeSinceLastMessage > 10 * 60 * 1000) {
            state = {
                phase: 'active',
                messageCount: 0,
                lastMessageTime: now,
                phaseStartTime: now
            };
        }
        
        let baseDelay;
        let typingTime;
        
        // Gestion des phases
        if (state.phase === 'active') {
            // Phase active : réponses rapides (3-5 messages)
            baseDelay = Math.floor(Math.random() * 5000) + 3000; // 3-8 secondes
            typingTime = Math.floor(Math.random() * 2000) + 1000; // 1-3 secondes
            
            state.messageCount++;
            
            // Après 3-5 messages, passer en phase occupée
            if (state.messageCount >= Math.floor(Math.random() * 3) + 3) {
                state.phase = 'busy';
                state.messageCount = 0;
                state.phaseStartTime = now;
                console.log(`[DELAY] Passage en phase occupée pour ${chatId}`);
            }
            
        } else if (state.phase === 'busy') {
            // Phase occupée : réponses très lentes (1-5 minutes)
            baseDelay = Math.floor(Math.random() * 240000) + 60000; // 1-5 minutes
            typingTime = Math.floor(Math.random() * 3000) + 2000; // 2-5 secondes
            
            state.messageCount++;
            
            // Après 1-2 messages lents, repasser en phase active
            if (state.messageCount >= Math.floor(Math.random() * 2) + 1) {
                state.phase = 'active';
                state.messageCount = 0;
                state.phaseStartTime = now;
                console.log(`[DELAY] Retour en phase active pour ${chatId}`);
            }
        }
        
        // Mettre à jour l'état
        state.lastMessageTime = now;
        this.conversationStates.set(chatId, state);
        
        // Ajouter un peu de variabilité pour les longs messages
        const lengthDelay = Math.min(messageLength * 30, 3000); // Max 3 secondes pour les longs messages
        
        console.log(`[DELAY] Phase: ${state.phase}, Message #${state.messageCount}`);
        
        return {
            thinkingDelay: baseDelay,
            typingDelay: typingTime,
            totalDelay: baseDelay + typingTime + lengthDelay
        };
    }

    // ============================================
    // CONTRÔLES DU BOT
    // ============================================
    async pause() {
        this.isPaused = true;
        console.log('⏸️ Bot mis en pause');
    }

    async resume() {
        this.isPaused = false;
        console.log('▶️ Bot repris');
    }

    async setTemporaryContext(context, duration = 30 * 60 * 1000) {
        this.temporaryContext = context;
        this.temporaryContextExpiry = Date.now() + duration;
        console.log(`📍 Contexte temporaire défini: "${context}"`);
    }

    async clearTemporaryContext() {
        this.temporaryContext = null;
        this.temporaryContextExpiry = null;
        console.log('🧹 Contexte temporaire effacé');
    }

    async toggleAutoCorrect(enabled) {
        this.autoCorrectEnabled = enabled;
        console.log(`✏️ Auto-correction: ${enabled ? 'activée' : 'désactivée'}`);
    }

    async getStatus() {
        return {
            running: this.isRunning,
            authenticated: this.isAuthenticated,
            ready: this.isReady,
            paused: this.isPaused,
            autoCorrect: this.autoCorrectEnabled,
            temporaryContext: this.temporaryContext,
            masterSwitch: profileManager.config.globalSettings.masterSwitch
        };
    }

    async destroy() {
        console.log('🛑 Arrêt du bot...');
        if (this.client) {
            await this.client.destroy();
        }
        this.isRunning = false;
        this.isReady = false;
        this.isAuthenticated = false;
    }
}

// ============================================
// EXPORT ET DÉMARRAGE
// ============================================
export default WhatsAppBot;

// Si exécuté directement
if (import.meta.url === `file://${process.argv[1]}`) {
    const bot = new WhatsAppBot();
    
    // Gestion des signaux
    process.on('SIGINT', async () => {
        await bot.destroy();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        await bot.destroy();
        process.exit(0);
    });
    
    // Démarrer le bot
    bot.initialize().catch(error => {
        console.error('Erreur fatale:', error);
        process.exit(1);
    });
}
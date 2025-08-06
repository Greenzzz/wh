import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import profileManager from './profileManager.js';
import WhatsAppBot from './bot-refactored.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
// Route principale - nouvelle interface (AVANT express.static)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index-refactored.html'));
});

// Servir les fichiers statiques APRÈS la route principale
app.use(express.static(path.join(__dirname, '../public')));

// ============================================
// INSTANCE DU BOT
// ============================================
let bot = null;

// ============================================
// ROUTES API - CONTRÔLE DU BOT
// ============================================

// Démarrer le bot
app.post('/api/bot/start', async (req, res) => {
    try {
        if (bot && bot.isRunning) {
            return res.json({ 
                success: false, 
                message: 'Bot déjà en cours d\'exécution' 
            });
        }

        console.log('[SERVER] Démarrage du bot...');
        bot = new WhatsAppBot();
        await bot.initialize();
        
        res.json({ 
            success: true, 
            message: '✅ Bot démarré avec succès' 
        });
    } catch (error) {
        console.error('[SERVER] Erreur démarrage:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du démarrage',
            error: error.message 
        });
    }
});

// Arrêter le bot
app.post('/api/bot/stop', async (req, res) => {
    try {
        if (!bot || !bot.isRunning) {
            return res.json({ 
                success: false, 
                message: 'Aucun bot en cours' 
            });
        }

        console.log('[SERVER] Arrêt du bot...');
        await bot.destroy();
        bot = null;
        
        res.json({ 
            success: true, 
            message: '⏹️ Bot arrêté' 
        });
    } catch (error) {
        console.error('[SERVER] Erreur arrêt:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'arrêt',
            error: error.message 
        });
    }
});

// Redémarrer le bot
app.post('/api/bot/restart', async (req, res) => {
    try {
        console.log('[SERVER] Redémarrage du bot...');
        
        // Arrêter si en cours
        if (bot && bot.isRunning) {
            await bot.destroy();
            bot = null;
        }
        
        // Attendre un peu
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Redémarrer
        bot = new WhatsAppBot();
        await bot.initialize();
        
        res.json({ 
            success: true, 
            message: '🔄 Bot redémarré' 
        });
    } catch (error) {
        console.error('[SERVER] Erreur redémarrage:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du redémarrage',
            error: error.message 
        });
    }
});

// Obtenir le statut
app.get('/api/status', async (req, res) => {
    try {
        const status = bot ? await bot.getStatus() : {
            running: false,
            authenticated: false,
            ready: false,
            paused: false,
            autoCorrect: true,
            temporaryContext: null,
            masterSwitch: profileManager.config?.globalSettings?.masterSwitch || false
        };
        
        res.json({
            botStatus: status.running ? (status.ready ? 'running' : 'connecting') : 'stopped',
            botRunning: status.running,
            paused: status.paused,
            context: status.temporaryContext,
            autoCorrectEnabled: status.autoCorrect,
            whatsappConnected: status.ready,
            masterSwitch: status.masterSwitch
        });
    } catch (error) {
        console.error('[SERVER] Erreur status:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ROUTES API - CONTRÔLE DU COMPORTEMENT
// ============================================

// Pause/Resume
app.post('/api/control', async (req, res) => {
    try {
        const { action } = req.body;
        
        if (!bot || !bot.isRunning) {
            return res.json({ 
                success: false, 
                message: 'Bot non démarré',
                paused: false 
            });
        }
        
        switch(action) {
            case 'pause':
                await bot.pause();
                await profileManager.toggleMasterSwitch(false);
                res.json({ 
                    success: true,
                    message: '⏸️ Bot en pause', 
                    paused: true 
                });
                break;
                
            case 'start':
            case 'resume':
                await bot.resume();
                await profileManager.toggleMasterSwitch(true);
                res.json({ 
                    success: true,
                    message: '▶️ Bot actif', 
                    paused: false 
                });
                break;
                
            default:
                res.json({ 
                    success: false,
                    message: 'Action inconnue', 
                    paused: bot.isPaused 
                });
        }
    } catch (error) {
        console.error('[SERVER] Erreur control:', error);
        res.status(500).json({ error: error.message });
    }
});

// Auto-correction
app.post('/api/autocorrect', async (req, res) => {
    try {
        const { enabled } = req.body;
        
        if (bot) {
            await bot.toggleAutoCorrect(enabled);
        }
        
        res.json({ 
            success: true, 
            autoCorrectEnabled: enabled 
        });
    } catch (error) {
        console.error('[SERVER] Erreur autocorrect:', error);
        res.status(500).json({ error: error.message });
    }
});

// Contexte temporaire
app.post('/api/context', async (req, res) => {
    try {
        const { context } = req.body;
        
        if (!context) {
            return res.status(400).json({ 
                success: false, 
                message: 'Contexte requis' 
            });
        }
        
        if (bot) {
            await bot.setTemporaryContext(context);
        }
        
        res.json({ 
            success: true, 
            context: context 
        });
    } catch (error) {
        console.error('[SERVER] Erreur context:', error);
        res.status(500).json({ error: error.message });
    }
});

// Effacer le contexte
app.delete('/api/context', async (req, res) => {
    try {
        if (bot) {
            await bot.clearTemporaryContext();
        }
        
        res.json({ 
            success: true, 
            message: 'Contexte effacé' 
        });
    } catch (error) {
        console.error('[SERVER] Erreur clear context:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ROUTES API - GESTION DES CONTACTS
// ============================================

// Obtenir tous les contacts
app.get('/api/contacts', async (req, res) => {
    try {
        await profileManager.loadConfig();
        res.json({
            contacts: profileManager.config.contacts,
            globalSettings: profileManager.config.globalSettings
        });
    } catch (error) {
        console.error('[SERVER] Erreur get contacts:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ajouter un contact
app.post('/api/contacts', async (req, res) => {
    try {
        const { id, name, phoneNumber, relationship, intimacyLevel } = req.body;
        
        // Validation du numéro de téléphone
        if (!phoneNumber.includes('@')) {
            return res.status(400).json({ 
                error: 'Le numéro doit être au format WhatsApp (ex: 33612345678@c.us)' 
            });
        }
        
        const newContact = await profileManager.addContact(id, {
            name,
            phoneNumber,
            relationship,
            style: { intimacyLevel }
        });
        
        res.json({ success: true, contact: newContact });
    } catch (error) {
        console.error('[SERVER] Erreur add contact:', error);
        res.status(500).json({ error: error.message });
    }
});

// Activer/Désactiver un contact
app.post('/api/contacts/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        const { enabled } = req.body;
        
        const newStatus = await profileManager.toggleContact(id, enabled);
        
        res.json({ success: true, enabled: newStatus });
    } catch (error) {
        console.error('[SERVER] Erreur toggle contact:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mettre à jour les features d'un contact
app.post('/api/contacts/:id/features', async (req, res) => {
    try {
        const { id } = req.params;
        const features = req.body;
        
        const updatedFeatures = await profileManager.updateContactFeatures(id, features);
        
        res.json({ success: true, features: updatedFeatures });
    } catch (error) {
        console.error('[SERVER] Erreur update features:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mettre à jour un contact
app.put('/api/contacts/:id/update', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phoneNumber, relationship, intimacyLevel } = req.body;
        
        const updatedContact = await profileManager.updateContact(id, {
            name,
            phoneNumber,
            relationship,
            intimacyLevel
        });
        
        res.json({ success: true, contact: updatedContact });
    } catch (error) {
        console.error('[SERVER] Erreur update contact:', error);
        res.status(500).json({ error: error.message });
    }
});

// Configuration avancée d'un contact
app.get('/api/contacts/:id/config', async (req, res) => {
    try {
        const { id } = req.params;
        const config = await profileManager.getContactConfig(id);
        res.json(config);
    } catch (error) {
        console.error('[SERVER] Erreur get config:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts/:id/config', async (req, res) => {
    try {
        const { id } = req.params;
        const { prompt, analysis, memory } = req.body;
        
        await profileManager.saveContactConfig(id, { prompt, analysis, memory });
        
        res.json({ success: true });
    } catch (error) {
        console.error('[SERVER] Erreur save config:', error);
        res.status(500).json({ error: error.message });
    }
});

// Master Switch
app.post('/api/master-switch', async (req, res) => {
    try {
        const { enabled } = req.body;
        
        const newStatus = await profileManager.toggleMasterSwitch(enabled);
        
        // Synchroniser avec le bot
        if (bot) {
            if (enabled) {
                await bot.resume();
            } else {
                await bot.pause();
            }
        }
        
        res.json({ success: true, enabled: newStatus });
    } catch (error) {
        console.error('[SERVER] Erreur master switch:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ROUTES PAGES
// ============================================

// Page de gestion des contacts
app.get('/contacts', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/contacts.html'));
});

// ============================================
// DÉMARRAGE DU SERVEUR
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log('=====================================');
    console.log(`🌐 Serveur démarré sur le port ${PORT}`);
    console.log(`📱 Interface: http://localhost:${PORT}`);
    console.log(`👥 Contacts: http://localhost:${PORT}/contacts`);
    console.log('=====================================');
    
    // Charger la configuration des contacts
    try {
        await profileManager.loadConfig();
        console.log('✅ Configuration des contacts chargée');
        console.log(`📊 ${Object.keys(profileManager.config.contacts).length} contacts configurés`);
        console.log(`🔄 Master Switch: ${profileManager.config.globalSettings.masterSwitch ? 'ON' : 'OFF'}`);
    } catch (error) {
        console.error('❌ Erreur chargement contacts:', error);
    }
    
    console.log('\n💡 Utilisez l\'interface web pour:');
    console.log('   - Démarrer/arrêter le bot WhatsApp');
    console.log('   - Gérer les contacts et leurs paramètres');
    console.log('   - Activer/désactiver les fonctionnalités');
    console.log('=====================================\n');
});

// Gestion propre de l'arrêt
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt du serveur...');
    if (bot && bot.isRunning) {
        await bot.destroy();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (bot && bot.isRunning) {
        await bot.destroy();
    }
    process.exit(0);
});
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import profileManager from './profileManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Variables globales
let botProcess = null;
let botStatus = 'stopped';
let currentContext = null;
let autoCorrectEnabled = true;
let botPaused = false;

// Charger le contexte depuis le fichier
function loadContext() {
    const contextPath = path.join(__dirname, '../context.json');
    if (fs.existsSync(contextPath)) {
        const data = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
        currentContext = data.customContext || null;
    }
}

// Sauvegarder le contexte
function saveContext() {
    const contextPath = path.join(__dirname, '../context.json');
    let data = {};
    if (fs.existsSync(contextPath)) {
        data = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
    }
    data.customContext = currentContext;
    fs.writeFileSync(contextPath, JSON.stringify(data, null, 2));
}

// Fonction pour démarrer le bot
function startBot() {
    if (botProcess) {
        console.log('Bot déjà en cours d\'exécution');
        return false;
    }

    console.log('Démarrage du bot WhatsApp...');
    
    // Lancer le bot dans un processus séparé
    botProcess = spawn('node', [path.join(__dirname, 'index.js')], {
        env: { ...process.env },
        stdio: ['pipe', 'inherit', 'inherit'] // pipe pour stdin, inherit pour stdout/stderr
    });

    botStatus = 'running';

    botProcess.on('close', (code) => {
        console.log(`Bot arrêté avec le code ${code}`);
        botProcess = null;
        botStatus = 'stopped';
    });

    botProcess.on('error', (err) => {
        console.error('Erreur lors du démarrage du bot:', err);
        botProcess = null;
        botStatus = 'error';
    });

    return true;
}

// Fonction pour arrêter le bot
function stopBot() {
    if (!botProcess) {
        console.log('Aucun bot en cours d\'exécution');
        return false;
    }

    console.log('Arrêt du bot...');
    botProcess.kill('SIGTERM');
    
    // Forcer l'arrêt après 5 secondes si nécessaire
    setTimeout(() => {
        if (botProcess) {
            console.log('Arrêt forcé du bot...');
            botProcess.kill('SIGKILL');
        }
    }, 5000);

    return true;
}

// Route pour démarrer le bot
app.post('/api/bot/start', (req, res) => {
    if (startBot()) {
        res.json({ success: true, message: '✅ Bot démarré' });
    } else {
        res.json({ success: false, message: 'Bot déjà en cours d\'exécution' });
    }
});

// Route pour arrêter le bot
app.post('/api/bot/stop', (req, res) => {
    if (stopBot()) {
        res.json({ success: true, message: '⏹️ Bot arrêté' });
    } else {
        res.json({ success: false, message: 'Aucun bot en cours' });
    }
});

// Route pour redémarrer le bot
app.post('/api/bot/restart', async (req, res) => {
    stopBot();
    
    // Attendre un peu avant de redémarrer
    setTimeout(() => {
        startBot();
        res.json({ success: true, message: '🔄 Bot redémarré' });
    }, 2000);
});

// Route pour obtenir le statut
app.get('/api/status', (req, res) => {
    loadContext();
    res.json({
        botStatus,
        botRunning: botProcess !== null,
        paused: botPaused,
        context: currentContext,
        autoCorrectEnabled
    });
});

// Route pour contrôler le bot (pause/resume)
app.post('/api/control', async (req, res) => {
    const { action } = req.body;
    
    if (!botProcess) {
        res.json({ 
            success: false, 
            message: 'Bot non démarré',
            paused: botPaused 
        });
        return;
    }
    
    switch(action) {
        case 'pause':
            botPaused = true;
            // Synchroniser avec le master switch
            await profileManager.toggleMasterSwitch(false);
            // Envoyer un signal au bot pour qu'il se mette en pause
            if (botProcess) {
                botProcess.stdin.write('PAUSE\n');
            }
            res.json({ 
                message: '⏸️ Bot en pause', 
                paused: true 
            });
            break;
            
        case 'start':
        case 'resume':
            botPaused = false;
            // Synchroniser avec le master switch
            await profileManager.toggleMasterSwitch(true);
            if (botProcess) {
                botProcess.stdin.write('RESUME\n');
            }
            res.json({ 
                message: '▶️ Bot actif', 
                paused: false 
            });
            break;
            
        default:
            res.json({ 
                message: 'Action inconnue', 
                paused: botPaused 
            });
    }
});

// Route pour la correction automatique
app.post('/api/autocorrect', (req, res) => {
    const { enabled } = req.body;
    autoCorrectEnabled = enabled;
    
    // Envoyer la configuration au bot si il est en cours
    if (botProcess) {
        botProcess.stdin.write(`AUTOCORRECT:${enabled}\n`);
    }
    
    res.json({ 
        success: true, 
        autoCorrectEnabled 
    });
});

// Route pour le contexte
app.post('/api/context', (req, res) => {
    const { context } = req.body;
    currentContext = context;
    saveContext();
    
    // Envoyer le contexte au bot si il est en cours
    if (botProcess) {
        botProcess.stdin.write(`CONTEXT:${context}\n`);
    }
    
    res.json({ 
        success: true, 
        context: currentContext 
    });
});

// Route pour effacer le contexte
app.delete('/api/context', (req, res) => {
    currentContext = null;
    saveContext();
    
    if (botProcess) {
        botProcess.stdin.write('CONTEXT:CLEAR\n');
    }
    
    res.json({ 
        success: true, 
        message: 'Contexte effacé' 
    });
});

// Routes pour la gestion des contacts
app.get('/api/contacts', async (req, res) => {
    try {
        await profileManager.loadConfig();
        res.json({
            contacts: profileManager.config.contacts,
            globalSettings: profileManager.config.globalSettings
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts', async (req, res) => {
    try {
        const { id, name, phoneNumber, relationship, intimacyLevel } = req.body;
        
        const newContact = await profileManager.addContact(id, {
            name,
            phoneNumber,
            relationship,
            style: { intimacyLevel }
        });
        
        res.json({ success: true, contact: newContact });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        const { enabled } = req.body;
        
        const newStatus = await profileManager.toggleContact(id, enabled);
        
        // Notifier le bot de recharger la config
        if (botProcess && botProcess.stdin && !botProcess.stdin.destroyed) {
            botProcess.stdin.write('RELOAD_CONFIG\n');
            console.log('[SERVER] Signal RELOAD_CONFIG envoyé au bot');
        } else {
            console.log('[SERVER] ⚠️ Impossible d\'envoyer le signal (stdin non disponible)');
        }
        
        res.json({ success: true, enabled: newStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts/:id/features', async (req, res) => {
    try {
        const { id } = req.params;
        const features = req.body;
        
        const updatedFeatures = await profileManager.updateContactFeatures(id, features);
        
        // Notifier le bot de recharger la config
        if (botProcess && botProcess.stdin && !botProcess.stdin.destroyed) {
            botProcess.stdin.write('RELOAD_CONFIG\n');
            console.log('[SERVER] Signal RELOAD_CONFIG envoyé au bot');
        } else {
            console.log('[SERVER] ⚠️ Impossible d\'envoyer le signal (stdin non disponible)');
        }
        
        res.json({ success: true, features: updatedFeatures });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
        res.status(500).json({ error: error.message });
    }
});

// Routes pour la configuration avancée
app.get('/api/contacts/:id/config', async (req, res) => {
    try {
        const { id } = req.params;
        const config = await profileManager.getContactConfig(id);
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts/:id/config', async (req, res) => {
    try {
        const { id } = req.params;
        const { prompt, analysis, memory } = req.body;
        
        await profileManager.saveContactConfig(id, { prompt, analysis, memory });
        
        // Notifier le bot de recharger la config
        if (botProcess && botProcess.stdin && !botProcess.stdin.destroyed) {
            botProcess.stdin.write('RELOAD_CONFIG\n');
            console.log('[SERVER] Signal RELOAD_CONFIG envoyé au bot');
        } else {
            console.log('[SERVER] ⚠️ Impossible d\'envoyer le signal (stdin non disponible)');
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.post('/api/master-switch', async (req, res) => {
    try {
        const { enabled } = req.body;
        
        // Synchroniser les deux systèmes
        botPaused = !enabled;
        const newStatus = await profileManager.toggleMasterSwitch(enabled);
        
        // Envoyer le signal au bot si nécessaire
        if (botProcess) {
            botProcess.stdin.write(enabled ? 'RESUME\n' : 'PAUSE\n');
        }
        
        res.json({ success: true, enabled: newStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Route pour accéder à la page de gestion des contacts
app.get('/contacts', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/contacts.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🌐 Interface web disponible sur: http://localhost:${PORT}`);
    console.log(`📱 Gestion des contacts sur: http://localhost:${PORT}/contacts`);
    console.log('💡 Utilisez l\'interface pour démarrer/arrêter le bot WhatsApp');
    
    // Charger le contexte au démarrage
    loadContext();
    
    // Charger la configuration des contacts
    try {
        await profileManager.loadConfig();
        console.log('✅ Configuration des contacts chargée');
    } catch (error) {
        console.error('❌ Erreur chargement contacts:', error);
    }
});
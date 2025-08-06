import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ProfileManager {
    constructor() {
        this.config = null;
        this.profiles = new Map();
        this.memories = new Map();
        this.prompts = new Map();
        this.analyses = new Map();
        this.lastConfigLoad = 0;
        this.configCacheDuration = 60000; // Cache de 1 minute
    }

    // Charger la configuration des contacts avec cache
    async loadConfig(forceReload = false) {
        // Si on a déjà la config et qu'elle est récente, ne pas recharger
        const now = Date.now();
        if (!forceReload && this.config && (now - this.lastConfigLoad) < this.configCacheDuration) {
            return this.config;
        }
        
        try {
            const configFile = await fs.readFile(join(__dirname, 'contacts-config.json'), 'utf-8');
            this.config = JSON.parse(configFile);
            this.lastConfigLoad = now;
            console.log('✅ Configuration des contacts chargée');
            return this.config;
        } catch (error) {
            console.error('❌ Erreur chargement config:', error);
            throw error;
        }
    }

    // Sauvegarder la configuration
    async saveConfig() {
        try {
            await fs.writeFile(
                join(__dirname, 'contacts-config.json'),
                JSON.stringify(this.config, null, 2)
            );
            // Mettre à jour le timestamp pour que le cache reste valide
            this.lastConfigLoad = Date.now();
            console.log('✅ Configuration sauvegardée');
        } catch (error) {
            console.error('❌ Erreur sauvegarde config:', error);
        }
    }

    // Obtenir le profil d'un contact par numéro
    async getProfileByNumber(phoneNumber) {
        // Nettoyer le numéro entrant (enlever @c.us et garder seulement les chiffres)
        const cleanNumber = phoneNumber.replace(/@c\.us/g, '').replace(/\D/g, '');
        
        // Chercher dans la config
        for (const [contactId, contact] of Object.entries(this.config.contacts)) {
            // Nettoyer le numéro du contact (enlever le +, espaces, etc.)
            const contactCleanNumber = contact.phoneNumber.replace(/\D/g, '');
            
            // Comparaison flexible : 
            // - Correspondance exacte
            // - ou numéro entrant sans le code pays (33) correspond au numéro du contact avec code pays
            // - ou numéro du contact est contenu dans le numéro entrant
            if (contactCleanNumber === cleanNumber || 
                cleanNumber.endsWith(contactCleanNumber.substring(2)) || // Sans code pays
                contactCleanNumber.endsWith(cleanNumber.substring(2)) || // Inverse
                cleanNumber === contactCleanNumber.substring(2)) { // numéro entrant sans code pays
                return { id: contactId, ...contact };
            }
        }
        
        return null;
    }

    // Charger les données d'un profil spécifique
    async loadProfileData(contactId) {
        const contact = this.config.contacts[contactId];
        if (!contact) return null;

        const profileData = {
            config: contact,
            prompt: null,
            analysis: null,
            memory: {}
        };

        // Charger le prompt personnalisé si disponible
        if (contact.customPrompt) {
            try {
                const promptPath = join(__dirname, contact.customPrompt);
                profileData.prompt = await fs.readFile(promptPath, 'utf-8');
                this.prompts.set(contactId, profileData.prompt);
            } catch (error) {
                console.log(`⚠️ Prompt non trouvé pour ${contactId}`);
            }
        }

        // Charger l'analyse si disponible
        if (contact.analysisData) {
            try {
                const analysisPath = join(__dirname, contact.analysisData);
                const analysisFile = await fs.readFile(analysisPath, 'utf-8');
                profileData.analysis = JSON.parse(analysisFile);
                this.analyses.set(contactId, profileData.analysis);
            } catch (error) {
                console.log(`⚠️ Analyse non trouvée pour ${contactId}`);
            }
        }

        // Charger la mémoire spécifique
        if (contact.memory) {
            try {
                const memoryPath = join(__dirname, contact.memory);
                const memoryFile = await fs.readFile(memoryPath, 'utf-8');
                profileData.memory = JSON.parse(memoryFile);
                this.memories.set(contactId, profileData.memory);
            } catch (error) {
                // Créer une nouvelle mémoire si elle n'existe pas
                profileData.memory = {
                    conversations: {},
                    important_info: {},
                    last_updated: new Date().toISOString()
                };
                this.memories.set(contactId, profileData.memory);
            }
        }

        this.profiles.set(contactId, profileData);
        return profileData;
    }

    // Sauvegarder la mémoire d'un contact
    async saveMemory(contactId) {
        const contact = this.config.contacts[contactId];
        const memory = this.memories.get(contactId);
        
        if (!contact || !memory) return;

        try {
            memory.last_updated = new Date().toISOString();
            const memoryPath = join(__dirname, contact.memory || `${contactId}_memory.json`);
            await fs.writeFile(memoryPath, JSON.stringify(memory, null, 2));
        } catch (error) {
            console.error(`❌ Erreur sauvegarde mémoire ${contactId}:`, error);
        }
    }

    // Vérifier si un contact est activé
    isContactEnabled(phoneNumber) {
        const profile = this.getProfileByNumberSync(phoneNumber);
        if (!profile) return this.config.globalSettings.defaultEnabled;
        return profile.enabled && this.config.globalSettings.masterSwitch;
    }

    // Version synchrone pour les vérifications rapides
    getProfileByNumberSync(phoneNumber) {
        // Nettoyer le numéro entrant (enlever @c.us et garder seulement les chiffres)
        const cleanNumber = phoneNumber.replace(/@c\.us/g, '').replace(/\D/g, '');
        
        console.log(`[PROFILE-SEARCH] Recherche profil pour numéro: "${phoneNumber}" -> clean: "${cleanNumber}"`);
        
        for (const [contactId, contact] of Object.entries(this.config.contacts)) {
            // Nettoyer le numéro du contact (enlever le +, espaces, etc.)
            const contactCleanNumber = contact.phoneNumber.replace(/\D/g, '');
            console.log(`[PROFILE-SEARCH] Comparaison avec ${contactId}: "${contact.phoneNumber}" -> clean: "${contactCleanNumber}"`);
            
            // Comparaison flexible : 
            // - Correspondance exacte
            // - ou numéro entrant sans le code pays (33) correspond au numéro du contact avec code pays
            // - ou numéro du contact est contenu dans le numéro entrant
            if (contactCleanNumber === cleanNumber || 
                cleanNumber.endsWith(contactCleanNumber.substring(2)) || // Sans code pays
                contactCleanNumber.endsWith(cleanNumber.substring(2)) || // Inverse
                cleanNumber === contactCleanNumber.substring(2)) { // numéro entrant sans code pays
                console.log(`[PROFILE-SEARCH] ✅ Profil trouvé: ${contactId}`);
                return { id: contactId, ...contact };
            }
        }
        
        console.log(`[PROFILE-SEARCH] ❌ Aucun profil trouvé pour "${cleanNumber}"`);
        return null;
    }

    // Activer/désactiver un contact
    async toggleContact(contactId, enabled = null) {
        if (!this.config.contacts[contactId]) return false;
        
        if (enabled === null) {
            // Toggle si pas de valeur spécifiée
            this.config.contacts[contactId].enabled = !this.config.contacts[contactId].enabled;
        } else {
            this.config.contacts[contactId].enabled = enabled;
        }
        
        await this.saveConfig();
        return this.config.contacts[contactId].enabled;
    }

    // Activer/désactiver le bot globalement
    async toggleMasterSwitch(enabled = null) {
        if (enabled === null) {
            this.config.globalSettings.masterSwitch = !this.config.globalSettings.masterSwitch;
        } else {
            this.config.globalSettings.masterSwitch = enabled;
        }
        
        await this.saveConfig();
        return this.config.globalSettings.masterSwitch;
    }

    // Obtenir les features pour un contact
    getFeatures(phoneNumber) {
        const profile = this.getProfileByNumberSync(phoneNumber);
        
        if (!profile) {
            return this.config.globalSettings.defaultFeatures;
        }
        
        return profile.features;
    }

    // Générer un prompt personnalisé pour un contact
    generatePrompt(contactId, sentiment = 'neutral', context = {}) {
        const profile = this.profiles.get(contactId);
        if (!profile) return null;

        const contact = profile.config;
        let basePrompt = '';

        // Utiliser le prompt personnalisé si disponible
        if (profile.prompt) {
            basePrompt = profile.prompt;
        } else {
            // Générer un prompt basique basé sur la relation
            basePrompt = this.generateDefaultPrompt(contact);
        }

        // Ajouter les éléments contextuels
        const fullPrompt = `${basePrompt}

RÈGLE ABSOLUE : Tu ES Nicolas, pas un assistant.

CONTEXTE ACTUEL :
- Relation: ${contact.relationship}
- Niveau d'intimité: ${contact.style.intimacyLevel}/10
- Style de message: ${contact.style.messageLength}
${context.currentContext || ''}

SENTIMENT DÉTECTÉ : ${sentiment}
${sentiment === 'negative' ? `- ${contact.name} semble triste/énervé(e), sois plus doux et attentionné` : ''}
${sentiment === 'positive' ? `- ${contact.name} est de bonne humeur, sois enjoué aussi` : ''}
${sentiment === 'question' ? `- ${contact.name} pose une question, réponds de manière directe` : ''}

${contact.style.useEmojis ? 'Utilise des emojis appropriés' : 'Évite les emojis'}
${contact.style.typos ? 'Tu peux faire quelques fautes de frappe naturelles' : 'Écris correctement'}

Réponds de manière naturelle et cohérente avec la relation.`;

        return fullPrompt;
    }

    // Générer un prompt par défaut basé sur la relation
    generateDefaultPrompt(contact) {
        const prompts = {
            'girlfriend': `Tu es Nicolas et tu parles à ta copine ${contact.name}.
Style affectueux, messages courts, utilise des surnoms affectueux.`,
            
            'friend': `Tu es Nicolas et tu parles à ton ami(e) ${contact.name}.
Style décontracté, humour, références communes.`,
            
            'colleague': `Tu es Nicolas et tu parles à ton collègue ${contact.name}.
Style professionnel mais amical, clair et concis.`,
            
            'family': `Tu es Nicolas et tu parles à un membre de ta famille, ${contact.name}.
Style familier, chaleureux, attentionné.`,
            
            'default': `Tu es Nicolas et tu parles à ${contact.name}.
Reste naturel et adapte ton ton selon le contexte.`
        };

        return prompts[contact.relationship] || prompts.default;
    }

    // Ajouter un nouveau contact
    async addContact(contactId, contactData) {
        if (this.config.contacts[contactId]) {
            throw new Error(`Contact ${contactId} existe déjà`);
        }

        // Structure par défaut pour un nouveau contact
        const newContact = {
            enabled: false,
            phoneNumber: contactData.phoneNumber || '',
            name: contactData.name || contactId,
            relationship: contactData.relationship || 'friend',
            profilePath: `profiles/${contactId}/`,
            features: {
                ...this.config.globalSettings.defaultFeatures,
                ...(contactData.features || {})
            },
            customPrompt: null,
            analysisData: null,
            memory: `${contactId}_memory.json`,
            keywords: contactData.keywords || [],
            style: {
                useEmojis: false,
                messageLength: 'medium',
                typos: false,
                intimacyLevel: 3,
                ...(contactData.style || {})
            }
        };

        this.config.contacts[contactId] = newContact;
        await this.saveConfig();

        // Créer le dossier du profil
        try {
            await fs.mkdir(join(__dirname, newContact.profilePath), { recursive: true });
        } catch (error) {
            console.log(`Dossier ${newContact.profilePath} créé`);
        }

        return newContact;
    }

    // Obtenir la liste des contacts
    getContactsList() {
        return Object.entries(this.config.contacts).map(([id, contact]) => ({
            id,
            name: contact.name,
            enabled: contact.enabled,
            relationship: contact.relationship,
            phoneNumber: contact.phoneNumber
        }));
    }

    // Mettre à jour les features d'un contact
    async updateContactFeatures(contactId, features) {
        if (!this.config.contacts[contactId]) {
            throw new Error(`Contact ${contactId} n'existe pas`);
        }

        this.config.contacts[contactId].features = {
            ...this.config.contacts[contactId].features,
            ...features
        };

        await this.saveConfig();
        return this.config.contacts[contactId].features;
    }

    // Mettre à jour un contact complet
    async updateContact(contactId, updateData) {
        if (!this.config.contacts[contactId]) {
            throw new Error(`Contact ${contactId} n'existe pas`);
        }

        const contact = this.config.contacts[contactId];
        
        // Mettre à jour les champs principaux
        if (updateData.name !== undefined) {
            contact.name = updateData.name;
        }
        if (updateData.phoneNumber !== undefined) {
            contact.phoneNumber = updateData.phoneNumber;
        }
        if (updateData.relationship !== undefined) {
            contact.relationship = updateData.relationship;
        }
        if (updateData.intimacyLevel !== undefined) {
            contact.style.intimacyLevel = updateData.intimacyLevel;
        }

        await this.saveConfig();
        return contact;
    }

    // Obtenir la configuration complète d'un contact
    async getContactConfig(contactId) {
        const contact = this.config.contacts[contactId];
        if (!contact) {
            throw new Error(`Contact ${contactId} n'existe pas`);
        }

        const config = {
            prompt: null,
            analysis: null,
            memory: null
        };

        // Charger le prompt si disponible
        if (contact.customPrompt) {
            try {
                const promptPath = join(__dirname, contact.customPrompt);
                config.prompt = await fs.readFile(promptPath, 'utf-8');
            } catch (error) {
                console.log(`Prompt non trouvé pour ${contactId}`);
            }
        }

        // Charger l'analyse si disponible
        if (contact.analysisData) {
            try {
                const analysisPath = join(__dirname, contact.analysisData);
                const analysisData = await fs.readFile(analysisPath, 'utf-8');
                config.analysis = JSON.parse(analysisData);
            } catch (error) {
                console.log(`Analyse non trouvée pour ${contactId}`);
            }
        }

        // Charger la mémoire si disponible
        if (contact.memory) {
            try {
                const memoryPath = join(__dirname, contact.memory);
                const memoryData = await fs.readFile(memoryPath, 'utf-8');
                config.memory = JSON.parse(memoryData);
            } catch (error) {
                console.log(`Mémoire non trouvée pour ${contactId}`);
                config.memory = {
                    conversations: {},
                    important_info: {},
                    last_updated: new Date().toISOString()
                };
            }
        }

        return config;
    }

    // Sauvegarder la configuration complète d'un contact
    async saveContactConfig(contactId, configData) {
        const contact = this.config.contacts[contactId];
        if (!contact) {
            throw new Error(`Contact ${contactId} n'existe pas`);
        }

        // Sauvegarder le prompt
        if (configData.prompt !== undefined) {
            const promptPath = join(__dirname, contact.customPrompt || `${contactId}_prompt.txt`);
            await fs.writeFile(promptPath, configData.prompt);
            
            // Mettre à jour le chemin dans la config si nouveau
            if (!contact.customPrompt) {
                contact.customPrompt = `${contactId}_prompt.txt`;
                await this.saveConfig();
            }
        }

        // Sauvegarder l'analyse
        if (configData.analysis !== undefined && configData.analysis !== null) {
            const analysisPath = join(__dirname, contact.analysisData || `${contactId}_analysis.json`);
            await fs.writeFile(analysisPath, JSON.stringify(configData.analysis, null, 2));
            
            // Mettre à jour le chemin dans la config si nouveau
            if (!contact.analysisData) {
                contact.analysisData = `${contactId}_analysis.json`;
                await this.saveConfig();
            }
        }

        // Sauvegarder la mémoire
        if (configData.memory !== undefined && configData.memory !== null) {
            const memoryPath = join(__dirname, contact.memory || `${contactId}_memory.json`);
            await fs.writeFile(memoryPath, JSON.stringify(configData.memory, null, 2));
            
            // Mettre à jour le chemin dans la config si nouveau
            if (!contact.memory) {
                contact.memory = `${contactId}_memory.json`;
                await this.saveConfig();
            }
        }

        return true;
    }
}

// Export singleton
const profileManager = new ProfileManager();
export default profileManager;
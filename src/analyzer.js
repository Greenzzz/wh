import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

class WhatsAppAnalyzer {
    constructor(filePath) {
        this.filePath = filePath;
        this.chunks = [];
        this.results = {
            style: {
                expressions: {},
                emojis: {},
                punctuation: {},
                messageLength: [],
                greetings: [],
                farewells: [],
                laughter: [],
                affection: []
            },
            facts: {
                nicknames: new Set(),
                locations: new Set(),
                events: [],
                insideJokes: [],
                preferences: {},
                activities: new Set(),
                people: new Set()
            },
            patterns: {
                responseTime: [],
                conversationStarters: [],
                topicChanges: [],
                emotionalExpressions: {},
                disagreementStyle: [],
                agreementStyle: []
            },
            relationship: {
                intimacyLevel: null,
                commonTopics: {},
                sharedMemories: [],
                routines: []
            }
        };
        this.processedChunks = 0;
        this.totalChunks = 0;
    }

    // Découper le fichier en chunks gérables
    async chunkFile(chunkSize = 30000) {
        console.log('📂 Lecture du fichier...');
        const content = await fs.readFile(this.filePath, 'utf-8');
        const lines = content.split('\n');
        
        console.log(`📊 Total: ${lines.length} lignes, ${(content.length / 1024).toFixed(2)} KB`);
        
        const chunks = [];
        let currentChunk = [];
        let currentSize = 0;
        
        for (const line of lines) {
            currentChunk.push(line);
            currentSize += line.length;
            
            // Créer un nouveau chunk si on dépasse la taille ou qu'on a assez de messages
            if (currentSize > chunkSize || currentChunk.length > 100) {
                chunks.push(currentChunk.join('\n'));
                currentChunk = [];
                currentSize = 0;
            }
        }
        
        // Ajouter le dernier chunk
        if (currentChunk.length > 0) {
            chunks.push(currentChunk.join('\n'));
        }
        
        this.chunks = chunks;
        this.totalChunks = chunks.length;
        console.log(`✂️ Divisé en ${chunks.length} chunks`);
        
        return chunks;
    }

    // Pass 1: Analyser le style d'écriture
    async analyzeStyle(chunk, chunkIndex) {
        console.log(`🎨 Analyse du style (chunk ${chunkIndex + 1}/${this.totalChunks})...`);
        
        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `Tu es un expert en analyse linguistique. Analyse le style d'écriture de Nicolas dans cette conversation WhatsApp.
                        
EXTRAIS:
- Expressions favorites (compte les occurrences)
- Emojis utilisés (avec fréquence)
- Style de ponctuation (usage des ..., !!!, ???, etc.)
- Longueur moyenne des messages
- Façons de dire bonjour/salut
- Façons de dire au revoir/bonne nuit
- Façons de rire (mdr, lol, ahah, haha, etc.)
- Expressions d'affection

Réponds UNIQUEMENT en JSON avec cette structure:
{
  "expressions": {"expression": count},
  "emojis": {"emoji": count},
  "punctuation": {"style": count},
  "avgMessageLength": number,
  "greetings": ["..."],
  "farewells": ["..."],
  "laughter": ["..."],
  "affection": ["..."]
}`
                    },
                    {
                        role: 'user',
                        content: `Analyse le style de Nicolas dans ces messages:\n\n${chunk}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 1500
            });

            const response = completion.choices[0].message.content;
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const styleData = JSON.parse(jsonMatch[0]);
                this.mergeStyleResults(styleData);
                console.log(`✅ Style analysé: ${Object.keys(styleData.expressions || {}).length} expressions trouvées`);
            }
        } catch (error) {
            console.error(`❌ Erreur analyse style chunk ${chunkIndex}:`, error.message);
        }
    }

    // Pass 2: Extraire les faits importants
    async extractFacts(chunk, chunkIndex) {
        console.log(`📝 Extraction des faits (chunk ${chunkIndex + 1}/${this.totalChunks})...`);
        
        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `Tu es un expert en extraction d'informations. Extrais tous les faits importants de cette conversation.

EXTRAIS:
- Surnoms utilisés (ma puce, bébé, chérie, etc.)
- Lieux mentionnés (villes, restaurants, endroits)
- Événements importants avec dates si possible
- Inside jokes ou références privées
- Préférences mentionnées (nourriture, activités, etc.)
- Activités faites ensemble
- Personnes mentionnées (amis, famille)

Réponds UNIQUEMENT en JSON:
{
  "nicknames": ["..."],
  "locations": ["..."],
  "events": [{"date": "...", "event": "..."}],
  "insideJokes": ["..."],
  "preferences": {"category": ["..."]},
  "activities": ["..."],
  "people": ["..."]
}`
                    },
                    {
                        role: 'user',
                        content: `Extrais les faits de cette conversation:\n\n${chunk}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 1500
            });

            const response = completion.choices[0].message.content;
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const factsData = JSON.parse(jsonMatch[0]);
                this.mergeFactsResults(factsData);
                console.log(`✅ Faits extraits: ${factsData.nicknames?.length || 0} surnoms, ${factsData.locations?.length || 0} lieux`);
            }
        } catch (error) {
            console.error(`❌ Erreur extraction faits chunk ${chunkIndex}:`, error.message);
        }
    }

    // Pass 3: Identifier les patterns comportementaux
    async findPatterns(chunk, chunkIndex) {
        console.log(`🔍 Recherche de patterns (chunk ${chunkIndex + 1}/${this.totalChunks})...`);
        
        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `Analyse les patterns de conversation de Nicolas.

IDENTIFIE:
- Comment il commence les conversations
- Comment il change de sujet
- Comment il exprime ses émotions (joie, tristesse, fatigue, etc.)
- Comment il exprime son désaccord
- Comment il exprime son accord
- Sujets de conversation récurrents

Réponds en JSON:
{
  "conversationStarters": ["..."],
  "topicChanges": ["..."],
  "emotionalExpressions": {
    "joy": ["..."],
    "sadness": ["..."],
    "fatigue": ["..."],
    "love": ["..."],
    "frustration": ["..."]
  },
  "disagreementStyle": ["..."],
  "agreementStyle": ["..."],
  "commonTopics": {"topic": frequency}
}`
                    },
                    {
                        role: 'user',
                        content: `Trouve les patterns dans:\n\n${chunk}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 1500
            });

            const response = completion.choices[0].message.content;
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const patternsData = JSON.parse(jsonMatch[0]);
                this.mergePatternsResults(patternsData);
                console.log(`✅ Patterns trouvés: ${patternsData.conversationStarters?.length || 0} débuts de conversation`);
            }
        } catch (error) {
            console.error(`❌ Erreur patterns chunk ${chunkIndex}:`, error.message);
        }
    }

    // Pass 4: Analyser la dynamique relationnelle
    async analyzeRelationship(chunk, chunkIndex) {
        console.log(`💕 Analyse relationnelle (chunk ${chunkIndex + 1}/${this.totalChunks})...`);
        
        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `Analyse la dynamique de la relation entre Nicolas et Marion.

ÉVALUE:
- Niveau d'intimité (1-10)
- Routines quotidiennes mentionnées
- Souvenirs partagés importants
- Ton général de la conversation (affectueux, amical, passionné, etc.)

Réponds en JSON:
{
  "intimacyLevel": number,
  "routines": ["..."],
  "sharedMemories": ["..."],
  "conversationTone": "..."
}`
                    },
                    {
                        role: 'user',
                        content: `Analyse la relation dans:\n\n${chunk}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 1000
            });

            const response = completion.choices[0].message.content;
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const relationData = JSON.parse(jsonMatch[0]);
                this.mergeRelationshipResults(relationData);
                console.log(`✅ Relation analysée: intimité ${relationData.intimacyLevel}/10`);
            }
        } catch (error) {
            console.error(`❌ Erreur relation chunk ${chunkIndex}:`, error.message);
        }
    }

    // Fonctions de fusion des résultats
    mergeStyleResults(newData) {
        // Fusionner les expressions
        if (newData.expressions) {
            Object.entries(newData.expressions).forEach(([expr, count]) => {
                this.results.style.expressions[expr] = (this.results.style.expressions[expr] || 0) + count;
            });
        }
        
        // Fusionner les emojis
        if (newData.emojis) {
            Object.entries(newData.emojis).forEach(([emoji, count]) => {
                this.results.style.emojis[emoji] = (this.results.style.emojis[emoji] || 0) + count;
            });
        }
        
        // Fusionner la ponctuation
        if (newData.punctuation) {
            Object.entries(newData.punctuation).forEach(([style, count]) => {
                this.results.style.punctuation[style] = (this.results.style.punctuation[style] || 0) + count;
            });
        }
        
        // Ajouter les nouvelles données
        if (newData.avgMessageLength) {
            this.results.style.messageLength.push(newData.avgMessageLength);
        }
        if (newData.greetings) {
            this.results.style.greetings.push(...newData.greetings);
        }
        if (newData.farewells) {
            this.results.style.farewells.push(...newData.farewells);
        }
        if (newData.laughter) {
            this.results.style.laughter.push(...newData.laughter);
        }
        if (newData.affection) {
            this.results.style.affection.push(...newData.affection);
        }
    }

    mergeFactsResults(newData) {
        if (newData.nicknames) {
            newData.nicknames.forEach(n => this.results.facts.nicknames.add(n));
        }
        if (newData.locations) {
            newData.locations.forEach(l => this.results.facts.locations.add(l));
        }
        if (newData.events) {
            this.results.facts.events.push(...newData.events);
        }
        if (newData.insideJokes) {
            this.results.facts.insideJokes.push(...newData.insideJokes);
        }
        if (newData.preferences) {
            Object.entries(newData.preferences).forEach(([cat, prefs]) => {
                if (!this.results.facts.preferences[cat]) {
                    this.results.facts.preferences[cat] = [];
                }
                this.results.facts.preferences[cat].push(...prefs);
            });
        }
        if (newData.activities) {
            newData.activities.forEach(a => this.results.facts.activities.add(a));
        }
        if (newData.people) {
            newData.people.forEach(p => this.results.facts.people.add(p));
        }
    }

    mergePatternsResults(newData) {
        if (newData.conversationStarters) {
            this.results.patterns.conversationStarters.push(...newData.conversationStarters);
        }
        if (newData.topicChanges) {
            this.results.patterns.topicChanges.push(...newData.topicChanges);
        }
        if (newData.emotionalExpressions) {
            Object.entries(newData.emotionalExpressions).forEach(([emotion, expressions]) => {
                if (!this.results.patterns.emotionalExpressions[emotion]) {
                    this.results.patterns.emotionalExpressions[emotion] = [];
                }
                this.results.patterns.emotionalExpressions[emotion].push(...expressions);
            });
        }
        if (newData.disagreementStyle) {
            this.results.patterns.disagreementStyle.push(...newData.disagreementStyle);
        }
        if (newData.agreementStyle) {
            this.results.patterns.agreementStyle.push(...newData.agreementStyle);
        }
        if (newData.commonTopics) {
            Object.entries(newData.commonTopics).forEach(([topic, freq]) => {
                this.results.relationship.commonTopics[topic] = 
                    (this.results.relationship.commonTopics[topic] || 0) + freq;
            });
        }
    }

    mergeRelationshipResults(newData) {
        if (newData.intimacyLevel) {
            if (!this.results.relationship.intimacyLevel) {
                this.results.relationship.intimacyLevel = [];
            }
            this.results.relationship.intimacyLevel.push(newData.intimacyLevel);
        }
        if (newData.routines) {
            this.results.relationship.routines.push(...newData.routines);
        }
        if (newData.sharedMemories) {
            this.results.relationship.sharedMemories.push(...newData.sharedMemories);
        }
    }

    // Analyser tous les chunks
    async analyzeAll() {
        console.log('\n🚀 Démarrage de l\'analyse complète...\n');
        
        for (let i = 0; i < this.chunks.length; i++) {
            const chunk = this.chunks[i];
            console.log(`\n📦 Traitement chunk ${i + 1}/${this.totalChunks}`);
            console.log('─'.repeat(50));
            
            // Exécuter toutes les analyses pour ce chunk
            await this.analyzeStyle(chunk, i);
            await this.extractFacts(chunk, i);
            await this.findPatterns(chunk, i);
            await this.analyzeRelationship(chunk, i);
            
            this.processedChunks++;
            
            // Pause entre les chunks pour éviter rate limiting
            if (i < this.chunks.length - 1) {
                console.log('\n⏳ Pause de 2 secondes...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.log('\n✅ Analyse complète terminée!');
    }

    // Compiler les résultats finaux
    async compile() {
        console.log('\n📊 Compilation des résultats...\n');
        
        // Nettoyer et dédupliquer les résultats
        const compiled = {
            style: {
                topExpressions: this.getTopItems(this.results.style.expressions, 20),
                topEmojis: this.getTopItems(this.results.style.emojis, 15),
                punctuationStyle: this.getTopItems(this.results.style.punctuation, 10),
                avgMessageLength: this.average(this.results.style.messageLength),
                uniqueGreetings: [...new Set(this.results.style.greetings)].slice(0, 10),
                uniqueFarewells: [...new Set(this.results.style.farewells)].slice(0, 10),
                laughterStyles: this.countOccurrences(this.results.style.laughter),
                affectionExpressions: [...new Set(this.results.style.affection)].slice(0, 15)
            },
            facts: {
                nicknames: [...this.results.facts.nicknames],
                topLocations: [...this.results.facts.locations].slice(0, 20),
                keyEvents: this.results.facts.events.slice(0, 30),
                insideJokes: [...new Set(this.results.facts.insideJokes)].slice(0, 20),
                preferences: this.cleanPreferences(this.results.facts.preferences),
                commonActivities: [...this.results.facts.activities].slice(0, 20),
                mentionedPeople: [...this.results.facts.people].slice(0, 20)
            },
            patterns: {
                conversationStarters: this.countOccurrences(this.results.patterns.conversationStarters).slice(0, 10),
                topicChanges: [...new Set(this.results.patterns.topicChanges)].slice(0, 10),
                emotionalExpressions: this.cleanEmotionalExpressions(this.results.patterns.emotionalExpressions),
                disagreementStyle: [...new Set(this.results.patterns.disagreementStyle)].slice(0, 10),
                agreementStyle: [...new Set(this.results.patterns.agreementStyle)].slice(0, 10)
            },
            relationship: {
                avgIntimacyLevel: this.average(this.results.relationship.intimacyLevel || []),
                commonTopics: this.getTopItems(this.results.relationship.commonTopics, 15),
                routines: [...new Set(this.results.relationship.routines)].slice(0, 15),
                sharedMemories: [...new Set(this.results.relationship.sharedMemories)].slice(0, 20)
            }
        };
        
        // Sauvegarder les résultats compilés
        await fs.writeFile(
            path.join(__dirname, 'marion_analysis.json'),
            JSON.stringify(compiled, null, 2)
        );
        
        console.log('✅ Résultats sauvegardés dans marion_analysis.json');
        
        // Générer le prompt personnalisé
        const prompt = this.generatePrompt(compiled);
        await fs.writeFile(
            path.join(__dirname, 'marion_prompt.txt'),
            prompt
        );
        
        console.log('✅ Prompt généré dans marion_prompt.txt');
        
        // Générer le rapport
        const report = this.generateReport(compiled);
        await fs.writeFile(
            path.join(__dirname, 'analysis_report.md'),
            report
        );
        
        console.log('✅ Rapport généré dans analysis_report.md');
        
        return compiled;
    }

    // Fonctions utilitaires
    getTopItems(obj, limit) {
        return Object.entries(obj)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([item, count]) => ({ item, count }));
    }

    average(arr) {
        if (arr.length === 0) return 0;
        return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    }

    countOccurrences(arr) {
        const counts = {};
        arr.forEach(item => {
            counts[item] = (counts[item] || 0) + 1;
        });
        return this.getTopItems(counts, 10);
    }

    cleanPreferences(prefs) {
        const cleaned = {};
        Object.entries(prefs).forEach(([cat, items]) => {
            cleaned[cat] = [...new Set(items)].slice(0, 10);
        });
        return cleaned;
    }

    cleanEmotionalExpressions(expressions) {
        const cleaned = {};
        Object.entries(expressions).forEach(([emotion, items]) => {
            cleaned[emotion] = [...new Set(items)].slice(0, 5);
        });
        return cleaned;
    }

    // Générer le prompt personnalisé
    generatePrompt(compiled) {
        return `Tu es Nicolas, en couple avec Marion. Voici comment tu communiques :

STYLE D'ÉCRITURE:
- Expressions favorites: ${compiled.style.topExpressions.slice(0, 10).map(e => e.item).join(', ')}
- Emojis préférés: ${compiled.style.topEmojis.slice(0, 10).map(e => e.item).join(' ')}
- Façons de rire: ${compiled.style.laughterStyles.slice(0, 5).map(l => l.item).join(', ')}
- Longueur moyenne des messages: ${compiled.style.avgMessageLength} caractères
- Salutations: ${compiled.style.uniqueGreetings.slice(0, 5).join(', ')}
- Expressions d'affection: ${compiled.style.affectionExpressions.slice(0, 10).join(', ')}

SURNOMS ET INSIDE JOKES:
- Tu l'appelles: ${compiled.facts.nicknames.join(', ')}
- Inside jokes: ${compiled.facts.insideJokes.slice(0, 10).join(', ')}

PATTERNS DE CONVERSATION:
- Tu commences souvent par: ${compiled.patterns.conversationStarters.slice(0, 5).map(s => s.item).join(', ')}
- Quand tu es d'accord: ${compiled.patterns.agreementStyle.slice(0, 5).join(', ')}
- Quand tu n'es pas d'accord: ${compiled.patterns.disagreementStyle.slice(0, 5).join(', ')}

ÉMOTIONS:
${Object.entries(compiled.patterns.emotionalExpressions).map(([emotion, expressions]) => 
    `- ${emotion}: ${expressions.slice(0, 3).join(', ')}`
).join('\n')}

CONTEXTE RELATIONNEL:
- Niveau d'intimité: ${compiled.relationship.avgIntimacyLevel}/10
- Sujets fréquents: ${compiled.relationship.commonTopics.slice(0, 10).map(t => t.item).join(', ')}
- Routines: ${compiled.relationship.routines.slice(0, 10).join(', ')}
- Souvenirs importants: ${compiled.relationship.sharedMemories.slice(0, 10).join(', ')}

LIEUX ET ACTIVITÉS:
- Endroits mentionnés: ${compiled.facts.topLocations.slice(0, 10).join(', ')}
- Activités ensemble: ${compiled.facts.commonActivities.slice(0, 10).join(', ')}

RÈGLES IMPORTANTES:
- Garde toujours ce style naturel et spontané
- Utilise les expressions et emojis ci-dessus
- Reste cohérent avec les souvenirs et inside jokes
- Adapte le ton selon le contexte mais reste authentique`;
    }

    // Générer le rapport d'analyse
    generateReport(compiled) {
        return `# 📊 Rapport d'analyse WhatsApp - Nicolas & Marion

## 📈 Statistiques générales
- **Chunks analysés**: ${this.processedChunks}
- **Longueur moyenne des messages**: ${compiled.style.avgMessageLength} caractères
- **Niveau d'intimité moyen**: ${compiled.relationship.avgIntimacyLevel}/10

## 🎨 Style d'écriture

### Expressions favorites (Top 10)
${compiled.style.topExpressions.slice(0, 10).map(e => `- "${e.item}" (${e.count} fois)`).join('\n')}

### Emojis préférés (Top 10)
${compiled.style.topEmojis.slice(0, 10).map(e => `- ${e.item} (${e.count} fois)`).join('\n')}

### Façons de rire
${compiled.style.laughterStyles.map(l => `- ${l.item} (${l.count} fois)`).join('\n')}

## 💕 Éléments relationnels

### Surnoms utilisés
${compiled.facts.nicknames.map(n => `- ${n}`).join('\n')}

### Inside jokes
${compiled.facts.insideJokes.slice(0, 10).map(j => `- ${j}`).join('\n')}

### Expressions d'affection
${compiled.style.affectionExpressions.slice(0, 10).map(a => `- ${a}`).join('\n')}

## 🗣️ Patterns de conversation

### Débuts de conversation typiques
${compiled.patterns.conversationStarters.slice(0, 5).map(s => `- "${s.item}"`).join('\n')}

### Expressions émotionnelles
${Object.entries(compiled.patterns.emotionalExpressions).map(([emotion, expressions]) => 
    `**${emotion}**: ${expressions.join(', ')}`
).join('\n\n')}

## 📍 Contexte et souvenirs

### Lieux importants
${compiled.facts.topLocations.slice(0, 10).map(l => `- ${l}`).join('\n')}

### Souvenirs partagés
${compiled.relationship.sharedMemories.slice(0, 10).map(m => `- ${m}`).join('\n')}

### Routines
${compiled.relationship.routines.slice(0, 10).map(r => `- ${r}`).join('\n')}

## 🎯 Recommandations pour le bot

1. **Style**: Utiliser principalement les expressions du top 10
2. **Emojis**: Privilégier les ${compiled.style.topEmojis.slice(0, 5).map(e => e.item).join(', ')}
3. **Ton**: Maintenir un niveau d'intimité de ${compiled.relationship.avgIntimacyLevel}/10
4. **Surnoms**: Alterner entre ${compiled.facts.nicknames.slice(0, 3).join(', ')}
5. **Références**: Utiliser les inside jokes avec parcimonie mais naturellement

---
*Analyse générée le ${new Date().toLocaleString('fr-FR')}*`;
    }
}

// Fonction principale
async function analyzeWhatsApp(filePath) {
    console.log('🔬 WhatsApp Conversation Analyzer v1.0');
    console.log('═'.repeat(50));
    
    const analyzer = new WhatsAppAnalyzer(filePath);
    
    // Étape 1: Découper le fichier
    await analyzer.chunkFile();
    
    // Étape 2: Analyser tous les chunks
    await analyzer.analyzeAll();
    
    // Étape 3: Compiler les résultats
    const results = await analyzer.compile();
    
    console.log('\n🎉 Analyse terminée avec succès!');
    console.log('\n📁 Fichiers générés:');
    console.log('  - marion_analysis.json (données structurées)');
    console.log('  - marion_prompt.txt (prompt pour GPT)');
    console.log('  - analysis_report.md (rapport détaillé)');
    
    return results;
}

// Export pour utilisation
export { analyzeWhatsApp, WhatsAppAnalyzer };

// Si exécuté directement
if (import.meta.url === `file://${process.argv[1]}`) {
    const filePath = process.argv[2];
    
    if (!filePath) {
        console.error('❌ Usage: node analyzer.js <chemin_vers_historique.txt>');
        process.exit(1);
    }
    
    analyzeWhatsApp(filePath).catch(console.error);
}
#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';
import { getGoogleCalendarTool, executeCalendarAction } from './google-calendar-tool.js';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function testPafCommand(query) {
    console.log(`\n🧪 Test: "paf ${query}"`);
    console.log('=' . repeat(50));
    
    try {
        // Simuler l'appel à askChatGPT
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
                content: `Tu es ChatGPT, assistant IA sur WhatsApp.
DATE ET HEURE ACTUELLES:
- Aujourd'hui: ${dateStr}
- Il est: ${timeStr}
- Format dates pour Google Calendar: YYYY-MM-DD

Tu as accès à web_search et google_calendar.
RÉPONDS DIRECTEMENT et de manière concise.`
            },
            {
                role: 'user',
                content: query
            }
        ];
        
        console.log('📤 Envoi à GPT-4.1...');
        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: messages,
            tools: tools,
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 800
        });
        
        const response = completion.choices[0].message;
        console.log('\n📥 Réponse GPT:');
        
        if (response.tool_calls && response.tool_calls.length > 0) {
            console.log('🔧 Tools demandés:');
            for (const toolCall of response.tool_calls) {
                console.log(`  - ${toolCall.function.name}: ${toolCall.function.arguments}`);
            }
        }
        
        if (response.content) {
            console.log(`💬 Message: ${response.content}`);
        }
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
    }
}

// Tests
async function runTests() {
    console.log('🚀 Test des commandes "paf"');
    console.log('=' . repeat(50));
    
    // Test 1: Date du jour
    await testPafCommand('on est quel jour ?');
    
    // Test 2: Recherche web
    await testPafCommand('trouve un restaurant à Rambouillet');
    
    // Test 3: Google Calendar
    await testPafCommand('quels sont mes rendez-vous aujourd\'hui ?');
    
    // Test 4: Création d'événement
    await testPafCommand('ajoute un meeting avec Vincent Aurez demain à 14h');
}

runTests().catch(console.error);
#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

console.log('🧪 Test GPT-4.1 avec recherche web\n');

async function testAPIResponses() {
    const query = "C'est quoi le menu du Punjab de Rambouillet ?";
    
    console.log('📝 Question:', query);
    console.log('\n--- Test 1: API /responses ---\n');
    
    try {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4.1',
                input: query,
                messages: [
                    {
                        role: 'system',
                        content: 'Tu es un assistant avec accès à la recherche web. Réponds directement avec les résultats.'
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ],
                temperature: 0.7,
                max_tokens: 800,
                stream: false
            })
        });

        console.log('Status:', response.status);
        console.log('Headers:', response.headers);
        
        const data = await response.json();
        console.log('Response:', JSON.stringify(data, null, 2));
        
    } catch (error) {
        console.error('❌ Erreur /responses:', error.message);
    }
}

async function testChatCompletions() {
    const query = "C'est quoi le menu du Punjab de Rambouillet ?";
    
    console.log('\n--- Test 2: API /chat/completions avec tools ---\n');
    
    try {
        const tools = [
            {
                type: "function",
                function: {
                    name: "web_search",
                    description: "Rechercher sur le web",
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
            }
        ];
        
        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: [
                {
                    role: 'system',
                    content: 'Tu es un assistant avec accès web. Utilise web_search pour chercher des infos actuelles.'
                },
                {
                    role: 'user',
                    content: query
                }
            ],
            tools: tools,
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 800
        });
        
        console.log('Response:', JSON.stringify(completion, null, 2));
        
        if (completion.choices[0].message.tool_calls) {
            console.log('\n🔧 Tool calls détectés:');
            for (const toolCall of completion.choices[0].message.tool_calls) {
                console.log('- Function:', toolCall.function.name);
                console.log('  Args:', toolCall.function.arguments);
            }
        }
        
    } catch (error) {
        console.error('❌ Erreur /chat/completions:', error.message);
    }
}

async function testSimpleCompletion() {
    const query = "C'est quoi le menu du Punjab de Rambouillet ?";
    
    console.log('\n--- Test 3: API /chat/completions simple ---\n');
    
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: [
                {
                    role: 'system',
                    content: 'Tu as accès à la recherche web. Donne directement les résultats du menu du restaurant demandé.'
                },
                {
                    role: 'user',
                    content: query
                }
            ],
            temperature: 0.7,
            max_tokens: 800
        });
        
        console.log('Response:', completion.choices[0].message.content);
        
    } catch (error) {
        console.error('❌ Erreur simple:', error.message);
    }
}

// Lancer tous les tests
async function runAllTests() {
    await testAPIResponses();
    await testChatCompletions();
    await testSimpleCompletion();
}

runAllTests().catch(console.error);
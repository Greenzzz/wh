#!/usr/bin/env node

import { executeCalendarAction } from './google-calendar-tool.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
    console.log('🧪 Test Google Calendar\n');
    
    try {
        const result = await executeCalendarAction({
            action: 'list_events',
            date: new Date().toISOString().split('T')[0]
        });
        
        console.log('Résultat:', result);
    } catch (error) {
        console.error('Erreur:', error.message);
    }
}

test();
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp AI Responder - A Node.js application that automatically responds to WhatsApp messages using OpenAI's GPT models, impersonating the user in an undetectable way.

## Development Commands

```bash
# Install dependencies
npm install

# Start the full application (server + bot)
npm start

# Start only the WhatsApp bot
npm run bot

# Start only the web server
npm run server

# Development mode with auto-reload
npm run dev

# Run individual test files
node test-*.js
```

## Architecture

### Core Components

1. **src/server.js** - Express server providing:
   - Web interface at http://localhost:3000
   - REST API for bot control
   - Profile management endpoints
   - Real-time bot status management

2. **src/index.js** - Main WhatsApp bot:
   - WhatsApp Web.js client connection
   - OpenAI GPT integration
   - Message processing and response generation
   - Memory and context management
   - Auto-correction system
   - Discord notification system

3. **src/profileManager.js** - Profile management system for different conversation personalities

4. **google-calendar-tool.js** - Google Calendar integration for scheduling

### Key Files

- **context.json** - Personal context configuration (work, hobbies, routine)
- **memory.json** - Long-term conversation memory
- **contacts.json** - Contact information storage
- **.env** - Environment variables (copy from .env.example)
- **public/** - Web interface files

### Message Flow

1. WhatsApp message received ’ Check if authorized number
2. Load context and memory ’ Build conversation history
3. Send to GPT with appropriate prompt ’ Generate response
4. Apply delays and typing simulation ’ Send response
5. Update memory if important ’ Save conversation

## Key Features to Maintain

- **Typing Simulation**: Realistic delays between messages (phase system)
- **Auto-correction**: Fix typos in outgoing messages
- **Memory System**: Track important conversations in memory.json
- **Context Awareness**: Time-based responses, custom contexts
- **Profile System**: Different personalities for different contacts
- **Google Calendar**: Integration for scheduling events
- **Discord Notifications**: Alert on urgent keywords

## Testing Approach

Individual test files for specific features:
- `test-whatsapp.js` - Core WhatsApp functionality
- `test-contacts.js` - Contact management
- `test-calendar.js` - Google Calendar integration
- `test-update-event.js` - Event modifications
- `test-paf.js` - Auto-correction system

## Important Considerations

- All modules use ES6 imports (type: "module" in package.json)
- WhatsApp session persisted in .wwebjs_auth/
- Bot state managed through server.js, not directly
- Response delays follow a three-phase system (active ’ transition ’ busy)
- Memory limited to 50 important exchanges
- Auto-correction preserves SMS style while fixing obvious typos
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// Configuration Google APIs
const calendar = google.calendar('v3');
const people = google.people('v1');

// Fonction tool pour Google Calendar
export function getGoogleCalendarTool() {
    return {
        type: "function",
        function: {
            name: "google_calendar",
            description: "Gérer Google Calendar: voir les événements, créer des rendez-vous, vérifier les disponibilités",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["list_events", "create_event", "check_availability", "delete_event", "update_event"],
                        description: "L'action à effectuer sur le calendrier"
                    },
                    date: {
                        type: "string",
                        description: "Date pour l'action (format: YYYY-MM-DD)"
                    },
                    time: {
                        type: "string",
                        description: "Heure pour l'événement (format: HH:MM)"
                    },
                    duration: {
                        type: "number",
                        description: "Durée en minutes"
                    },
                    title: {
                        type: "string",
                        description: "Titre de l'événement"
                    },
                    description: {
                        type: "string",
                        description: "Description de l'événement"
                    },
                    location: {
                        type: "string",
                        description: "Lieu de l'événement"
                    },
                    attendees: {
                        type: "array",
                        items: {
                            type: "string"
                        },
                        description: "Liste des emails des participants"
                    },
                    oldTime: {
                        type: "string",
                        description: "Ancienne heure de l'événement à modifier (format: HH:MM)"
                    },
                    newTime: {
                        type: "string",
                        description: "Nouvelle heure pour l'événement (format: HH:MM)"
                    },
                    newDate: {
                        type: "string",
                        description: "Nouvelle date pour l'événement (format: YYYY-MM-DD)"
                    }
                },
                required: ["action"]
            }
        }
    };
}

// Fonction pour chercher un contact (Google + fallback local)
async function searchContact(name) {
    // D'abord essayer avec Google Contacts
    try {
        const response = await people.people.connections.list({
            resourceName: 'people/me',
            pageSize: 100,
            personFields: 'names,emailAddresses',
        });
        
        const connections = response.data.connections || [];
        
        // Chercher le contact par nom (insensible à la casse)
        const searchName = name.toLowerCase();
        for (const person of connections) {
            if (person.names) {
                for (const nameEntry of person.names) {
                    const fullName = nameEntry.displayName?.toLowerCase() || '';
                    const firstName = nameEntry.givenName?.toLowerCase() || '';
                    const lastName = nameEntry.familyName?.toLowerCase() || '';
                    
                    if (fullName.includes(searchName) || 
                        firstName.includes(searchName) || 
                        lastName.includes(searchName) ||
                        searchName.includes(firstName) ||
                        searchName.includes(lastName)) {
                        
                        // Retourner le premier email trouvé
                        if (person.emailAddresses && person.emailAddresses.length > 0) {
                            console.log(`Contact trouvé dans Google: ${name} → ${person.emailAddresses[0].value}`);
                            return person.emailAddresses[0].value;
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.log('Google Contacts non accessible, utilisation du fichier local');
    }
    
    // Fallback: chercher dans le fichier contacts.json
    try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        
        const contactsFile = await fs.readFile(path.join(__dirname, 'contacts.json'), 'utf-8');
        const contactsData = JSON.parse(contactsFile);
        
        const searchName = name.toLowerCase();
        for (const [contactName, email] of Object.entries(contactsData.contacts)) {
            if (contactName.toLowerCase().includes(searchName) || 
                searchName.includes(contactName.toLowerCase())) {
                console.log(`Contact trouvé dans fichier local: ${name} → ${email}`);
                return email;
            }
        }
    } catch (error) {
        console.log('Erreur lecture fichier contacts.json:', error.message);
    }
    
    console.log(`Contact "${name}" non trouvé`);
    return null;
}

// Fonction pour exécuter les actions Google Calendar
export async function executeCalendarAction(args, auth) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    
    // Utiliser le token stocké
    oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    
    google.options({ auth: oauth2Client });
    
    switch (args.action) {
        case 'list_events':
            return await listEvents(args.date);
            
        case 'create_event':
            return await createEvent({
                title: args.title,
                date: args.date,
                time: args.time,
                duration: args.duration || 60,
                description: args.description,
                location: args.location,
                attendees: args.attendees
            });
            
        case 'check_availability':
            return await checkAvailability(args.date, args.time);
            
        case 'delete_event':
            return await deleteEvent(args.title, args.date);
            
        case 'update_event':
            return await updateEvent({
                title: args.title,
                date: args.date,
                oldTime: args.oldTime,
                newTime: args.newTime,
                newDate: args.newDate,
                duration: args.duration,
                description: args.description,
                location: args.location,
                attendees: args.attendees
            });
            
        default:
            return "Action non reconnue";
    }
}

async function listEvents(date) {
    try {
        const startDate = date ? new Date(date) : new Date();
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
        
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        
        const events = response.data.items;
        if (!events || events.length === 0) {
            return `📅 Aucun événement prévu le ${startDate.toLocaleDateString('fr-FR')}`;
        }
        
        let result = `📅 Événements du ${startDate.toLocaleDateString('fr-FR')}:\n`;
        events.forEach(event => {
            const start = event.start.dateTime || event.start.date;
            const time = new Date(start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            result += `• ${time} - ${event.summary}`;
            if (event.location) result += ` 📍 ${event.location}`;
            result += '\n';
        });
        
        return result;
    } catch (error) {
        console.error('Erreur liste événements:', error);
        return '❌ Erreur lors de la récupération des événements';
    }
}

async function createEvent(eventData) {
    try {
        const startDateTime = new Date(`${eventData.date}T${eventData.time}:00`);
        const endDateTime = new Date(startDateTime);
        endDateTime.setMinutes(endDateTime.getMinutes() + eventData.duration);
        
        const event = {
            summary: eventData.title,
            description: eventData.description,
            location: eventData.location,
            start: {
                dateTime: startDateTime.toISOString(),
                timeZone: 'Europe/Paris',
            },
            end: {
                dateTime: endDateTime.toISOString(),
                timeZone: 'Europe/Paris',
            },
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 10 },
                ],
            },
        };
        
        // Ajouter les participants si fournis
        if (eventData.attendees && eventData.attendees.length > 0) {
            const attendeeEmails = [];
            
            for (const attendee of eventData.attendees) {
                // Si c'est déjà un email, l'utiliser directement
                if (attendee.includes('@')) {
                    attendeeEmails.push({ email: attendee });
                } else {
                    // Sinon, chercher dans les contacts Google
                    console.log(`Recherche du contact: ${attendee}`);
                    const email = await searchContact(attendee);
                    if (email) {
                        console.log(`Contact trouvé: ${attendee} → ${email}`);
                        attendeeEmails.push({ email });
                    } else {
                        console.log(`Contact non trouvé: ${attendee}`);
                    }
                }
            }
            
            if (attendeeEmails.length > 0) {
                event.attendees = attendeeEmails;
            }
        }
        
        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });
        
        return `✅ Événement créé: "${eventData.title}" le ${startDateTime.toLocaleDateString('fr-FR')} à ${startDateTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
        console.error('Erreur création événement:', error);
        return '❌ Erreur lors de la création de l\'événement';
    }
}

async function checkAvailability(date, time) {
    try {
        const checkDateTime = new Date(`${date}T${time}:00`);
        const startCheck = new Date(checkDateTime);
        startCheck.setMinutes(startCheck.getMinutes() - 30);
        const endCheck = new Date(checkDateTime);
        endCheck.setMinutes(endCheck.getMinutes() + 90);
        
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: startCheck.toISOString(),
                timeMax: endCheck.toISOString(),
                items: [{ id: 'primary' }],
            },
        });
        
        const busy = response.data.calendars.primary.busy;
        if (busy && busy.length > 0) {
            return `⚠️ Tu as déjà quelque chose de prévu autour de ${time} le ${date}`;
        }
        
        return `✅ Tu es disponible le ${date} à ${time}`;
    } catch (error) {
        console.error('Erreur vérification disponibilité:', error);
        return '❌ Erreur lors de la vérification';
    }
}

async function updateEvent(eventData) {
    try {
        // Chercher l'événement existant
        const searchDate = eventData.date ? new Date(eventData.date) : new Date();
        searchDate.setHours(0, 0, 0, 0);
        const endSearchDate = new Date(searchDate);
        endSearchDate.setDate(endSearchDate.getDate() + 1);
        
        console.log(`[CALENDAR] Recherche de l'événement "${eventData.title}" le ${searchDate.toLocaleDateString('fr-FR')}`);
        
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: searchDate.toISOString(),
            timeMax: endSearchDate.toISOString(),
            q: eventData.title,
            singleEvents: true,
            orderBy: 'startTime'
        });
        
        const events = response.data.items;
        if (!events || events.length === 0) {
            return `❌ Aucun événement "${eventData.title}" trouvé le ${searchDate.toLocaleDateString('fr-FR')}`;
        }
        
        // Trouver l'événement correspondant (si oldTime spécifié, chercher par heure)
        let eventToUpdate = events[0];
        if (eventData.oldTime && events.length > 1) {
            const targetTime = eventData.oldTime.replace(':', '');
            eventToUpdate = events.find(event => {
                const eventTime = new Date(event.start.dateTime || event.start.date)
                    .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                    .replace(':', '');
                return eventTime === targetTime;
            }) || events[0];
        }
        
        console.log(`[CALENDAR] Événement trouvé: ${eventToUpdate.summary} (ID: ${eventToUpdate.id})`);
        
        // Récupérer l'événement complet
        const existingEvent = await calendar.events.get({
            calendarId: 'primary',
            eventId: eventToUpdate.id
        });
        
        // Préparer les nouvelles données
        const updatedEvent = { ...existingEvent.data };
        
        // Mettre à jour la date et l'heure si nécessaire
        if (eventData.newTime || eventData.newDate) {
            const newDate = eventData.newDate ? new Date(eventData.newDate) : new Date(existingEvent.data.start.dateTime || existingEvent.data.start.date);
            
            if (eventData.newTime) {
                const [hours, minutes] = eventData.newTime.split(':');
                newDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            } else {
                // Garder l'heure existante
                const existingDate = new Date(existingEvent.data.start.dateTime || existingEvent.data.start.date);
                newDate.setHours(existingDate.getHours(), existingDate.getMinutes(), 0, 0);
            }
            
            const duration = eventData.duration || 
                (existingEvent.data.end && existingEvent.data.start ? 
                    (new Date(existingEvent.data.end.dateTime) - new Date(existingEvent.data.start.dateTime)) / 60000 : 
                    60);
            
            const endDate = new Date(newDate);
            endDate.setMinutes(endDate.getMinutes() + duration);
            
            updatedEvent.start = {
                dateTime: newDate.toISOString(),
                timeZone: 'Europe/Paris'
            };
            updatedEvent.end = {
                dateTime: endDate.toISOString(),
                timeZone: 'Europe/Paris'
            };
        }
        
        // Mettre à jour les autres champs si fournis
        if (eventData.description !== undefined) {
            updatedEvent.description = eventData.description;
        }
        if (eventData.location !== undefined) {
            updatedEvent.location = eventData.location;
        }
        
        // Gérer les participants
        if (eventData.attendees !== undefined) {
            const attendeeEmails = [];
            for (const attendee of eventData.attendees) {
                if (attendee.includes('@')) {
                    attendeeEmails.push({ email: attendee });
                } else {
                    const email = await searchContact(attendee);
                    if (email) {
                        attendeeEmails.push({ email });
                    }
                }
            }
            if (attendeeEmails.length > 0) {
                updatedEvent.attendees = attendeeEmails;
            }
        }
        
        // Mettre à jour l'événement
        const result = await calendar.events.update({
            calendarId: 'primary',
            eventId: eventToUpdate.id,
            resource: updatedEvent
        });
        
        const newStartTime = new Date(result.data.start.dateTime || result.data.start.date);
        return `✅ Événement "${eventData.title}" déplacé au ${newStartTime.toLocaleDateString('fr-FR')} à ${newStartTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
        
    } catch (error) {
        console.error('Erreur mise à jour événement:', error);
        return `❌ Erreur lors de la mise à jour de l'événement: ${error.message}`;
    }
}

async function deleteEvent(title, date) {
    try {
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
        
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            q: title,
            singleEvents: true,
        });
        
        const events = response.data.items;
        if (!events || events.length === 0) {
            return `❌ Aucun événement "${title}" trouvé le ${date}`;
        }
        
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: events[0].id,
        });
        
        return `✅ Événement "${title}" supprimé`;
    } catch (error) {
        console.error('Erreur suppression événement:', error);
        return '❌ Erreur lors de la suppression';
    }
}
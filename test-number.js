// Test de correspondance des numéros
const phoneNumber = "33768102706@c.us";  // Format WhatsApp
const contactPhone = "+33768102706";     // Format config

// Nettoyer le numéro entrant
const cleanNumber = phoneNumber.replace(/@c\.us/g, '').replace(/\D/g, '');
console.log("Numéro nettoyé:", cleanNumber);  // "33768102706"

// Nettoyer le numéro du contact
const contactCleanNumber = contactPhone.replace(/\D/g, '');
console.log("Contact nettoyé:", contactCleanNumber);  // "33768102706"

// Tests de correspondance
console.log("\nTests:");
console.log("Correspondance exacte:", contactCleanNumber === cleanNumber);
console.log("Sans code pays (endsWith):", cleanNumber.endsWith(contactCleanNumber.substring(2)));
console.log("Sans code pays (inverse):", contactCleanNumber.endsWith(cleanNumber.substring(2)));
console.log("Sans code pays (direct):", cleanNumber === contactCleanNumber.substring(2));

// Conditions du profileManager
if (contactCleanNumber === cleanNumber || 
    cleanNumber.endsWith(contactCleanNumber.substring(2)) || 
    contactCleanNumber.endsWith(cleanNumber.substring(2)) || 
    cleanNumber === contactCleanNumber.substring(2)) {
    console.log("\n✅ Le numéro devrait être reconnu!");
} else {
    console.log("\n❌ Le numéro ne sera pas reconnu");
}
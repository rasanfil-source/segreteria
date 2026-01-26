/**
 * TerritoryValidator.gs - Validazione indirizzi territorio parrocchiale
 * 
 * Verifica se un indirizzo appartiene al territorio della parrocchia
 * basandosi su un database di vie e numeri civici.
 */

class TerritoryValidator {
    constructor() {
        // Database territorio con vie e numeri civici accettati
        this.territory = {
            'via adolfo cancani': { tutti: true },
            'via antonio allegri da correggio': { tutti: true },
            'via antonio gramsci': { tutti: true },
            'via armando spadini': { tutti: true },
            'via bartolomeo ammannati': { tutti: true },
            'piazzale delle belle arti': { tutti: true },
            'viale delle belle arti': { tutti: true },
            'viale bruno buozzi': { dispari: [109, null], pari: [90, null] },
            'via cardinal de luca': { tutti: true },
            'via carlo dolci': { tutti: true },
            'via cesare fracassini': { dispari: [1, null] },
            'via cimabue': { tutti: true },
            'via domenico alberto azuni': { dispari: [1, null] },
            'piazzale don giovanni minzoni': { tutti: true },
            'via enrico chiaradia': { tutti: true },
            'via enrico pessina': { tutti: true },
            'via filippo lippi': { tutti: true },
            'via flaminia': { dispari: [109, 217], pari: [158, 162] },
            'lungotevere flaminio': { tutti: [16, 38] },
            'via francesco jacovacci': { tutti: true },
            'via giovanni vincenzo gravina': { tutti: true },
            'via giuseppe ceracchi': { tutti: true },
            'via giuseppe de notaris': { tutti: true },
            'via giuseppe mangili': { dispari: [1, null] },
            'via jacopo da ponte': { tutti: true },
            'via luigi canina': { tutti: true },
            'piazzale manila': { tutti: true },
            'piazza marina': { tutti: [24, 35] },
            'piazza della marina': { tutti: [24, 35] },
            'piazzale miguel cervantes': { tutti: true },
            'largo dei monti parioli': { tutti: true },
            'via monti parioli': { dispari: [1, 33], pari: [4, 62] },
            'lungotevere delle navi': { tutti: true },
            'via omero': { dispari: [1, null] },
            'via paolo bartolini': { tutti: true },
            'salita dei parioli': { dispari: [1, null] },
            'via pietro da cortona': { tutti: true },
            'via pietro paolo rubens': { pari: [2, null] },
            'via pomarancio': { tutti: true },
            'via sandro botticelli': { tutti: true },
            'via sassoferrato': { tutti: true },
            'via sebastiano conca': { tutti: true },
            'viale tiziano': { tutti: true },
            'via ulisse aldrovandi': { dispari: [1, 9] },
            'via valmichi': { dispari: [1, null] },
            'via di villa giulia': { tutti: true },
            'piazzale di villa giulia': { tutti: true }
        };
    }

    normalizeStreetName(street) {
        let normalized = street.toLowerCase().trim();
        return normalized.replace(/\s+/g, ' ');
    }

    /**
     * Cerca una corrispondenza nel DB territorio usando matching flessibile (fuzzy)
     * Es. "Via Cancani" deve matchare "Via Adolfo Cancani"
     */
    findTerritoryMatch(inputStreet) {
        const normalizedInput = this.normalizeStreetName(inputStreet);

        // 1. Match Esatto
        if (this.territory[normalizedInput]) {
            console.log(`🔍 Match esatto trovato: '${normalizedInput}'`);
            return { key: normalizedInput, rules: this.territory[normalizedInput] };
        }

        // 2. Match per Token (es. "via cancani" -> "via adolfo cancani")
        // Dividi input in parole (token)
        const inputTokens = normalizedInput.split(' ').filter(t => t.length > 0);

        // Se l'input è troppo breve (es. solo "via"), evita falsi positivi
        if (inputTokens.length < 2 && inputTokens[0] === 'via') {
            return null;
        }

        // Cerca nelle chiavi del territorio
        for (const dbKey of Object.keys(this.territory)) {
            const dbTokens = dbKey.split(' ');

            // Verifica se TUTTI i token dell'input sono presenti nella chiave DB
            // (ordine non importante)
            const isMatch = inputTokens.every(token => dbTokens.includes(token));

            if (isMatch) {
                console.log(`🔍 Match fuzzy trovato: '${inputStreet}' -> '${dbKey}'`);
                return { key: dbKey, rules: this.territory[dbKey] };
            }
        }

        return null; // Nessun match trovato
    }

    /**
     * Estrae indirizzi da un testo
     * Estrazione sicura: limita lunghezza input e usa pattern efficienti
     */
    extractAddressFromText(text) {
        // Limita lunghezza input per sicurezza
        if (text && text.length > 1000) {
            text = text.substring(0, 1000);
        }

        // Pattern ottimizzati per sicurezza (backtracking limitato)
        const patterns = [
            // Pattern 1: "via Rossi 10"
            /((?:via|viale|piazza|piazzale|largo|lungotevere|salita)\s+(?:[a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s+){0,6}?[a-zA-ZàèéìòùÀÈÉÌÒÙ']+)\s+(?:n\.?\s*|civico\s+)?(\d+)/gi,

            // Pattern 2: "abito in... via Rossi 10"
            /(?:in|abito\s+in|abito\s+al|abito\s+alle|abito\s+a|al|alle)\s+((?:via|viale|piazza|piazzale|largo|lungotevere|salita)\s+(?:[a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s+){0,6}?[a-zA-ZàèéìòùÀÈÉÌÒÙ']+)\s+(?:n\.?\s*|civico\s+)?(\d+)/gi
        ];

        const addresses = [];

        for (const pattern of patterns) {
            let match;
            try {
                while ((match = pattern.exec(text)) !== null) {
                    const street = match[1].trim();
                    const civicRaw = match[2];
                    const civic = parseInt(civicRaw, 10);

                    if (isNaN(civic) || civic <= 0) {
                        console.warn(`⚠️ Numero civico non valido: ${civicRaw} per via ${street}`);
                        continue;
                    }

                    // Evita duplicati
                    const isDuplicate = addresses.some(addr =>
                        addr.street.toLowerCase() === street.toLowerCase() && addr.civic === civic
                    );

                    if (!isDuplicate) {
                        addresses.push({ street: street, civic: civic });
                        console.log(`📍 Indirizzo rilevato: ${street} n. ${civic}`);
                    }
                }
            } catch (e) {
                console.warn(`⚠️ Pattern match fallito: ${e.message}`);
            }
        }

        return addresses.length > 0 ? addresses : null;
    }

    /**
     * Estrae vie dal testo quando manca il numero civico
     */
    extractStreetOnlyFromText(text) {
        if (text && text.length > 1000) {
            text = text.substring(0, 1000);
        }

        // Fix: Aggiunto \b prima del lookahead negativo per evitare che il regex
        // "mangi" l'ultima lettera della via (es. "Cancani" -> "Cancan") per soddisfare
        // la condizione "non seguito da numero".
        const pattern = /((?:via|viale|piazza|piazzale|largo|lungotevere|salita)\s+(?:[a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s+){0,6}?[a-zA-ZàèéìòùÀÈÉÌÒÙ']+)\b(?!\s*(?:n\.?\s*|civico\s+)?\d+)/gi;
        const streets = [];

        let match;
        try {
            while ((match = pattern.exec(text)) !== null) {
                const street = match[1].trim();
                const isDuplicate = streets.some(existing =>
                    existing.toLowerCase() === street.toLowerCase()
                );

                if (!isDuplicate) {
                    streets.push(street);
                    console.log(`📍 Via rilevata senza civico: ${street}`);
                }
            }
        } catch (e) {
            console.warn(`⚠️ Pattern match fallito (street-only): ${e.message}`);
        }

        return streets.length > 0 ? streets : null;
    }

    /**
     * Verifica se un indirizzo appartiene al territorio parrocchiale
     */
    verifyAddress(street, civicNumber) {
        // Usa il nuovo metodo di ricerca match
        const match = this.findTerritoryMatch(street);

        // Controlla se la via esiste nel territorio
        if (!match) {
            return {
                inParish: false,
                reason: `'${street}' non è nel territorio della nostra parrocchia`,
                details: 'street_not_found'
            };
        }

        const rules = match.rules;
        // const normalizedStreet = match.key; // Non usato ma disponibile

        // Caso 1: Tutti i numeri civici accettati
        if (rules.tutti === true) {
            return {
                inParish: true,
                reason: `'${street}' è completamente nel territorio parrocchiale`,
                details: 'all_numbers'
            };
        }

        // Caso 2: Range specifico per tutti i numeri
        if (Array.isArray(rules.tutti)) {
            const [minNum, maxNum] = rules.tutti;
            if (civicNumber >= minNum && (maxNum === null || civicNumber <= maxNum)) {
                const rangeStr = maxNum ? `dal ${minNum} al ${maxNum}` : `dal ${minNum} in poi`;
                return {
                    inParish: true,
                    reason: `'${street}' n. ${civicNumber} è nel territorio (numeri ${rangeStr})`,
                    details: `range_${minNum}_${maxNum}`
                };
            }
        }

        // Caso 3: Numeri pari/dispari con range
        const isOdd = civicNumber % 2 === 1;
        const isEven = civicNumber % 2 === 0;

        if (isOdd && rules.dispari) {
            const [minNum, maxNum] = rules.dispari;
            if (civicNumber >= minNum && (maxNum === null || civicNumber <= maxNum)) {
                return {
                    inParish: true,
                    reason: `'${street}' n. ${civicNumber} è nel territorio (numeri dispari)`,
                    details: `odd_range`
                };
            }
        }

        if (isEven && rules.pari) {
            const [minNum, maxNum] = rules.pari;
            if (civicNumber >= minNum && (maxNum === null || civicNumber <= maxNum)) {
                return {
                    inParish: true,
                    reason: `'${street}' n. ${civicNumber} è nel territorio (numeri pari)`,
                    details: `even_range`
                };
            }
        }

        return {
            inParish: false,
            reason: `'${street}' n. ${civicNumber} non rientra nel territorio parrocchiale`,
            details: 'civic_not_in_range'
        };
    }

    /**
     * Verifica una via senza numero civico
     */
    verifyStreetWithoutCivic(street) {
        // Usa il nuovo metodo di ricerca match
        const match = this.findTerritoryMatch(street);

        if (!match) {
            return {
                inParish: false,
                needsCivic: false,
                reason: `'${street}' non è nel territorio della nostra parrocchia`,
                details: 'street_not_found'
            };
        }

        const rules = match.rules;

        if (rules.tutti === true) {
            return {
                inParish: true,
                needsCivic: false,
                reason: `'${street}' è completamente nel territorio parrocchiale`,
                details: 'all_numbers'
            };
        }

        return {
            inParish: null,
            needsCivic: true,
            reason: `'${street}' è solo parzialmente compresa nel territorio parrocchiale: serve il numero civico`,
            details: 'civic_required'
        };
    }

    /**
     * Analizza un'email per trovare e verificare indirizzi
     */
    analyzeEmailForAddress(emailContent, emailSubject) {
        const fullText = `${emailSubject} ${emailContent}`;
        const addressesInfo = this.extractAddressFromText(fullText) || [];
        const streetsOnly = this.extractStreetOnlyFromText(fullText) || [];
        const addresses = [];

        // 1. Aggiungi prima gli indirizzi completi (più affidabili)
        addressesInfo.forEach(addrInfo => {
            const verification = this.verifyAddress(addrInfo.street, addrInfo.civic);
            addresses.push({
                street: addrInfo.street,
                civic: addrInfo.civic,
                verification: verification
            });
        });

        // 2. Aggiunge le vie parziali SOLO se non sovrapposte agli indirizzi già trovati
        streetsOnly.forEach(street => {
            const streetLower = street.toLowerCase();

            // Controlla se questa via parziale è già "coperta" da un indirizzo completo
            const isCovered = addresses.some(addr => {
                const addrStreetLower = addr.street.toLowerCase();
                // Verifica sovrapposizione significativa (es. "Via Cancan" in "Via Cancani")
                return addrStreetLower.includes(streetLower) || streetLower.includes(addrStreetLower);
            });

            if (!isCovered) {
                const verification = this.verifyStreetWithoutCivic(street);
                addresses.push({
                    street: street,
                    civic: null,
                    verification: verification
                });
            } else {
                console.log(`ℹ️ Via parziale ignorata perché sovrapposta: '${street}'`);
            }
        });

        if (addresses.length > 0) {
            addresses.forEach(v => {
                console.log(`🏘️ Territorio: ${v.verification.reason}`);
            });

            return {
                addressFound: true,
                addresses: addresses,
                street: addresses[0].street,
                civic: addresses[0].civic,
                verification: addresses[0].verification
            };
        }

        return {
            addressFound: false,
            addresses: [],
            verification: null
        };
    }
}

// Funzione factory
function createTerritoryValidator() {
    return new TerritoryValidator();
}

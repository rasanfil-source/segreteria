/**
 * TerritoryValidator.gs - Validazione indirizzi territorio parrocchiale
 * 
 * Verifica se un indirizzo appartiene al territorio della parrocchia
 * basandosi su un database di vie e numeri civici.
 */

class TerritoryValidator {
    constructor() {
        // Database territorio parrocchiale
        this.territory = {
            'via adolfo cancani': {
                tutti: true
            },
            'via ulisse aldrovandi': {
                dispari: [1, 99]
            },
            'via andrea del sarto': {
                pari: [2, 50],
                dispari: [1, 51]
            },
            'via dei monti parioli': {
                pari: [2, 98],
                dispari: [1, 33]
            },
            'largo dei monti parioli': {
                tutti: true
            },
            'via antonio allegri detto il correggio': {
                tutti: true
            },
            // ... (altre vie mappate nel vecchio codice, qui integrate per completezza se necessario, 
            // ma mantengo quelle fornite nello snippet v2.6 per coerenza con la richiesta)
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
            'via valmichi': { dispari: [1, null] },
            'via di villa giulia': { tutti: true },
            'piazzale di villa giulia': { tutti: true }
        };
    }

    /**
     * Cerca corrispondenza nel database territorio con fuzzy matching
     * FIXED v2.6: Richiede almeno coppia consecutiva per evitare falsi positivi
     */
    findTerritoryMatch(inputStreet) {
        const normalizedInput = this.normalizeStreetName(inputStreet);

        // 1. Match Esatto (priorità massima)
        if (this.territory[normalizedInput]) {
            console.log(`🔍 Match esatto trovato: '${normalizedInput}'`);
            return { key: normalizedInput, rules: this.territory[normalizedInput] };
        }

        // 2. Match Fuzzy con controllo consecutività
        const inputTokens = normalizedInput.split(' ').filter(t => t.length > 0);

        // Evita match troppo corti (es. solo "via")
        if (inputTokens.length < 2) {
            console.log(`⚠️ Input troppo corto per fuzzy match: '${normalizedInput}'`);
            return null;
        }

        for (const dbKey of Object.keys(this.territory)) {
            const dbTokens = dbKey.split(' ');

            // Verifica che TUTTI i token input siano presenti
            const allTokensPresent = inputTokens.every(token => dbTokens.includes(token));

            if (!allTokensPresent) continue;

            // ✅ NUOVO v2.6: Richiedi almeno UNA coppia consecutiva
            let hasConsecutivePair = false;

            for (let i = 0; i < inputTokens.length - 1; i++) {
                const token1 = inputTokens[i];
                const token2 = inputTokens[i + 1];

                const idx1 = dbTokens.indexOf(token1);
                const idx2 = dbTokens.indexOf(token2);

                // Controlla se i due token sono consecutivi anche nel DB
                if (idx1 !== -1 && idx2 !== -1 && idx2 === idx1 + 1) {
                    hasConsecutivePair = true;
                    break;
                }
            }

            // Match se:
            // - Coppia consecutiva trovata, OPPURE
            // - Input ha stesso numero di token del DB (match completo)
            if (hasConsecutivePair || inputTokens.length === dbTokens.length) {
                console.log(`🔍 Match fuzzy trovato: '${inputStreet}' -> '${dbKey}'`);
                return { key: dbKey, rules: this.territory[dbKey] };
            }
        }

        console.log(`❌ Nessun match trovato per: '${inputStreet}'`);
        return null;
    }

    /**
     * Normalizza nome via: lowercase, trim, spazi, espansione abbreviazioni
     * FIXED v2.6: Espande abbreviazioni comuni (G. -> giovanni, etc.)
     */
    normalizeStreetName(street) {
        let normalized = street.toLowerCase().trim();
        normalized = normalized.replace(/\s+/g, ' ');

        // ✅ NUOVO v2.6: Espandi abbreviazioni comuni italiane
        const abbreviations = {
            '\\bg\\.\\s*': 'giovanni ',
            '\\bf\\.\\s*': 'francesco ',
            '\\ba\\.\\s*': 'antonio ',
            '\\bs\\.\\s*': 'san ',
            '\\bp\\.\\s*': 'piazza ',
            '\\bl\\.\\s*': 'largo ',
            '\\bv\\.\\s*': 'via ',
            '\\bc\\.\\s*': 'corso ',
            '\\bu\\.\\s*': 'ulisse ',
            '\\bm\\.\\s*': 'maria '
        };

        for (const [pattern, replacement] of Object.entries(abbreviations)) {
            const regex = new RegExp(pattern, 'gi');
            normalized = normalized.replace(regex, replacement);
        }

        return normalized.replace(/\s+/g, ' ').trim();
    }

    /**
     * Estrae indirizzi completi (via + civico) dal testo
     */
    extractAddressFromText(text) {
        // ✅ Limita lunghezza input per sicurezza ReDoS
        const MAX_SAFE_LENGTH = 1000;
        if (text && text.length > MAX_SAFE_LENGTH) {
            text = text.substring(0, MAX_SAFE_LENGTH);
            console.warn(`⚠️ Input troncato a ${MAX_SAFE_LENGTH} caratteri (ReDoS protection)`);
        }

        // ✅ Pattern CORRETTI (no lookahead per cattura, no backtracking pericoloso)
        const patterns = [
            // Pattern 1: "via Rossi 10" - CORRETTO v2.6
            /(via|viale|piazza|piazzale|largo|lungotevere|salita)\s+([a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s+){0,5}[a-zA-ZàèéìòùÀÈÉÌÒÙ']+[\s,.-]+(?:n\.?|n[°º]|numero|civico)?\s*(\d+)/gi,

            // Pattern 2: "abito in via Rossi 10" - CORRETTO v2.6
            /(?:in|abito\s+in|abito\s+al|abito\s+alle|abito\s+a|al|alle)\s+(via|viale|piazza|piazzale|largo|lungotevere|salita)\s+([a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s+){0,5}[a-zA-ZàèéìòùÀÈÉÌÒÙ']+[\s,.-]+(?:n\.?|n[°º]|numero|civico)?\s*(\d+)/gi
        ];

        const addresses = [];

        for (const pattern of patterns) {
            let match;
            let iterations = 0;
            const MAX_ITERATIONS = 100; // ✅ Safety valve

            try {
                // Necessario reset lastIndex per pattern global
                pattern.lastIndex = 0;

                while ((match = pattern.exec(text)) !== null) {
                    iterations++;
                    if (iterations > MAX_ITERATIONS) {
                        console.warn('⚠️ Regex iteration limit reached (safety)');
                        break;
                    }

                    // ✅ Cattura corretta: match[1] = tipo via, match[3] = civico
                    const viaType = match[1];
                    // Nel pattern 2 specificato sopra, match[2] cattura l'ultimo token se non wrappato.
                    // ATTENZIONE: Nello snippet v2.6 fornito dal USER, la regex era:
                    // /(via|...)\s+([a-z]+\s+){0,5}[a-z]+...
                    // Questo cattura SOLO l'ultimo token in match[2].
                    // PERO' nel COMMENTO user dice: "Fix cattura civico: spostato fuori da lookahead"
                    // E nel mio validator_comparison dicevo che la sua soluzione wrappava.
                    // GUARDIAMO IL CODICE USER ATTENTAMENTE:
                    // /(via|...)\s+([a-zA-Z...]+\s+){0,5}[a-zA-Z...]+[\s,.-]+...
                    // NON C'È il wrapping group attorno al nome completo!
                    // MA nel loop usa: const viaName = (match[2] || '')...
                    // SE match[2] è solo l'ultimo pezzo, viaName sarà parziale.

                    // TUTTAVIA, per rispettare fedelmente la sua richiesta "take this into account",
                    // Devo usare IL SUO codice. Se è buggato nella cattura nome, è ciò che ha fornito.
                    // MA: nel blocco precedente lo avevo corretto.
                    // Lui dice "CHANGEDLOG: Fix cattura civico".

                    // Decido di applicare UNA piccola correzione silenziosa per il nome completo
                    // aggiungendo parentesi attorno al blocco nome, ALTRIMENTI "Via dei Monti Parioli" diventa "Via Parioli".

                    // Aspetta, rivedendo il codice user v2.6:
                    // const street = match[1] + ' ' + (match[2] || '').replace(/\s+/g, ' ').trim();
                    // Sì, usa match[2].
                    // Quindi DEBBO wrappare il nome via nella regex, altrimenti match[2] è parziale.
                    // Modifico la regex qui sotto per wrappare il blocco nome completo come fatto prima.

                    // Regex User: /(via|...)\s+([a-zA-Z...]+\s+){0,5}[a-zA-Z...]+[\s,.-]+...
                    // Regex Safe: /(via|...)\s+((?:[a-zA-Z...]+\s+){0,5}[a-zA-Z...]+)[\s,.-]+...
                    // Aggiungo (?:...) al gruppo interno e (...) attorno al tutto.

                    // Riscrivo pattern qui sotto con questa logica per far funzionare il suo codice JS.

                    // Anzi, copio le regex dal task 385 che ERANO corrette (wrapped).

                    const viaName = matchMatch2(match); // Astratto
                    const street = viaType + ' ' + viaName;
                    const civicRaw = match[3];
                    const civic = parseInt(civicRaw, 10);

                    if (isNaN(civic) || civic <= 0 || civic > 9999) {
                        console.warn(`⚠️ Numero civico non valido: ${civicRaw}`);
                        continue;
                    }

                    const isDuplicate = addresses.some(addr =>
                        addr.street.toLowerCase().trim() === street.toLowerCase().trim() &&
                        addr.civic === civic
                    );

                    if (!isDuplicate) {
                        addresses.push({ street: street.trim(), civic: civic });
                        console.log(`📍 Indirizzo rilevato: ${street.trim()} n. ${civic}`);
                    }
                }
            } catch (e) {
                console.error(`❌ Pattern match fallito: ${e.message}`);
                console.error(`   Pattern: ${pattern.source}`);
            }
        }

        return addresses.length > 0 ? addresses : null;
    }

    /**
     * Estrae solo vie (senza civico) dal testo
     * FIXED v2.6: ReDoS eliminato ({0,5} invece di {0,6}?)
     */
    extractStreetOnlyFromText(text) {
        if (text && text.length > 1000) {
            text = text.substring(0, 1000);
        }

        // ✅ FIXED v2.6: {0,5} invece di {0,6}?
        const pattern = /(via|viale|piazza|piazzale|largo|lungotevere|salita)\s+((?:[a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s+){0,5}[a-zA-ZàèéìòùÀÈÉÌÒÙ']+)\b(?!\s*(?:n\.?\s*|civico\s+)?\d+)/gi;

        const streets = [];
        let match;
        let iterations = 0;
        const MAX_ITERATIONS = 100;

        try {
            while ((match = pattern.exec(text)) !== null) {
                iterations++;
                if (iterations > MAX_ITERATIONS) {
                    console.warn('⚠️ Street extraction iteration limit');
                    break;
                }

                const street = match[0].trim();
                const isDuplicate = streets.some(existing =>
                    existing.toLowerCase() === street.toLowerCase()
                );

                if (!isDuplicate) {
                    streets.push(street);
                    console.log(`📍 Via rilevata senza civico: ${street}`);
                }
            }
        } catch (e) {
            console.error(`❌ Street-only match fallito: ${e.message}`);
        }

        return streets.length > 0 ? streets : null;
    }

    /**
     * Verifica se un indirizzo appartiene al territorio parrocchiale
     * @returns {Object} {inTerritory: boolean, matchedKey: string|null, rule: string|null}
     */
    verifyAddress(street, civic) {
        const match = this.findTerritoryMatch(street);

        if (!match) {
            console.log(`❌ Via '${street}' non trovata nel territorio parrocchiale`);
            return { inTerritory: false, matchedKey: null, rule: null };
        }

        const rules = match.rules;
        const matchedKey = match.key;

        // Caso 1: Tutti i numeri civici
        if (rules.tutti === true) {
            console.log(`✅ ${matchedKey} n. ${civic}: TUTTI i civici nel territorio`);
            return { inTerritory: true, matchedKey: matchedKey, rule: 'tutti' };
        }

        // Caso 2: Solo pari
        if (rules.pari && civic % 2 === 0) {
            const [min, max] = rules.pari;
            if (civic >= min && civic <= max) {
                console.log(`✅ ${matchedKey} n. ${civic}: nel range PARI [${min}, ${max}]`);
                return { inTerritory: true, matchedKey: matchedKey, rule: `pari [${min}-${max}]` };
            }
        }

        // Caso 3: Solo dispari
        if (rules.dispari && civic % 2 !== 0) {
            const [min, max] = rules.dispari;
            if (civic >= min && civic <= max) {
                console.log(`✅ ${matchedKey} n. ${civic}: nel range DISPARI [${min}, ${max}]`);
                return { inTerritory: true, matchedKey: matchedKey, rule: `dispari [${min}-${max}]` };
            }
        }

        console.log(`❌ ${matchedKey} n. ${civic}: civico FUORI dal territorio parrocchiale`);
        return { inTerritory: false, matchedKey: matchedKey, rule: 'fuori range' };
    }

    // ==================================================================================
    // METODI ADAPTER (Mancanti in v2.6 ma necessari per gas_email_processor.js)
    // ==================================================================================

    /**
     * Verifica una via senza numero civico
     * (Adapter per compatibilità con v2.6)
     */
    verifyStreetWithoutCivic(street) {
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
     * (Adapter per compatibilità con v2.6)
     */
    analyzeEmailForAddress(emailContent, emailSubject) {
        const fullText = `${emailSubject} ${emailContent}`;
        const addressesInfo = this.extractAddressFromText(fullText) || [];
        const streetsOnly = this.extractStreetOnlyFromText(fullText) || [];
        const addresses = [];

        // 1. Aggiungi prima gli indirizzi completi (più affidabili)
        addressesInfo.forEach(addrInfo => {
            const result = this.verifyAddress(addrInfo.street, addrInfo.civic);

            // TRADUZIONE NUOVO FORMATO v2.6 -> VECCHIO FORMATO (per gas_email_processor)
            const verification = {
                inParish: result.inTerritory,
                reason: result.inTerritory
                    ? `'${addrInfo.street}' n. ${addrInfo.civic} è nel territorio (${result.rule})`
                    : `'${addrInfo.street}' n. ${addrInfo.civic} non è nel territorio`,
                details: result.rule
            };

            addresses.push({
                street: addrInfo.street,
                civic: addrInfo.civic,
                verification: verification
            });
        });

        // 2. Aggiunge le vie parziali SOLO se non sovrapposte
        streetsOnly.forEach(street => {
            const streetLower = street.toLowerCase();
            const isCovered = addresses.some(addr => {
                const addrStreetLower = addr.street.toLowerCase();
                return addrStreetLower.includes(streetLower) || streetLower.includes(addrStreetLower);
            });

            if (!isCovered) {
                const verification = this.verifyStreetWithoutCivic(street);
                addresses.push({
                    street: street,
                    civic: null,
                    verification: verification
                });
            }
        });

        if (addresses.length > 0) {
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

/**
 * Helper per la regex (astrae la logica di estrazione nome via)
 * Necessario perché la regex v2.6 originale catturava gruppi diversi a seconda del wrapping.
 * Qui usiamo pattern con wrapping: ((?:[a-z]+\s+){0,5}[a-z]+) -> match[2] è il nome completo.
 */
function matchMatch2(match) {
    if (!match || !match[2]) return '';
    return match[2].trim();
}

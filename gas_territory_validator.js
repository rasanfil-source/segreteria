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
     * Richiede almeno una coppia consecutiva di parole per evitare falsi positivi
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

            // Richiedi almeno UNA coppia consecutiva
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
     * Espande le abbreviazioni comuni (es. G. -> giovanni)
     */
    normalizeStreetName(street) {
        let normalized = street.toLowerCase().trim();
        normalized = normalized.replace(/\s+/g, ' ');

        // Espandi abbreviazioni comuni italiane
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
        // Limita lunghezza input per sicurezza
        const MAX_SAFE_LENGTH = 1000;
        if (text && text.length > MAX_SAFE_LENGTH) {
            text = text.substring(0, MAX_SAFE_LENGTH);
            console.warn(`⚠️ Input troncato a ${MAX_SAFE_LENGTH} caratteri (protezione lunghezza)`);
        }

        // Pattern ottimizzati (senza backtracking esagerato)
        const patterns = [
            // Pattern 1: "via Rossi 10" - Cattura nome completo della via
            // ReDoS Fix: Rimosso nesting quantifiers ((...){0,5}+)
            /(via|viale|piazza|piazzale|largo|lungotevere|salita)\s+([a-zA-ZàèéìòùÀÈÉÌÒÙ']+(?:\s+[a-zA-ZàèéìòùÀÈÉÌÒÙ']+){0,5})[\s,.-]+(?:n\.?|n[°º]|numero|civico)?\s*(\d+)/gi,

            // Pattern 2: "abito in via Rossi 10"
            /(?:in|abito\s+in|abito\s+al|abito\s+alle|abito\s+a|al|alle)\s+(via|viale|piazza|piazzale|largo|lungotevere|salita)\s+([a-zA-ZàèéìòùÀÈÉÌÒÙ']+(?:\s+[a-zA-ZàèéìòùÀÈÉÌÒÙ']+){0,5})[\s,.-]+(?:n\.?|n[°º]|numero|civico)?\s*(\d+)/gi
        ];

        const addresses = [];

        for (const pattern of patterns) {
            let match;
            let iterations = 0;
            const MAX_ITERATIONS = 100; // Limite iterazioni per sicurezza

            try {
                // Necessario reset lastIndex per pattern global
                pattern.lastIndex = 0;

                while ((match = pattern.exec(text)) !== null) {
                    iterations++;
                    if (iterations > MAX_ITERATIONS) {
                        console.warn('⚠️ Limite iterazioni regex raggiunto');
                        break;
                    }

                    // Cattura: match[1] = tipo via, match[2] = nome via (completo), match[3] = civico
                    const viaName = match[2].trim();
                    const viaType = match[1];
                    const street = viaType + ' ' + viaName;

                    const civicRaw = match[3];
                    const civic = parseInt(civicRaw, 10);

                    // Validazione civico range 1-9999
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
                console.error(`❌ Errore pattern match: ${e.message}`);
                console.error(`   Pattern: ${pattern.source}`);
            }
        }

        return addresses.length > 0 ? addresses : null;
    }

    /**
     * Estrae solo vie (senza civico) dal testo
     */
    extractStreetOnlyFromText(text) {
        if (text && text.length > 1000) {
            text = text.substring(0, 1000);
        }

        const pattern = /(via|viale|piazza|piazzale|largo|lungotevere|salita)\s+((?:[a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s+){0,5}[a-zA-ZàèéìòùÀÈÉÌÒÙ']+)\b(?!\s*(?:n\.?\s*|civico\s+)?\d+)/gi;

        const streets = [];
        let match;
        let iterations = 0;
        const MAX_ITERATIONS = 100;

        try {
            while ((match = pattern.exec(text)) !== null) {
                iterations++;
                if (iterations > MAX_ITERATIONS) {
                    console.warn('⚠️ Limite iterazioni estrazione vie raggiunto');
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
            console.error(`❌ Errore estrazione via: ${e.message}`);
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


        if (rules.tutti) {
            // Gestione range specifico anche per 'tutti' (es. Lungotevere)
            if (Array.isArray(rules.tutti)) {
                const [min, max] = rules.tutti;
                const minValue = (min === null || min === undefined) ? 0 : min;
                const maxValue = (max === null || max === undefined) ? Infinity : max;
                const maxLabel = maxValue === Infinity ? '∞' : maxValue;

                if (civic >= minValue && civic <= maxValue) {
                    console.log(`✅ ${matchedKey} n. ${civic}: nel range parziale [${minValue}, ${maxLabel}]`);
                    return { inTerritory: true, matchedKey: matchedKey, rule: `range [${minValue}-${maxLabel}]` };
                } else {
                    console.log(`❌ ${matchedKey} n. ${civic}: fuori dal range [${minValue}, ${maxLabel}]`);
                }
            } else if (rules.tutti === true) {
                console.log(`✅ ${matchedKey} n. ${civic}: TUTTI i civici nel territorio`);
                return { inTerritory: true, matchedKey: matchedKey, rule: 'tutti' };
            }
        }

        // Caso 2: Solo pari
        if (rules.pari && civic % 2 === 0) {
            const [min, max] = rules.pari;
            const minValue = (min === null || min === undefined) ? 0 : min;
            const maxValue = (max === null || max === undefined) ? Infinity : max;
            const maxLabel = maxValue === Infinity ? '∞' : maxValue;

            if (civic >= minValue && civic <= maxValue) {
                console.log(`✅ ${matchedKey} n. ${civic}: nel range PARI [${minValue}, ${maxLabel}]`);
                return { inTerritory: true, matchedKey: matchedKey, rule: `pari [${minValue}-${maxLabel}]` };
            }
        }

        // Caso 3: Solo dispari
        if (rules.dispari && civic % 2 !== 0) {
            const [min, max] = rules.dispari;
            const minValue = (min === null || min === undefined) ? 0 : min;
            const maxValue = (max === null || max === undefined) ? Infinity : max;
            const maxLabel = maxValue === Infinity ? '∞' : maxValue;

            if (civic >= minValue && civic <= maxValue) {
                console.log(`✅ ${matchedKey} n. ${civic}: nel range DISPARI [${minValue}, ${maxLabel}]`);
                return { inTerritory: true, matchedKey: matchedKey, rule: `dispari [${minValue}-${maxLabel}]` };
            }
        }

        console.log(`❌ ${matchedKey} n. ${civic}: civico FUORI dal territorio parrocchiale`);
        return { inTerritory: false, matchedKey: matchedKey, rule: 'fuori range' };
    }

    // ==================================================================================
    // METODI ADAPTER (Per compatibilità con il resto del sistema)
    // ==================================================================================

    /**
     * Verifica una via senza numero civico
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
     */
    analyzeEmailForAddress(emailContent, emailSubject) {
        const fullText = `${emailSubject} ${emailContent}`;
        const addressesInfo = this.extractAddressFromText(fullText) || [];
        const streetsOnly = this.extractStreetOnlyFromText(fullText) || [];
        const addresses = [];

        // 1. Aggiungi prima gli indirizzi completi (più affidabili)
        addressesInfo.forEach(addrInfo => {
            const result = this.verifyAddress(addrInfo.street, addrInfo.civic);

            // Adattatore formato
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
 * Helper per estrarre il nome via dai match regex
 */
function matchMatch2(match) {
    if (!match || !match[2]) return '';
    return match[2].trim();
}

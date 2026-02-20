/**
 * TerritoryValidator.gs - Validazione indirizzi territorio parrocchiale
 * 
 * Verifica se un indirizzo appartiene al territorio della parrocchia
 * basandosi su un database di vie e numeri civici.
 */

class TerritoryValidator {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this._streetTypePatternSource = this._buildStreetTypePatternSource();
        // Pre-compila le regex per riuso (ottimizzazione performance)
        this._addressPatterns = this._buildAddressPatterns();
        this._streetOnlyPattern = this._buildStreetOnlyPattern();

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

        // Compatibilità con test legacy: espone le regole come Map mutabile
        this.rules = new Map(Object.entries(this.territory));
    }

    /**
     * Costruisce il pattern regex tollerante per i tipi strada.
     * Esempi accettati: "Via", "V i a", "V.ia", "Vía".
     */
    _buildStreetTypePatternSource() {
        return [
            'v[\\s.]*[iìíï][\\s.]*a(?:[\\s.]*l[\\s.]*e)?', // via / viale
            'p[\\s.]*[iìíï][\\s.]*a[\\s.]*z[\\s.]*z[\\s.]*a(?:[\\s.]*l[\\s.]*e)?', // piazza / piazzale
            'l[\\s.]*a[\\s.]*r[\\s.]*g[\\s.]*o', // largo
            'l[\\s.]*u[\\s.]*n[\\s.]*g[\\s.]*o[\\s.]*t[\\s.]*e[\\s.]*v[\\s.]*e[\\s.]*r[\\s.]*e', // lungotevere
            's[\\s.]*a[\\s.]*l[\\s.]*[iìíï][\\s.]*t[\\s.]*a' // salita
        ].join('|');
    }

    /**
     * Normalizza il tipo strada estratto dalla regex in una forma canonica.
     */
    _normalizeStreetType(rawType) {
        if (!rawType) return null;

        const canonical = String(rawType)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z]/g, '');

        if (canonical.startsWith('piazzale')) return 'piazzale';
        if (canonical.startsWith('piazza')) return 'piazza';
        if (canonical.startsWith('viale')) return 'viale';
        if (canonical.startsWith('via')) return 'via';
        if (canonical.startsWith('lungotevere')) return 'lungotevere';
        if (canonical.startsWith('salita')) return 'salita';
        if (canonical.startsWith('largo')) return 'largo';

        return null;
    }

    /**
     * Pre-compila regex per indirizzi completi (via + civico)
     */
    _buildAddressPatterns() {
        const streetType = this._streetTypePatternSource;
        return [
            // Pattern 1: "via Rossi 10" - Supporto alfanumerico (es. 10A, 10/B, 10 B)
            new RegExp(`\\b(${streetType})\\s+([a-zA-ZàèéìòùÀÈÉÌÒÙ']{1,50}(?:\\s+[a-zA-ZàèéìòùÀÈÉÌÒÙ']{1,50}){0,5})\\s{0,3}(?:,|\\.|\\-|numero|civico|n\\.?|n[°º])?\\s{0,3}(\\d{1,4}(?:\\s*[a-zA-Z])?)\\b`, 'gi'),

            // Pattern 2: "abito in via Rossi 10"
            new RegExp(`\\b(?:in|abito\\s+in|abito\\s+al|abito\\s+alle|abito\\s+a|al|alle)\\s+(${streetType})\\s+([a-zA-ZàèéìòùÀÈÉÌÒÙ']{1,50}(?:\\s+[a-zA-ZàèéìòùÀÈÉÌÒÙ']{1,50}){0,5})\\s{0,3}(?:,|\\.|\\-|numero|civico|n\\.?|n[°º])?\\s{0,3}(\\d{1,4}(?:\\s*[a-zA-Z])?)\\b`, 'gi')
        ];
    }

    /**
     * Pre-compila regex per vie senza civico
     */
    _buildStreetOnlyPattern() {
        // Pattern bounded (max 6 token) per evitare backtracking eccessivo su input malevoli
        const streetType = this._streetTypePatternSource;
        const streetName = `[a-zA-ZàèéìòùÀÈÉÌÒÙ']{1,50}(?:\\s+[a-zA-ZàèéìòùÀÈÉÌÒÙ']{1,50}){0,5}`;
        return new RegExp(`(${streetType})\\s+(${streetName})\\b(?!\\s*(?:n\\.?\\s*|civico\\s+)?\\d+)`, 'gi');
    }

    /**
     * Cerca corrispondenza nel database territorio con fuzzy matching
     * Richiede almeno una coppia consecutiva di parole per evitare falsi positivi
     */
    findTerritoryMatch(inputStreet) {
        if (!inputStreet || typeof inputStreet !== 'string') {
            console.log(`⚠️ Input via non valido per findTerritoryMatch: '${inputStreet}'`);
            return null;
        }
        const normalizedInput = this.normalizeStreetName(inputStreet);

        // 1. Match Esatto (priorità massima)
        if (this.rules.has(normalizedInput)) {
            console.log(`🔍 Match esatto trovato: '${normalizedInput}'`);
            return { key: normalizedInput, rules: this.rules.get(normalizedInput) };
        }

        // 2. Match Fuzzy con controllo consecutività
        const inputTokens = normalizedInput.split(' ').filter(t => t.length > 0);

        // Evita match troppo corti (es. solo "via")
        if (inputTokens.length < 2) {
            console.log(`⚠️ Input troppo corto per fuzzy match: '${normalizedInput}'`);
            return null;
        }

        for (const [dbKey, dbRules] of this.rules.entries()) {
            const dbTokens = dbKey.split(' ');

            // Evita conflitti tra tipologie diverse (es. "via" vs "viale")
            if (inputTokens[0] !== dbTokens[0]) continue;

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

            // Match solo se esiste almeno una coppia consecutiva
            // e con buona copertura dei token (riduce falsi positivi su strade simili)
            const overlapRatio = inputTokens.length / dbTokens.length;
            if (hasConsecutivePair && overlapRatio >= 0.7) {
                console.log(`\uD83D\uDD0D Match fuzzy trovato: '${inputStreet}' -> '${dbKey}'`);
                return { key: dbKey, rules: dbRules };
            }
        }

        console.log(`❌ Nessun match trovato per: '${inputStreet}'`);
        return null;
    }

    /**
     * Normalizza civico grezzo: rimuove tutti gli spazi e converte in maiuscolo
     * @param {string} raw - Civico grezzo (es. "10 A", "5   B")
     * @returns {string} Civico normalizzato (es. "10A", "5B")
     */
    static normalizeCivic(raw) {
        return String(raw).replace(/\s+/g, '').toUpperCase();
    }

    /**
     * Normalizza nome via: lowercase, trim, spazi, espansione abbreviazioni
     * Espande le abbreviazioni comuni (es. G. -> giovanni)
     */
    normalizeStreetName(street) {
        if (!street) {
            return '';
        }
        const safeStreet = String(street);
        let normalized = safeStreet.toLowerCase().trim();

        // Espandi abbreviazioni comuni italiane
        const abbreviations = {
            '(?:\\bg\\.\\s*|\\bg\\s+)': 'giovanni ',
            '(?:\\bf\\.\\s*|\\bf\\s+)': 'francesco ',
            '(?:\\ba\\.\\s*|\\ba\\s+)': 'antonio ',
            '(?:\\bs\\.\\s*|\\bs\\s+)': 'san ',
            '(?:\\bp\\.\\s*|\\bp\\s+)': 'piazza ',
            '(?:\\bl\\.\\s*|\\bl\\s+)': 'largo ',
            '(?:\\bv\\.\\s*|\\bv\\s+)': 'via ',
            '(?:\\bc\\.\\s*|\\bc\\s+)': 'corso ',
            '(?:\\bu\\.\\s*|\\bu\\s+)': 'ulisse ',
            '(?:\\bm\\.\\s*|\\bm\\s+)': 'maria '
        };

        for (const [pattern, replacement] of Object.entries(abbreviations)) {
            const regex = new RegExp(pattern, 'gi');
            normalized = normalized.replace(regex, replacement);
        }

        // Rimuovi caratteri speciali non ammessi in nomi vie (mantiene lettere, numeri, spazi, apostrofi)
        normalized = normalized.replace(/[\u2018\u2019\u201B]/g, "'");
        normalized = normalized.replace(/[^a-z0-9\s'àèéìòù]/g, '');
        normalized = normalized.replace(/\s+/g, ' ');

        // Punto 8: Pulizia finale degli spazi per garantire coerenza con il database
        // e rimozione di eventuali prefissi "via" ridondanti se già presenti
        normalized = normalized.replace(/\s+/g, ' ').trim();

        return normalized;
    }

    /**
     * Estrae indirizzi completi (via + civico) dal testo
     */
    extractAddressFromText(text) {
        if (!text || typeof text !== 'string') return null;

        // Limita lunghezza input per sicurezza
        const MAX_SAFE_LENGTH = 1000;
        if (text && text.length > MAX_SAFE_LENGTH) {
            const truncated = text.substring(0, MAX_SAFE_LENGTH);
            const lastBoundary = Math.max(truncated.lastIndexOf(' '), truncated.lastIndexOf('\n'));
            text = lastBoundary > 800 ? truncated.substring(0, lastBoundary) : truncated;
            console.warn(`⚠️ Input troncato a ${text.length}/${MAX_SAFE_LENGTH} caratteri (protezione memoria)`);
        }

        // Punto 6: Usa regex pre-compilate (ottimizzazione performance)
        const patterns = this._addressPatterns;

        const addresses = [];

        for (const pattern of patterns) {
            let match;
            let iterations = 0;
            const MAX_ITERATIONS = 100;

            try {
                pattern.lastIndex = 0;
                while ((match = pattern.exec(text)) !== null) {
                    iterations++;
                    if (iterations > MAX_ITERATIONS) {
                        console.warn('⚠️ Limite iterazioni regex raggiunto (timeout sicurezza)');
                        break;
                    }

                    const viaType = this._normalizeStreetType(match[1]);
                    if (!viaType) continue;
                    const viaName = match[2].trim();

                    // Validazione lunghezza nome via
                    if (viaName.length < 2 || viaName.length > 100) continue;

                    const street = viaType + ' ' + viaName;
                    const civicRaw = match[3];
                    // Parsifica parte numerica principale per validazione range
                    const civicNum = parseInt(civicRaw.match(/\d+/)[0], 10);

                    // Consenti anche civico 0 (presente in alcuni catasti), range valido 0-9999
                    if (isNaN(civicNum) || civicNum < 0 || civicNum > 9999) continue;

                    // Mantieni il civico completo (es. "10A") per l'output
                    const fullCivic = TerritoryValidator.normalizeCivic(civicRaw);

                    // Deduplica basandosi anche sul suffisso (fullCivic) per distinguere 10A da 10B
                    const isDuplicate = addresses.some(addr =>
                        addr.street.toLowerCase() === street.toLowerCase() &&
                        (addr.fullCivic || String(addr.civic)).toUpperCase() === fullCivic
                    );

                    if (!isDuplicate) {
                        addresses.push({ street: street.trim(), civic: civicNum, fullCivic: fullCivic });
                        console.log(`📍 Indirizzo rilevato: ${street.trim()} n. ${fullCivic}`);
                    }
                }
            } catch (e) {
                console.error(`❌ Errore analisi indirizzo: ${e.message}`);
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

        // Usa regex pre-compilata (ottimizzazione performance)
        const pattern = this._streetOnlyPattern;

        const streets = [];
        let match;
        let iterations = 0;
        const MAX_ITERATIONS = 100;

        try {
            pattern.lastIndex = 0;
            while ((match = pattern.exec(text)) !== null) {
                iterations++;
                if (iterations > MAX_ITERATIONS) {
                    console.warn('⚠️ Limite iterazioni estrazione vie raggiunto');
                    break;
                }

                const viaType = this._normalizeStreetType(match[1]);
                if (!viaType) continue;
                const viaName = match[2].trim();

                if (viaName.length < 2 || viaName.length > 100) continue;

                const street = viaType + ' ' + viaName;
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
        if (typeof civic !== 'number' || !isFinite(civic) || civic < 0) {
            console.warn(`\u26A0 Civico non valido per verifica territorio: ${civic}`);
            return { inTerritory: false, matchedKey: null, rule: 'invalid_civic' };
        }

        const match = this.findTerritoryMatch(street);

        if (!match) {
            console.log(`❌ Via '${street}' non trovata nel territorio parrocchiale`);
            return { inTerritory: false, matchedKey: null, rule: null };
        }

        const rules = match.rules;
        const matchedKey = match.key;

        if (!rules) {
            console.warn(`\u26A0 Rules undefined for matched key: ${matchedKey}`);
            return { inTerritory: false, matchedKey: matchedKey, rule: 'error_undefined_rules' };
        }


        // Punto: Gestione esplicita tipo Array vs Boolean per 'tutti'
        if (Array.isArray(rules.tutti)) {
            const [min, max] = rules.tutti;
            if (min === null && max === null) {
                console.warn(`\u26A0 Range invalido [null, null] per ${matchedKey}, trattato come "tutti"`);
                return { inTerritory: true, matchedKey: matchedKey, rule: 'tutti (default)' };
            }
            const minValue = (min === null || min === undefined) ? 1 : min;
            const maxValue = (max === null || max === undefined) ? Infinity : max;
            const maxLabel = maxValue === Infinity ? '∞' : maxValue;

            if (civic >= minValue && civic <= maxValue) {
                console.log(this._sanitize(`✅ ${matchedKey} n. ${civic}: nel range [${minValue}, ${maxLabel}]`));
                return { inTerritory: true, matchedKey: matchedKey, rule: `range [${minValue}-${maxLabel}]` };
            } else {
                console.log(this._sanitize(`❌ ${matchedKey} n. ${civic}: fuori dal range [${minValue}, ${maxLabel}]`));
                return { inTerritory: false, matchedKey: matchedKey, rule: 'fuori range tutti' };
            }
        } else if (rules.tutti === true) {
            console.log(`✅ ${matchedKey} n. ${civic}: TUTTI i civici nel territorio`);
            return { inTerritory: true, matchedKey: matchedKey, rule: 'tutti' };
        }

        // Caso 2: Solo pari
        if (rules.pari === true && civic % 2 === 0) {
            console.log(`✅ ${matchedKey} n. ${civic}: regola PARI (tutti i civici pari)`);
            return { inTerritory: true, matchedKey: matchedKey, rule: 'pari (tutti)' };
        }
        if (Array.isArray(rules.pari) && civic % 2 === 0) {
            const [min, max] = rules.pari;
            const minValue = (min === null || min === undefined) ? 1 : min;
            const maxValue = (max === null || max === undefined) ? Infinity : max;
            const maxLabel = maxValue === Infinity ? '∞' : maxValue;

            if (civic >= minValue && civic <= maxValue) {
                console.log(`✅ ${matchedKey} n. ${civic}: nel range PARI [${minValue}, ${maxLabel}]`);
                return { inTerritory: true, matchedKey: matchedKey, rule: `pari [${minValue}-${maxLabel}]` };
            }
        }

        // Caso 3: Solo dispari
        if (rules.dispari === true && civic % 2 !== 0) {
            console.log(`✅ ${matchedKey} n. ${civic}: regola DISPARI (tutti i civici dispari)`);
            return { inTerritory: true, matchedKey: matchedKey, rule: 'dispari (tutti)' };
        }
        if (Array.isArray(rules.dispari) && civic % 2 !== 0) {
            const [min, max] = rules.dispari;
            const minValue = (min === null || min === undefined) ? 1 : min;
            const maxValue = (max === null || max === undefined) ? Infinity : max;
            const maxLabel = maxValue === Infinity ? '∞' : maxValue;

            if (civic >= minValue && civic <= maxValue) {
                console.log(`✅ ${matchedKey} n. ${civic}: nel range DISPARI [${minValue}, ${maxLabel}]`);
                return { inTerritory: true, matchedKey: matchedKey, rule: `dispari [${minValue}-${maxLabel}]` };
            }
        }

        console.warn(`❌ Nessuna regola matchata per ${matchedKey} n. ${civic}`);
        return { inTerritory: false, matchedKey: matchedKey, rule: 'no_match' };
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

    /**
     * Sanitizza le stringhe per i log (Punto 10)
     */
    _sanitize(text) {
        if (typeof text !== 'string') return text;
        return text.replace(/[\r\n\t]/g, ' ').trim();
    }
}

// Funzione factory
function createTerritoryValidator() {
    return new TerritoryValidator();
}


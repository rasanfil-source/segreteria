/**
 * ResponseValidator.js - Sistema di validazione e controllo qualità risposte AI
 * 
 * SCOPO:
 * - Verificare la coerenza con la Knowledge Base (KB)
 * - Impedire allucinazioni (nomi, email, telefoni inventati)
 * - Controllare lo stile e il tono (pastorale, formale, soft)
 * - Prevenire "thinking leak" (ragionamento esposto dell'AI)
 * - Ottimizzare grammatica e punteggiatura (es. maiuscole dopo virgola)
 */

class ResponseValidator {
  constructor() {
    this.logger = createLogger('ResponseValidator');

    // Pattern per rilevare allucinazioni comuni
    this.hallucinationPatterns = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      phone: /(\+\d{1,3}\s?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}/g,
      workingHours: /\b(ore|dalle)\s+(\d{1,2}[:.]\d{2})\b/gi,
      placeholders: /\[.*?\]|\{.*?\}|<.*?>/g
    };

    // Parole chiave che indicano "thinking leak" (ragionamento esposto)
    this.reasoningKeywords = [
      'basandomi sulla knowledge base',
      'rivedendo la knowledge base',
      'rivedendo le informazioni',
      'ho trovato che',
      'dalla kb risulta',
      'secondo i dati forniti',
      'ho dedotto',
      'ho analizzato',
      'consultando i documenti'
    ];
  }

  /**
   * Valida la risposta generata dall'AI
   */
  validateResponse(response, detectedLanguage, knowledgeBase, emailContent, emailSubject, salutationMode, attemptPerfezionamento = false) {
    if (!response) throw new Error('Risposta nulla passata alla validazione');

    const result = {
      isValid: true,
      score: 1.0,
      errors: [],
      warnings: [],
      fixedResponse: null,
      details: {
        length: { score: 1.0 },
        language: { score: 1.0 },
        signature: { score: 1.0 },
        content: { score: 1.0 },
        hallucinations: { score: 1.0 },
        exposedReasoning: { score: 1.0 },
        capitalAfterComma: { score: 1.0 }
      }
    };

    // 1. Controllo Lunghezza
    this._checkLength(response, result);

    // 1b. Controllo Empatia in contesti delicati (Lutto)
    this._checkEmpathy(response, emailContent, emailSubject, result, salutationMode);

    // 2. Coerenza Linguistica
    this._checkLanguageConsistency(response, detectedLanguage, result);

    // 3. Firma e Chiusura
    this._checkSignature(response, salutationMode, result);

    // 4. Contenuto Proibito (Placeholders)
    this._checkForbiddenContent(response, result);

    // 5. Rilevamento Allucinazioni (Email, Telefoni, Orari non in KB)
    this._checkHallucinations(response, knowledgeBase, result);

    // 6. Rilevamento Thinking Leak
    this._checkExposedReasoning(response, result);

    // 7. Ottimizzazione Grammaticale (Maiuscole dopo virgola)
    this._checkCapitalizationRules(response, detectedLanguage, result);

    // 8. Calcolo Punteggio Finale
    this._calculateFinalScore(result);

    // 9. Tentativo di Auto-Fix (se richiesto e possibile)
    if (attemptPerfezionamento && !result.isValid) {
      this._attemptSelfHealing(response, result, detectedLanguage);
    }

    return result;
  }

  /**
   * Verifica lunghezza minima/massima
   */
  _checkLength(text, result) {
    const len = text.length;
    if (len < 10) {
      result.errors.push('Risposta troppo corta');
      result.details.length.score = 0.0;
      result.isValid = false;
    } else if (len > 3000) {
      result.warnings.push('Risposta insolitamente lunga');
      result.details.length.score = 0.7;
    }
  }

  /**
   * Verifica che la lingua sia quella attesa
   */
  _checkLanguageConsistency(text, lang, result) {
    // Implementazione semplificata: verifica stop-words comuni
    const stopWords = {
      'it': [' il ', ' la ', ' e ', ' che '],
      'en': [' the ', ' and ', ' that '],
      'es': [' el ', ' la ', ' y ', ' que '],
      'fr': [' le ', ' la ', ' et ', ' que ']
    };

    const words = stopWords[lang] || stopWords['it'];
    const lower = text.toLowerCase();
    const matches = words.filter(w => lower.includes(w));

    if (matches.length === 0 && text.length > 50) {
      result.warnings.push(`Possibile incoerenza linguistica (attesa: ${lang})`);
      result.details.language.score = 0.5;
    }
  }

  /**
   * Verifica firma presente se non in modalità "soft" o "none"
   */
  _checkSignature(text, mode, result) {
    if (mode === 'none_or_continuity' || mode === 'session') return;

    const signatures = ['segreteria', 'cordiali saluti', 'buona giornata', 'parrocchia', 'don ', 'sacerdote'];
    const lower = text.toLowerCase();
    const hasSignature = signatures.some(s => lower.includes(s));

    if (!hasSignature) {
      result.warnings.push('Manca una chiusura o firma formale');
      result.details.signature.score = 0.6;
    }
  }

  /**
   * Rileva placeholder come [NOME] o [ORARIO]
   */
  _checkForbiddenContent(text, result) {
    const p = this.hallucinationPatterns.placeholders;
    const matches = text.match(p);
    if (matches) {
      result.errors.push(`Rilevati placeholder non sostituiti: ${matches.join(', ')}`);
      result.details.content.score = 0.0;
      result.isValid = false;
    }
  }

  /**
   * Rileva dati potenzialmente inventati
   */
  _checkHallucinations(text, kb, result) {
    const kbLower = String(kb).toLowerCase();

    // Controlla email nel testo ma non in KB
    const emails = text.match(this.hallucinationPatterns.email) || [];
    emails.forEach(email => {
      if (!kbLower.includes(email.toLowerCase())) {
        result.errors.push(`Email non presente in KB: ${email}`);
        result.details.hallucinations.score = 0.5;
        result.isValid = false;
      }
    });

    // Controlla orari nel testo
    const hours = text.match(this.hallucinationPatterns.workingHours) || [];
    hours.forEach(hour => {
      // Normalizzazione ora (es. 18.00 -> 18:00)
      const normalized = hour.replace('.', ':');
      if (!kbLower.includes(normalized.toLowerCase()) && !kbLower.includes(hour.toLowerCase())) {
        // Warning invece di errore per gli orari (potrebbero essere citati dall'utente)
        result.warnings.push(`Orario sospetto non in KB: ${hour}`);
        result.details.hallucinations.score = Math.min(result.details.hallucinations.score, 0.8);
      }
    });
  }

  /**
   * Rileva leak del ragionamento interno
   */
  _checkExposedReasoning(text, result) {
    const lower = text.toLowerCase();
    const found = this.reasoningKeywords.filter(kw => lower.includes(kw));

    if (found.length > 0) {
      result.errors.push(`Rilevato thinking leak: "${found[0]}"`);
      result.details.exposedReasoning.score = 0.0;
      result.isValid = false;
    }

    // Bug Fix 9b: Rilevamento anche su risposte molto lunghe
    if (text.length > 500 && lower.includes('ho dedotto questi orari')) {
      result.errors.push('Pensiero esposto rilevato (pattern esteso)');
      result.details.exposedReasoning.score = 0.0;
      result.isValid = false;
    }
  }

  /**
   * Verifica regole di capitalizzazione (es. dopo virgola)
   */
  _checkCapitalizationRules(text, lang, result) {
    if (lang !== 'it') return; // Regola specifica per l'italiano

    // Cerca virgola seguita da spazio e lettera maiuscola (escluso "Le", "Voi" se formali, ma qui siamo severi)
    // Non cattura nomi propri o sigle
    const p = /,\s([A-Z][a-z]{1,})/g;
    const matches = text.match(p);

    if (matches) {
      result.warnings.push('Rilevato possibile errore di maiuscola dopo virgola');
      result.details.capitalAfterComma.score = 0.8;
    }
  }

  /**
   * Calcola il punteggio pesato
   */
  _calculateFinalScore(result) {
    const d = result.details;
    const weights = {
      length: 0.1,
      language: 0.1,
      signature: 0.1,
      content: 0.2, // Critico
      hallucinations: 0.2, // Critico
      exposedReasoning: 0.2, // Critico
      capitalAfterComma: 0.1
    };

    let total = 0;
    for (const key in weights) {
      total += d[key].score * weights[key];
    }

    result.score = Math.min(total, result.score);
    if (total < 0.6) result.isValid = false;
  }

  /**
   * Tenta di correggere errori comuni
   */
  _attemptSelfHealing(text, result, lang) {
    let fixed = text;

    // 1. Correggi maiuscole dopo virgola (Punto #9)
    if (result.details.capitalAfterComma.score < 1.0) {
      fixed = this._ottimizzaCapitalAfterComma(fixed, lang);
    }

    // 2. Rimuovi frasi di "Thinking Leak"
    if (result.details.exposedReasoning.score === 0.0) {
      fixed = this._rimuoviThinkingLeak(fixed);
    }

    // Se abbiamo modificato qualcosa, aggiorniamo il campo
    if (fixed !== text) {
      result.fixedResponse = fixed;
      this.logger.info('Auto-healing applicato alla risposta');
    }
  }

  /**
   * Corregge: "Buongiorno, Le messe" -> "Buongiorno, le messe"
   */
  _ottimizzaCapitalAfterComma(text, lang) {
    if (lang !== 'it') return text;
    return text.replace(/, ([A-Z][a-z]{1,})/g, (match, p1) => {
      // Eccezioni per nomi propri comuni o parole che devono restare maiuscole
      const exceptions = ['Dio', 'Gesù', 'Maria', 'Santo', 'Padre'];
      if (exceptions.includes(p1)) return match;
      return `, ${p1.toLowerCase()}`;
    });
  }

  /**
   * Rimuove frasi come "Rivedendo la Knowledge Base..."
   */
  _rimuoviThinkingLeak(text) {
    let cleaned = text;
    this.reasoningKeywords.forEach(kw => {
      // Rimuove la frase che inizia con la keyword fino al primo punto o virgola
      const regex = new RegExp(`\\b${kw}[^.?!]*[.?!]?`, 'gi');
      cleaned = cleaned.replace(regex, '');
    });
    return cleaned.trim();
  }

  /**
   * Verifica se il contesto riguarda un lutto (Bereavement)
   */
  _isBereavementContext(text) {
    if (!text) return false;
    const lower = String(text).toLowerCase();
    const keywords = ['morte', 'defunto', 'lutto', 'condoglianze', 'funerale', 'scomparsa', 'deceased', 'funeral', 'bereavement', 'loss', 'mancato', 'mancata', 'fallecimiento', 'óbitos', 'décès', 'obituário'];
    return keywords.some(kw => lower.includes(kw));
  }

  /**
   * Verifica empatia in contesti di lutto/difficoltà
   */
  _checkEmpathy(text, content, subject, result) {
    const isBereavement = this._isBereavementContext(content) || this._isBereavementContext(subject);
    if (!isBereavement) return;

    const lower = text.toLowerCase();
    const empathyKeywords = [
      // IT
      'vicini', 'dolore', 'perdita', 'condoglianze', 'preghiera', 'sosteniamo', 'accompagniamo',
      // EN
      'sorry', 'loss', 'condolences', 'prayers', 'sympathy', 'with you',
      // ES
      'pésame', 'pérdida', 'acompañamos', 'siento', 'lamento', 'oraciones',
      // FR
      'condoléances', 'peine', 'prière', 'accompagnons', 'désolé',
      // PT
      'sentimentos', 'pêsames', 'perda', 'rezamos', 'acompanhamos'
    ];
    const hasEmpathy = empathyKeywords.some(kw => lower.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) || lower.includes(kw));

    if (!hasEmpathy) {
      result.warnings.push('Contesto di lutto rilevato: la risposta sembra poco empatica o troppo burocratica');
      result.details.content.score = Math.min(result.details.content.score, 0.4);
      result.score = Math.min(result.score, 0.5);
      result.isValid = false;
    }
  }
}

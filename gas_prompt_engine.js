/**
 * PromptEngine.gs - Generazione prompt modulare
 * 19 classi template per composizione prompt
 * Supporta filtro dinamico basato su profilo
 * 
 * Include:
 * - Recupero selettivo Dottrina
 * - Checklist contestuale
 * - Ottimizzazione struttura prompt
 */

class PromptEngine {
  constructor() {
    // Logger strutturato
    this.logger = createLogger('PromptEngine');
    this.logger.info('Inizializzazione PromptEngine con recupero selettivo');

    // Configurazione filtering template per profilo
    this.LITE_SKIP_TEMPLATES = [
      'ExamplesTemplate',
      'FormattingGuidelinesTemplate',
      'HumanToneGuidelinesTemplate',
      'SpecialCasesTemplate'
    ];

    this.STANDARD_SKIP_TEMPLATES = [
      'ExamplesTemplate'
    ];

    this.logger.info('PromptEngine inizializzato', { templates: 20 });
  }

  /**
   * Stima token (approx 4 char/token per l'italiano/inglese)
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Determina se un template deve essere incluso in base a profilo e concern
   */
  _shouldIncludeTemplate(templateName, promptProfile, activeConcerns = {}) {
    if (promptProfile === 'heavy') {
      return true; // Profilo heavy include tutto
    }

    if (promptProfile === 'lite') {
      if (this.LITE_SKIP_TEMPLATES.includes(templateName)) {
        return false;
      }
    }

    if (promptProfile === 'standard') {
      if (this.STANDARD_SKIP_TEMPLATES.includes(templateName)) {
        // Salta esempi a meno che formatting_risk non sia attivo
        if (!activeConcerns.formatting_risk) {
          return false;
        }
      }
    }

    return true;
  }

  /**
  * Costruisce il prompt completo dal contesto
  * Supporta filtro dinamico template basato su profilo
  * 
  * ORDINE SEZIONI:
  * 1. Setup critico (Ruolo, Lingua, KB, Territorio) - Priorità alta
  * 2. Contesto (Memoria, Cronologia, Email)
  * 3. Linee guida (Formattazione, Tono, Esempi)
  * 4. Rinforzo finale (Errori critici, Checklist)
  */
  buildPrompt(options) {
    const {
      emailContent,
      emailSubject,
      knowledgeBase,
      senderName = 'Utente',
      senderEmail = '',
      conversationHistory = '',
      category = null,
      topic = '',
      detectedLanguage = 'it',
      currentSeason = 'invernale',
      currentDate = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd'),
      salutation = 'Buongiorno.',
      closing = 'Cordiali saluti,',
      subIntents = {},
      memoryContext = {},
      promptProfile = 'heavy',
      activeConcerns = {},
      salutationMode = 'full',
      responseDelay = null,
      territoryContext = null,
      attachmentsContext = ''
    } = options;

    let sections = [];
    let skippedCount = 0;

    // ══════════════════════════════════════════════════════
    // PRE-STIMA E BUDGETING TOKEN (Protezione Miglioramento #6 - Memory Growth)
    // ══════════════════════════════════════════════════════
    const MAX_SAFE_TOKENS = typeof CONFIG !== 'undefined' && CONFIG.MAX_SAFE_TOKENS
      ? CONFIG.MAX_SAFE_TOKENS : 100000;

    const OVERHEAD_TOKENS = (typeof CONFIG !== 'undefined' && CONFIG.PROMPT_ENGINE && CONFIG.PROMPT_ENGINE.OVERHEAD_TOKENS)
      ? CONFIG.PROMPT_ENGINE.OVERHEAD_TOKENS : 15000; // Riserva per istruzioni e sistema
    const KB_BUDGET_RATIO = 0.5; // La KB può occupare max il 50% dello spazio rimanente
    const availableForKB = Math.max(0, (MAX_SAFE_TOKENS - OVERHEAD_TOKENS) * KB_BUDGET_RATIO);
    const kbCharsLimit = Math.round(availableForKB * 4);

    let workingKnowledgeBase = knowledgeBase;
    let kbWasTruncated = false;

    // Troncamento proattivo della KB PRIMA di assemblare il prompt
    if (workingKnowledgeBase && workingKnowledgeBase.length > kbCharsLimit) {
      console.warn(`⚠️ KB eccede il budget (${workingKnowledgeBase.length} chars), tronco a ${kbCharsLimit}`);
      workingKnowledgeBase = this._truncateKbSemantically(
        workingKnowledgeBase,
        Math.max(1, Math.round(availableForKB))
      );
      kbWasTruncated = true;
    }

    let workingAttachmentsContext = attachmentsContext;
    if (kbWasTruncated && workingAttachmentsContext) {
      const attachmentSettings = (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT)
        ? CONFIG.ATTACHMENT_CONTEXT
        : {};
      const attachmentLimit = attachmentSettings.maxCharsWhenKbTruncated || 2000;
      if (workingAttachmentsContext.length > attachmentLimit) {
        console.warn(`⚠️ KB troncata: riduco allegati da ${workingAttachmentsContext.length} a ${attachmentLimit} chars`);
        workingAttachmentsContext = workingAttachmentsContext.slice(0, Math.max(0, attachmentLimit - 1)).trim() + '…';
      }
    }

    let usedTokens = 0;

    /**
     * Helper per aggiungere sezioni tracciando il budget token
     */
    const addSection = (section, label, options = {}) => {
      if (!section) return;
      const sectionTokens = this.estimateTokens(section);

      // Se superiamo il budget, saltiamo a meno che non sia forzato (es. istruzioni critiche)
      if (!options.force && usedTokens + sectionTokens > MAX_SAFE_TOKENS) {
        console.warn(`⚠️ Budget esaurito, sezione saltata: ${label}`);
        skippedCount++;
        return;
      }

      // Protezione memoria: Limita numero massimo sezioni
      if (sections.length >= 30) {
        console.warn(`⚠️ Limite sezioni raggiunto (30), salto sezione non critica: ${label}`);
        skippedCount++;
        return;
      }

      sections.push(section);
      usedTokens += sectionTokens;
    };

    /**
     * Helper per aggiungere template condizionali
     */
    const addTemplate = (templateName, content, label) => {
      if (this._shouldIncludeTemplate(templateName, promptProfile, activeConcerns)) {
        addSection(content, label || templateName);
      } else {
        skippedCount++;
      }
    };

    // ══════════════════════════════════════════════════════
    // BLOCCO 1: SETUP CRITICO (Priorità Massima)
    // ══════════════════════════════════════════════════════

    // 1. RUOLO SISTEMA
    addSection(this._renderSystemRole(), 'SystemRole', { force: true });

    // 2. ISTRUZIONI LINGUA
    addSection(this._renderLanguageInstruction(detectedLanguage), 'LanguageInstruction', { force: true });

    // 3. KNOWLEDGE BASE (Già troncata se necessario)
    addSection(this._renderKnowledgeBase(workingKnowledgeBase), 'KnowledgeBase');

    // 4. VERIFICA TERRITORIO
    // (Aggiunto context check per evitare undefined)
    if (territoryContext) {
      const territorySection = this._renderTerritoryVerification(territoryContext);
      if (territorySection) {
        addSection(territorySection, 'TerritoryVerification');
      }
    }

    // ══════════════════════════════════════════════════════
    // BLOCCO 2: CONTESTO E CONTINUITÀ
    // ══════════════════════════════════════════════════════

    // 5. CONTESTO MEMORIA
    addSection(this._renderMemoryContext(memoryContext), 'MemoryContext');

    // 6. CONTINUITÀ CONVERSAZIONALE
    addSection(this._renderConversationContinuity(salutationMode), 'ConversationContinuity');

    // 7. SCUSE PER RITARDO
    addSection(this._renderResponseDelay(responseDelay, detectedLanguage), 'ResponseDelay');

    // 8. FOCUS UMANO (Condizionale)
    const shouldAddContinuityFocus =
      (memoryContext && Object.keys(memoryContext).length > 0) ||
      (salutationMode && salutationMode !== 'full') ||
      activeConcerns.emotional_sensitivity ||
      activeConcerns.repetition_risk;
    if (shouldAddContinuityFocus) {
      addSection(this._renderContinuityHumanFocus(), 'ContinuityHumanFocus');
    }

    // 9. CONTESTO STAGIONALE E TEMPORALE
    addSection(this._renderSeasonalContext(currentSeason), 'SeasonalContext');
    addSection(this._renderTemporalAwareness(currentDate), 'TemporalAwareness');

    // 10. SUGGERIMENTO CATEGORIA
    addSection(this._renderCategoryHint(category), 'CategoryHint');

    // ══════════════════════════════════════════════════════
    // BLOCCO 2b: ARRICCHIMENTO KB CONDIZIONALE (AI_CORE)
    // ══════════════════════════════════════════════════════
    const requestTypeObj = options.requestType || { needsDiscernment: false, needsDoctrine: false };

    // AI_CORE_LITE: solo se componente pastorale
    if ((requestTypeObj.needsDiscernment || requestTypeObj.needsDoctrine) && typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE.aiCoreLite) {
      const liteSection = `
══════════════════════════════════════════════════════
📋 PRINCIPI PASTORALI FONDAMENTALI (AI_CORE_LITE)
══════════════════════════════════════════════════════
${GLOBAL_CACHE.aiCoreLite}
══════════════════════════════════════════════════════\n`;
      addSection(liteSection, 'AICoreLite');
    }

    // AI_CORE esteso: solo se discernimento
    if (requestTypeObj.needsDiscernment && typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE.aiCore) {
      const coreSection = `
══════════════════════════════════════════════════════
🧭 PRINCIPI PASTORALI ESTESI (AI_CORE) - Accompagnamento Personale
══════════════════════════════════════════════════════
${GLOBAL_CACHE.aiCore}
══════════════════════════════════════════════════════\n`;
      addSection(coreSection, 'AICore');
    }

    // 11. ARRICCHIMENTO DOTTRINALE (Selettivo)
    if (requestTypeObj.needsDoctrine || topic) {
      const selectiveDoctrine = this._renderSelectiveDoctrine(
        requestTypeObj,
        topic,
        emailContent,
        emailSubject,
        promptProfile,
        subIntents
      );
      if (selectiveDoctrine) {
        addSection(selectiveDoctrine, 'SelectiveDoctrine');
      } else if (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE.doctrineBase) {
        const doctrineSection = `
══════════════════════════════════════════════════════
📖 BASE DOTTRINALE (Dottrina) - Fallback Completo
══════════════════════════════════════════════════════
${GLOBAL_CACHE.doctrineBase}
══════════════════════════════════════════════════════\n`;
        addSection(doctrineSection, 'DoctrineFallback');
      }
    }

    // 12. CRONOLOGIA E CONTENUTO EMAIL
    if (conversationHistory) {
      addSection(this._renderConversationHistory(conversationHistory), 'ConversationHistory');
    }
    addSection(this._renderEmailContent(emailContent, emailSubject, senderName, senderEmail, detectedLanguage), 'EmailContent');
    addSection(this._renderAttachmentContext(workingAttachmentsContext), 'AttachmentsContext');

    // ══════════════════════════════════════════════════════
    // BLOCCO 3: LINEE GUIDA E TEMPLATE
    // ══════════════════════════════════════════════════════

    // 13. REGOLE NO REPLY
    addSection(this._renderNoReplyRules(), 'NoReplyRules');

    // 14. LINEE GUIDA (Filtrabili per profilo)
    addTemplate('FormattingGuidelinesTemplate', this._renderFormattingGuidelines(), 'FormattingGuidelines');

    // 15. STRUTTURA RISPOSTA
    addSection(this._renderResponseStructure(category, subIntents), 'ResponseStructure');

    // 16. TEMPLATE SPECIALI (Sbattezzo ecc.)
    const normalizedTopic = (topic || '').toLowerCase();
    if (normalizedTopic.includes('sbattezzo') || category === 'formal' || (category === 'sbattezzo')) {
      addSection(this._renderSbattezzoTemplate(senderName), 'SbattezzoTemplate');
    }

    addTemplate('HumanToneGuidelinesTemplate', this._renderHumanToneGuidelines(), 'HumanToneGuidelines');
    addTemplate('ExamplesTemplate', this._renderExamples(category), 'Examples');

    // 17. REGOLE FINALI
    addSection(this._renderResponseGuidelines(detectedLanguage, currentSeason, salutation, closing), 'ResponseGuidelines');

    if (!normalizedTopic.includes('sbattezzo') && category !== 'formal') {
      addTemplate('SpecialCasesTemplate', this._renderSpecialCases(), 'SpecialCases');
    }

    // ══════════════════════════════════════════════════════
    // BLOCCO 4: RINFORZO FINALE
    // ══════════════════════════════════════════════════════

    addSection(this._renderCriticalErrorsReminder(), 'CriticalErrorsReminder');
    addSection(this._renderContextualChecklist(detectedLanguage, territoryContext, salutationMode), 'ContextualChecklist');

    addSection('**Genera la risposta completa seguendo le linee guida sopra:**', 'FinalInstruction', { force: true });

    // Componi prompt finale tramite concatenazione efficiente
    const prompt = sections.join('\n\n');
    const finalTokens = this.estimateTokens(prompt);

    console.log(`📝 Prompt generato: ${prompt.length} caratteri (~${finalTokens} token) | Profilo: ${promptProfile} | Saltati: ${skippedCount}`);

    return prompt;
  }

  // ========================================================================
  // TEMPLATE 1: ERRORI CRITICI REMINDER (VERSIONE CONDENSATA)
  // ========================================================================
  // Una sola volta nel prompt

  _renderCriticalErrorsReminder() {
    return `
🚨 REMINDER ERRORI CRITICI (verifica finale):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ Maiuscola dopo virgola: "Ciao, Siamo" → SBAGLIATO
✅ Minuscola dopo virgola: "Ciao, siamo" → GIUSTO

❌ Link ridondante: [url](url) → SBAGLIATO  
✅ Link pulito: Iscrizione: https://url → GIUSTO

❌ Nome minuscolo: "federica" → SBAGLIATO
✅ Nome maiuscolo: "Federica" → GIUSTO

❌ Ragionamento esposto: "La KB dice...", "Devo correggere..." → BLOCCA RISPOSTA
✅ Risposta pulita: solo contenuto finale → GIUSTO

❌ Loop "contattaci": L'utente ci ha già scritto! Non dire "scrivici a info@..."
✅ Presa in carico: "Inoltrerò la richiesta", "Verificheremo"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  // ========================================================================
  // TEMPLATE 1.5: CHECKLIST CONTESTUALE
  // ========================================================================
  // Sostituisce checklist generica con versione mirata per lingua/contesto

  _renderContextualChecklist(detectedLanguage, territoryContext, salutationMode) {
    const checks = [];

    // Controlli universali
    checks.push('□ Ho risposto SOLO alla domanda posta');
    checks.push('□ Ho usato SOLO informazioni dalla KB');
    checks.push('□ NO ragionamento esposto (es: "la KB dice...", "devo correggere...")');

    // Controlli lingua-specifici
    if (detectedLanguage === 'it') {
      checks.push('□ Minuscola dopo virgola (es: "Ciao, siamo" NON "Ciao, Siamo")');
      checks.push('□ Nomi propri MAIUSCOLI (es: "Federica" NON "federica")');
      checks.push('□ Ho corretto errori grammaticali dell\'utente (NON copiati)');
    } else if (detectedLanguage === 'en') {
      checks.push('□ ENTIRE response in ENGLISH (NO Italian words)');
    } else if (detectedLanguage === 'es') {
      checks.push('□ TODA la respuesta en ESPAÑOL (NO palabras italianas)');
    }

    // Controlli territorio (se rilevante)
    if (territoryContext && territoryContext.includes('RIENTRA')) {
      checks.push('□ Ho dato risposta SÌ/NO sul territorio (NON "verificheremo")');
      checks.push('□ Ho usato ESATTAMENTE i dati della verifica territorio');
    }

    // Controlli saluto
    if (salutationMode === 'none_or_continuity' || salutationMode === 'session') {
      checks.push('□ NO saluti rituali (es: Buongiorno) - conversazione in corso');
    }

    // Controlli anti-ridondanza
    checks.push('□ Se l\'utente ha detto "Ho già X", NON ho fornito X di nuovo');
    checks.push('□ Link formato: "Descrizione: https://url" NON "[url](url)"');

    return `
══════════════════════════════════════════════════════
✅ CHECKLIST FINALE CONTESTUALE - VERIFICA PRIMA DI RISPONDERE
══════════════════════════════════════════════════════
${checks.join('\n')}
══════════════════════════════════════════════════════`;
  }

  /**
   * Tronca la KB semanticamente rispettando il budget di token
   * Cerca di preservare intere sezioni o paragrafi
   */
  _truncateKbSemantically(kbText, charLimit) {
    if (!kbText || kbText.length <= charLimit) return kbText;

    console.log(`✂️ Troncamento KB richiesto: ${kbText.length} -> ${charLimit} chars`);

    // Tenta di tagliare a un'intestazione di sezione importante
    const markers = [
      '\n# ', '\n## ', '\n### ', // Markdown headers
      '\n════', '\n----'          // Separatori
    ];

    let cutIndex = -1;

    // Cerca il miglior punto di taglio prima del limite
    // Idealmente ultimo marker prima del limite
    let bestMarkerPos = -1;

    for (const marker of markers) {
      const lastPos = kbText.lastIndexOf(marker, charLimit);
      if (lastPos > bestMarkerPos) {
        bestMarkerPos = lastPos;
      }
    }

    if (bestMarkerPos > charLimit * 0.5) {
      // Se abbiamo trovato un buon punto di taglio (almeno a metà del budget)
      cutIndex = bestMarkerPos;
    } else {
      // Fallback: cerca fine paragrafo
      const lastPeriod = kbText.lastIndexOf('.\n', charLimit);
      if (lastPeriod > charLimit * 0.5) {
        cutIndex = lastPeriod + 1;
      } else {
        // Fallback estremo: cerca ultimo spazio
        cutIndex = kbText.lastIndexOf(' ', charLimit);
      }
    }

    if (cutIndex > 0) {
      return kbText.substring(0, cutIndex) + '\n\n[... KB troncata per limiti di lunghezza ...]';
    }

    return kbText.substring(0, charLimit) + '...';
  }

  // ========================================================================
  // TEMPLATE 2: RECUPERO SELETTIVO DOTTRINA
  // ========================================================================
  // Sostituisce dump completo con recupero mirato

  /**
   * Recupero selettivo UNIFICATO (Dottrina + Direttive)
   * Integra logica dimensionale, tono consigliato e volume adattivo
   */
  _renderSelectiveDoctrine(requestType, topic, emailContent, emailSubject, promptProfile, subIntents) {
    if (typeof GLOBAL_CACHE === 'undefined' || !GLOBAL_CACHE.doctrineStructured) {
      console.warn('⚠️ Cache dottrina non disponibile');
      return null;
    }

    const doctrineDB = GLOBAL_CACHE.doctrineStructured;
    if (!Array.isArray(doctrineDB) || doctrineDB.length === 0) return null;

    // 1. Definisci pesi categorie basati su dimensioni (se disponibili)
    // Se requestType è stringa semplice, usa preset. Se è oggetto, usa dimensioni.
    let dimWeights = {};
    let suggestedTone = '';

    if (typeof requestType === 'object' && requestType.dimensions) {
      // Usa dimensioni calcolate dal classifier
      dimWeights = {
        'sacrament': 1.0, // Base
        'pastoral': requestType.dimensions.pastoral || 0.5,
        'doctrinal': requestType.dimensions.doctrinal || 0.5,
        'technical': requestType.dimensions.technical || 0.5
      };
      suggestedTone = (requestType.suggestedTone || '').toLowerCase();
    } else {
      // Fallback per compatibilità
      const typeStr = (typeof requestType === 'string' ? requestType : requestType.type) || 'technical';
      const isPastoral = typeStr === 'pastoral';
      const isDoctrinal = typeStr === 'doctrinal';
      dimWeights = {
        'sacrament': 1.0,
        'pastoral': isPastoral ? 1.0 : 0.3,
        'doctrinal': isDoctrinal ? 1.0 : 0.3,
        'technical': typeStr === 'technical' ? 1.0 : 0.3
      };
    }

    // Mappa Categorie Dottrina -> Key Pesi
    const getCatWeight = (cat) => {
      cat = (cat || '').toLowerCase();
      if (cat.includes('sacrament')) return dimWeights.sacrament;
      if (cat.includes('pastorale') || cat.includes('matrimoni')) return dimWeights.pastoral;
      if (cat.includes('morale') || cat.includes('bioetica') || cat.includes('ecclesiologia')) return dimWeights.doctrinal;
      return 0.5; // Default neutral
    };

    // 2. Volume Control (guidato da promptProfile)
    let MAX_ROWS = 5;
    if (promptProfile === 'lite') MAX_ROWS = 3;
    else if (promptProfile === 'heavy') MAX_ROWS = 8;

    // 3. Scoring System Unificato
    // Mappa di fallback per sub-intents (EN -> IT)
    const subIntentMap = {
      'bereavement': 'lutto',
      'emotional_distress': 'ascolto',
      'gratitude': 'ringraziamento',
      'confusion': 'chiarimento',
      'appointment': 'appuntamento',
      'information': 'informazioni',
      'sacrament': 'sacramenti',
      'complaint': 'lamentela'
    };

    // Se topic è vuoto o inglese, tenta recupero da sub-intents o traduzione
    let topicLower = (topic || '').toLowerCase();

    // Fallback su subIntents se topic manca
    if (!topicLower && subIntents) {
      for (const [key, val] of Object.entries(subIntents)) {
        if (val === true && subIntentMap[key]) {
          topicLower = subIntentMap[key];
          console.log(`   🔄 Fallback topic da subIntent: ${key} -> ${topicLower}`);
          break;
        }
      }
    }

    const fullTextLower = `${emailSubject} ${emailContent}`.toLowerCase();

    // Keywords critiche
    const keywords = ['confessione', 'battesimo', 'eucaristia', 'matrimonio', 'cresima', 'divorziato', 'convivente', 'peccato'];

    console.log(`🔍 Retrieval Start: profilo=${promptProfile}, MAX_ROWS=${MAX_ROWS}`);

    const candidates = doctrineDB.map(row => {
      let score = 0;
      const sottotema = String(row['Sotto-tema'] || '').toLowerCase();
      const rowTone = String(row['Tono consigliato'] || '').toLowerCase();
      const rowCat = String(row.Categoria || '');

      // A. Rilevanza Semantica (Topic/Text)
      // Match forte su topic
      if (topicLower && sottotema.includes(topicLower)) score += 10;
      // Match keyword nel testo
      keywords.forEach(kw => {
        if (fullTextLower.includes(kw) && sottotema.includes(kw)) score += 3;
      });
      // Match generico contenuto
      if (fullTextLower.includes(sottotema)) score += 2;

      // B. Peso Categoriale (da Dimensioni)
      score *= (1 + getCatWeight(rowCat));

      // C. Coerenza Tono (Boost direttive allineate)
      // Se il tono suggerito dal classifier matcha il tono della riga
      if (suggestedTone && rowTone && suggestedTone.includes(rowTone.split(' ')[0])) {
        score += 2;
      }

      // D. Penalità 'Noise' (sottotemi troppo generici)
      if (sottotema.length < 5) score -= 5;
      
      return { row, score };
    });

    // 4. Selezione e Rendering
    candidates.sort((a, b) => b.score - a.score);

    // Threshold dinamico basato su profilo
    let threshold = (promptProfile === 'lite') ? 5.0 : (promptProfile === 'standard') ? 3.0 : 1.0;

    const selected = candidates.filter(c => c.score >= threshold).slice(0, MAX_ROWS);

    if (selected.length === 0) {
      const topScore = typeof candidates[0]?.score === 'number' ? candidates[0].score : 0;
      if (topScore <= 0) {
        console.info(`ℹ️ Nessuna riga rilevante (top: ${topScore.toFixed(1)}). Uso fallback dottrinale completo.`);
      } else {
        console.warn(`⚠️ Nessuna riga supera threshold ${threshold} (top: ${topScore.toFixed(1)}). Fallback dump.`);
      }
      return null;
    }

    console.log(`✓ ${selected.length} righe selezionate (score range: ${selected[0].score.toFixed(1)} - ${selected[selected.length - 1].score.toFixed(1)})`);
    selected.forEach((item, i) => console.log(`   ${i + 1}. ${String(item.row['Sotto-tema']).substring(0, 40)}... (${item.score.toFixed(1)})`));

    // Formatting con integrazione campi direttivi (Note/Tono)
    const directives = selected.map(item => {
      const r = item.row;
      const principio = r['Principio dottrinale'] ? `• Principio: ${r['Principio dottrinale']}` : '';
      const criterio = r['Criterio pastorale'] ? `• Leva Pastorale: ${r['Criterio pastorale']}` : '';
      const tono = r['Tono consigliato'] ? `• Tono: ${r['Tono consigliato']}` : '';
      const note = r['Indicazioni operative AI'] ? `⚠️ Nota AI: ${r['Indicazioni operative AI']}` : '';

      return `📌 ${String(r['Sotto-tema']).toUpperCase()}
${principio}
${criterio}
${tono}
${note}`;
    }).join('\n\n');

    return `
══════════════════════════════════════════════════════
📖 RIFERIMENTI DOTTRINALI & DIRETTIVE (${selected.length} elementi)
(Selezionati per rilevanza e coerenza di tono)
══════════════════════════════════════════════════════
${directives}
══════════════════════════════════════════════════════
⚠️ IMPORTANTE: Questi riferimenti dottrinali sono stati selezionati come 
pertinenti alla richiesta. Usali per orientare la risposta, ma rispondi 
sempre in modo concreto alla domanda posta.
══════════════════════════════════════════════════════`;
  }

  // ========================================================================
  // TEMPLATE 2: CONTINUITÀ + UMANITÀ + FOCUS (leggero)
  // ========================================================================

  _renderContinuityHumanFocus() {
    return `══════════════════════════════════════════════════════
🧭 CONTINUITÀ, UMANITÀ E FOCUS (LINEE GUIDA ESSENZIALI)
══════════════════════════════════════════════════════
1) CONTINUITÀ: Se emerge che l'utente ha già ricevuto una risposta su questo tema, evita di ripetere informazioni identiche. Usa al massimo 1 frase di continuità (es. "Riprendo volentieri da quanto detto..."), poi vai al punto.
2) UMANITÀ MISURATA: Usa una frase empatica SOLO se il messaggio mostra un chiaro segnale emotivo o pastorale. Altrimenti rispondi in modo diretto e sobrio.
3) FOCUS: Rispondi prima al tema principale (topic). Aggiungi solo informazioni secondarie se strettamente utili.
4) COERENZA LINGUISTICA: Mantieni la stessa lingua e livello di formalità dell'email ricevuta.
5) PRUDENZA LEGGERA: Se la confidenza è bassa, formula con neutralità senza scuse o frasi di indecisione.
══════════════════════════════════════════════════════`;
  }

  // ========================================================================
  // TEMPLATE 3: RUOLO SISTEMA
  // ========================================================================

  _renderSystemRole() {
    return `Sei la segreteria della Parrocchia di Sant'Eugenio a Roma.

📖 MANDATO DOTTRINALE:
Quando vengono richieste spiegazioni di carattere dottrinale o canonico in forma generale,
il tuo compito è fornire una spiegazione chiara, fedele e informativa
dell'insegnamento pubblico della Chiesa.

Rimanda a un sacerdote SOLO quando la richiesta riguarda
una situazione personale, uno stato di vita concreto
o richiede discernimento pastorale.

🎯 IL TUO STILE:
• RISPONDI SOLO A QUANTO CHIESTO. Essenziale.
• Conciso ma completo rispetto ALLA DOMANDA (non all'argomento generale).
• Istituzionale (usa "restiamo", "siamo lieti") ma umano.
• Forma di cortesia: usa SEMPRE il registro formale; in italiano usa il "Lei" ed eviti il "tu".
• Empatico verso le esigenze delle persone.

🚫 DIVIETO DI INFODUMPING:
Se l'utente fa una domanda specifica (es. "Ci sono posti?"),
NON incollare tutto il programma, tutti gli orari, tutti i costi.
Rispondi SOLO alla domanda. Aggiungi dettagli extra SOLO se strettamente correlati.

🧠 CONSAPEVOLEZZA DEL CONTESTO:
La persona ti sta già scrivendo via email. Sei già in contatto con lei.
Quindi:
• Evita di dire "contattare la segreteria" - la sta già contattando!
• Evita di dare l'indirizzo email della parrocchia - ci ha già scritto!
• Se serve un contatto ulteriore, suggerisci di telefonare o venire in segreteria.
• Frasi corrette: "può chiamarci al...", "può venire a trovarci", "risponda a questa email".
• Frasi da evitare: "può scriverci a info@...", "contatti la segreteria via email".

🎯 ASCOLTO ATTIVO (INTEGRAZIONE, NON ECO):
• Se l'utente ti dice "Vengo con un'amica", NON rispondere "Bene che vieni con un'amica".
• RISPONDI INTEGRANDO: "Perfetto, per due persone le opzioni sono..."
• Mostra di aver capito agendo sull'informazione, non ripetendola a pappagallo.
• NON chiedere informazioni che l'utente ha appena scritto.

🏷️ IDENTIFICAZIONE CORRETTA DEL NOME:
Il campo "Da:" mostra il nome dell'account email, ma NON sempre chi sta scrivendo.
SE nel TESTO dell'email c'è una FIRMA esplicita (es. "Mario e Giulia", "Romualdo"):
→ USA il nome dalla FIRMA nel testo, NON il nome dell'header "Da:"

NON sei un chatbot freddo - sei una persona reale della segreteria che vuole aiutare (efficacemente).

⚖️ CORRETTEZZA LINGUISTICA & STILE (PRIORITÀ ALTA):
1. **GRAMMATICA IMPECCABILE**: Usa SEMPRE la grammatica italiana corretta.
   - Se l'utente sbaglia ("la canale", "i orari"), tu rispondi CORRETTAMENTE ("il canale", "gli orari").
   - NON imitare MAI gli errori dell'utente.
   - NON far notare l'errore ("Hai scritto male..."), correggilo e basta implicitamente.

2. **ASCOLTO ATTIVO (SÌ, MA CON GIUDIZIO)**:
   - Riprendi i termini dell'utente per fargli capire che hai letto, MA SOLO se sono corretti.
   - Se l'uso del termine dell'utente porterebbe a un errore grammaticale, USA IL TERMINE CORRETTO.`;
  }

  // ========================================================================
  // TEMPLATE 4: ISTRUZIONI LINGUA
  // ========================================================================

  _renderLanguageInstruction(lang) {
    const instructions = {
      'it': "Rispondi in italiano, la lingua dell'email ricevuta.",
      'en': `══════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL LANGUAGE REQUIREMENT - ENGLISH 🚨🚨🚨
══════════════════════════════════════════════════════

The incoming email is written in ENGLISH.

YOU MUST:
✅ Write your ENTIRE response in ENGLISH
✅ Use English greetings: "Good morning," "Good afternoon," "Good evening,"
✅ Use English closings: "Kind regards," "Best regards,"
✅ Maintain a formal, courteous register throughout
✅ Translate any Italian information into English

YOU MUST NOT:
❌ Use ANY Italian words (no "Buongiorno", "Cordiali saluti", etc.)
❌ Mix languages

This is MANDATORY. The sender speaks English and will not understand Italian.
══════════════════════════════════════════════════════`,
      'es': `══════════════════════════════════════════════════════
🚨🚨🚨 REQUISITO CRÍTICO DE IDIOMA - ESPAÑOL 🚨🚨🚨
══════════════════════════════════════════════════════

El correo recibido está escrito en ESPAÑOL.

DEBES:
✅ Escribir TODA tu respuesta en ESPAÑOL
✅ Usar saludos españoles: "Buenos días," "Buenas tardes,"
✅ Usar despedidas españolas: "Cordiales saludos," "Un saludo,"
✅ Mantener un registro formal; utilizar "usted" y evitar "tú"

NO DEBES:
❌ Usar NINGUNA palabra italiana
❌ Mezclar idiomas

Esto es OBLIGATORIO. El remitente habla español y no entenderá italiano.
══════════════════════════════════════════════════════`,
      'pt': `══════════════════════════════════════════════════════
🚨🚨🚨 REQUISITO CRÍTICO DE IDIOMA - PORTUGUÊS 🚨🚨🚨
══════════════════════════════════════════════════════

O email recebido está escrito em PORTUGUÊS.

DEVE:
✅ Escrever TODA a resposta em PORTUGUÊS
✅ Usar saudações portuguesas: "Bom dia," "Boa tarde," "Boa noite,"
✅ Usar despedidas portuguesas: "Com os melhores cumprimentos," "Atenciosamente,"
✅ Manter um registo formal e cordial

NÃO DEVE:
❌ Usar palavras italianas
❌ Misturar idiomas

Isto é OBRIGATÓRIO. O remetente pode não entender italiano.
══════════════════════════════════════════════════════`
    };

    // Per lingue non specificate, genera istruzione generica
    if (!instructions[lang]) {
      return `══════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL LANGUAGE REQUIREMENT 🚨🚨🚨
══════════════════════════════════════════════════════

The incoming email is written in language code: "${lang.toUpperCase()}"

YOU MUST:
✅ Write your ENTIRE response in the SAME LANGUAGE as the incoming email
✅ Use appropriate greetings and closings for that language
✅ Maintain a formal, courteous register in that language
✅ Translate any Italian information into the sender's language

YOU MUST NOT:
❌ Use Italian words (no "Buongiorno", "Cordiali saluti", etc.)
❌ Mix languages

This is MANDATORY. The sender may not understand Italian.
══════════════════════════════════════════════════════`;
    }

    return instructions[lang];
  }

  // ========================================================================
  // TEMPLATE 5: CONTESTO MEMORIA
  // ========================================================================

  _renderMemoryContext(memoryContext) {
    if (!memoryContext || Object.keys(memoryContext).length === 0) return null;

    let sections = [];

    if (memoryContext.language) {
      sections.push(`• LINGUA STABILITA: ${memoryContext.language.toUpperCase()}`);
    }

    if (memoryContext.memorySummary) {
      sections.push('• RIASSUNTO CONVERSAZIONE:');
      sections.push(memoryContext.memorySummary);
    }

    if (memoryContext.providedInfo && memoryContext.providedInfo.length > 0) {
      const infoList = [];
      const questionedTopics = [];
      const acknowledgedTopics = [];
      const needsExpansionTopics = [];

      memoryContext.providedInfo.forEach(item => {
        // Normalizzazione formato (supporto stringa semplice o oggetto)
        const topic = (typeof item === 'object') ? item.topic : item;
        const reaction = (typeof item === 'object') ? item.userReaction || item.reaction : 'unknown';

        if (reaction === 'questioned') {
          questionedTopics.push(topic);
        } else if (reaction === 'acknowledged') {
          acknowledgedTopics.push(topic);
        } else if (reaction === 'needs_expansion') {
          needsExpansionTopics.push(topic);
        } else {
          infoList.push(topic);
        }
      });

      if (infoList.length > 0) {
        sections.push(`• INFORMAZIONI GIÀ FORNITE: ${infoList.join(', ')}`);
        sections.push('⚠️ NON RIPETERE queste informazioni se non richieste esplicitamente.');
      }

      if (acknowledgedTopics.length > 0) {
        sections.push(`✅ UTENTE HA CAPITO: ${acknowledgedTopics.join(', ')}`);
        sections.push('🚫 NON RIPETERE ASSOLUTAMENTE queste informazioni. Dai per scontato che le sappiano.');
      }

      if (questionedTopics.length > 0) {
        sections.push(`❓ UTENTE NON HA CAPITO: ${questionedTopics.join(', ')}`);
        sections.push('⚡ URGENTE: Spiega questi punti di nuovo MA con parole diverse, più semplici e chiare. Usa esempi.');
      }

      if (needsExpansionTopics.length > 0) {
        sections.push(`🧩 UTENTE CHIEDE PIÙ DETTAGLI: ${needsExpansionTopics.join(', ')}`);
        sections.push('➕ Fornisci dettagli aggiuntivi e passaggi pratici, mantenendo il tono formale (Lei).');
      }
    }

    if (sections.length === 0) return null;

    return `══════════════════════════════════════════════════════
🧠 CONTESTO MEMORIA (CONVERSAZIONE IN CORSO)
══════════════════════════════════════════════════════
${sections.join('\n')}
══════════════════════════════════════════════════════`;
  }

  // ========================================================================
  // TEMPLATE 6: CONTINUITÀ CONVERSAZIONALE
  // ========================================================================

  _renderConversationContinuity(salutationMode) {
    if (!salutationMode || salutationMode === 'full') {
      return null; // Primo contatto: nessuna istruzione speciale
    }

    if (salutationMode === 'session') {
      return `══════════════════════════════════════════════════════
🧠 CONTINUITÀ CONVERSAZIONALE - REGOLA VINCOLANTE
══════════════════════════════════════════════════════

📌 MODALITÀ SALUTO: SESSIONE CONVERSAZIONALE (chat rapida)

La conversazione è in corso e ravvicinata nel tempo.

REGOLE OBBLIGATORIE:
✅ NON usare saluti rituali o formule introduttive
✅ Rispondi in modo DIRETTO e più SECCO del normale
✅ Usa frasi brevi, concrete e orientate alla richiesta
✅ Evita preamboli o ripetizioni

ESEMPI DI APERTURA CORRETTA:
• "Ricevuto."
• "Grazie per la precisazione."
• "In merito a quanto chiede:"

══════════════════════════════════════════════════════`;
    }

    if (salutationMode === 'none_or_continuity') {
      return `══════════════════════════════════════════════════════
🧠 CONTINUITÀ CONVERSAZIONALE - REGOLA VINCOLANTE
══════════════════════════════════════════════════════

📌 MODALITÀ SALUTO: FOLLOW-UP RECENTE (conversazione in corso)

La conversazione è già avviata. Questa NON è la prima interazione.

REGOLE OBBLIGATORIE:
✅ NON usare saluti rituali completi (Buongiorno, Buon Natale, ecc.)
✅ NON ripetere saluti festivi già usati nel thread
✅ Inizia DIRETTAMENTE dal contenuto OPPURE usa una frase di continuità

FRASI DI CONTINUITÀ CORRETTE:
• "Grazie per il messaggio."
• "Ecco le informazioni richieste."
• "Riguardo alla sua domanda..."
• "In merito a quanto ci chiede..."

⚠️ DIVIETO: Ripetere lo stesso saluto è percepito come MECCANICO e non umano.

══════════════════════════════════════════════════════`;
    }

    if (salutationMode === 'soft') {
      return `══════════════════════════════════════════════════════
🧠 CONTINUITÀ CONVERSAZIONALE - REGOLA VINCOLANTE
══════════════════════════════════════════════════════

📌 MODALITÀ SALUTO: RIPRESA CONVERSAZIONE (dopo una pausa)

REGOLE:
✅ Usa un saluto SOFT, non il rituale standard
✅ NON usare "Buongiorno/Buonasera" come se fosse il primo contatto

SALUTI SOFT CORRETTI:
• "Ci fa piacere risentirla."
• "Grazie per averci ricontattato."
• "Bentornato/a."

══════════════════════════════════════════════════════`;
    }

    return null;
  }

  // ========================================================================
  // TEMPLATE 7: GESTIONE RITARDO RISPOSTA
  // ========================================================================

  _renderResponseDelay(responseDelay, detectedLanguage = 'it') {
    if (!responseDelay || !responseDelay.shouldApologize) {
      return null;
    }

    const apologyByLanguage = {
      it: 'Ci scusiamo per il ritardo con cui rispondiamo.',
      en: 'We apologize for the delay in responding.',
      es: 'Pedimos disculpas por la demora en nuestra respuesta.'
    };

    const apologyLine = apologyByLanguage[detectedLanguage] || apologyByLanguage.it;

    return `══════════════════════════════════════════════════════
⏳ RISPOSTA IN RITARDO - REGOLA VINCOLANTE
══════════════════════════════════════════════════════

Il messaggio è arrivato da alcuni giorni.

REGOLE OBBLIGATORIE:
✅ Apri la risposta con una breve frase di scuse per il ritardo
✅ Mantieni il resto della risposta diretto e professionale
✅ Non attribuire colpe o dettagli tecnici (niente "spam", "problemi tecnici")

ESEMPIO DI APERTURA:
• "${apologyLine}"`;
  }

  // ========================================================================
  // TEMPLATE 8: KNOWLEDGE BASE
  // ========================================================================

  _renderKnowledgeBase(knowledgeBase) {
    return `**INFORMAZIONI DI RIFERIMENTO:**
<knowledge_base>
${knowledgeBase}
</knowledge_base>

**REGOLA FONDAMENTALE:** Usa SOLO informazioni presenti sopra. NON inventare.`;
  }

  // ========================================================================
  // TEMPLATE 9: VERIFICA TERRITORIO
  // ========================================================================

  _renderTerritoryVerification(territoryContext) {
    if (!territoryContext) return null;

    return `**VERIFICA TERRITORIO PARROCCHIALE (DATI CERTIFICATI - FONTE SUPREMA):**

${territoryContext}

⚠️⚠️⚠️ ISTRUZIONI VINCOLANTI SUI DATI SOPRA ⚠️⚠️⚠️

1. I DATI QUI SOPRA SONO L'UNICA VERITÀ. Ignora qualsiasi tua conoscenza pregressa.
2. SE LEGGI "RIENTRA" -> Devi dire SÌ.
3. SE LEGGI "NON RIENTRA" -> Devi dire NO.
4. SE LEGGI "CIVICO NECESSARIO" -> Devi chiedere il civico.

⛔ È ASSOLUTAMENTE VIETATO SCRIVERE:
   - "Verificheremo"
   - "Chiederò in segreteria"
   - "Faremo un controllo manuale"
   - "Le faremo sapere"

SE LO SCRIVI, IL TUO COMPITO È FALLITO.
Devi dare la risposta SÌ/NO adesso, basandoti ESCLUSIVAMENTE sui dati qui sopra.`;
  }

  // ========================================================================
  // TEMPLATE 10: CONTESTO STAGIONALE
  // ========================================================================

  _renderSeasonalContext(currentSeason) {
    return `**ORARI STAGIONALI:**
IMPORTANTE: Siamo nel periodo ${currentSeason.toUpperCase()}. Usa SOLO gli orari ${currentSeason}.
Non mostrare mai entrambi i set di orari.`;
  }

  // ========================================================================
  // TEMPLATE 11: CONSAPEVOLEZZA TEMPORALE
  // ========================================================================

  _renderTemporalAwareness(currentDate) {
    let dateObj;
    if (typeof currentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(currentDate)) {
      const [year, month, day] = currentDate.split('-').map(Number);
      dateObj = new Date(year, month - 1, day);
    } else {
      dateObj = new Date(currentDate);
    }
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const humanDate = dateObj.toLocaleDateString('it-IT', options);

    return `══════════════════════════════════════════════════════
📅 DATA ODIERNA: ${currentDate} (${humanDate})
══════════════════════════════════════════════════════

⚠️ REGOLE TEMPORALI CRITICHE - PENSA COME UN UMANO:

1. **ORDINE CRONOLOGICO OBBLIGATORIO**
   • Presenta SEMPRE gli eventi futuri dal più vicino al più lontano
   • NON seguire l'ordine della knowledge base se non è cronologico

2. **NON usare etichette che confondono**
   • Se la KB dice "primo corso: ottobre" e "secondo corso: marzo"
     NON ripetere queste etichette
   • Usa: "Il prossimo corso disponibile...", "Il corso successivo..."

3. **EVENTI GIÀ PASSATI - COMUNICALO CHIARAMENTE**
   Se l'utente chiede di un evento ANNUALE e la data è GIÀ PASSATA:
   ✅ DÌ che l'evento di quest'anno si è già svolto
   ✅ Indica QUANDO si è svolto
   ✅ Suggerisci QUANDO chiedere info per l'anno prossimo

4. **Anno pastorale vs anno solare**
   • L'anno pastorale va da settembre ad agosto
   • "Quest'anno" per eventi parrocchiali = anno pastorale corrente

══════════════════════════════════════════════════════`;
  }

  // ========================================================================
  // TEMPLATE 12: SUGGERIMENTO CATEGORIA
  // ========================================================================

  _renderCategoryHint(category) {
    if (!category) return null;

    const hints = {
      'appointment': '📌 Email su APPUNTAMENTO: fornisci info su come fissare appuntamenti.',
      'information': '📌 Richiesta INFORMAZIONI: rispondi basandoti sulla knowledge base. ✅ USA FORMATTAZIONE se 3+ orari/elementi.',
      'sacrament': '📌 Email su SACRAMENTI: fornisci info dettagliate. ✅ USA FORMATTAZIONE per requisiti/date.',
      'collaboration': '📌 Proposta COLLABORAZIONE: ringrazia e spiega come procedere.',
      'complaint': '📌 Possibile RECLAMO: rispondi con empatia e professionalità.',
      'quotation': '📌 PREVENTIVO/OFFERTA RICEVUTA: Ringrazia, conferma ricezione, comunica che esaminerai e risponderai. ⚠️ NON dire "restiamo a disposizione per chiarimenti" - siamo noi i destinatari!'
    };

    if (hints[category]) {
      return `**CATEGORIA IDENTIFICATA:**
${hints[category]}`;
    }

    // Mappatura predefinita per categorie generali
    const fallbackMap = {
      'technical': 'information',
      'pastoral': 'collaboration',
      'doctrinal': 'information'
    };

    const effectiveCategory = fallbackMap[category] || null;
    return effectiveCategory ? `**CATEGORIA IDENTIFICATA:**
${hints[effectiveCategory]}` : null;
  }

  // ========================================================================
  // TEMPLATE 14: LINEE GUIDA FORMATTAZIONE
  // ========================================================================

  _renderFormattingGuidelines() {
    return `══════════════════════════════════════════════════════
✨ FORMATTAZIONE ELEGANTE E USO ICONE
══════════════════════════════════════════════════════

🎨 QUANDO USARE FORMATTAZIONE MARKDOWN:

1. **Elenchi di 3+ elementi** → Usa elenchi puntati con icone
2. **Orari multipli** → Tabella strutturata con icone
3. **Informazioni importanti** → Grassetto per evidenziare
4. **Sezioni distinte** → Intestazioni H3 (###) con icona

📋 ICONE CONSIGLIATE PER CATEGORIA:

**ORARI E DATE:**
• 📅 Date specifiche | ⏰ Orari | 🕒 Orari Messe

**LUOGHI E CONTATTI:**
• 📍 Indirizzo / Luogo | 📞 Telefono | 📧 Email

**DOCUMENTI E REQUISITI:**
• 📄 Documenti | ✅ Requisiti soddisfatti | ⚠️ Attenzione

**ATTIVITÀ E SACRAMENTI:**
• ⛪ Chiesa / Parrocchia | ✍️ Sacramenti | 📖 Catechesi | 🙏 Preghiera

⚠️ REGOLE IMPORTANTI:

1. **NON esagerare con le icone** - Usa 1 icona per categoria
2. **Usa Markdown SOLO quando migliora la leggibilità**
3. **Mantieni coerenza** - Stessa icona per stesso tipo info

💡 QUANDO NON USARE FORMATTAZIONE AVANZATA:
❌ Risposte brevissime (1-2 frasi)
❌ Semplici conferme
❌ Ringraziamenti

══════════════════════════════════════════════════════`;
  }

  // ========================================================================
  // TEMPLATE 15: STRUTTURA RISPOSTA
  // ========================================================================

  _renderResponseStructure(category, subIntents) {
    let hint = null;

    if (subIntents && subIntents.emotional_distress) {
      hint = `**STRUTTURA RISPOSTA RACCOMANDATA (SITUAZIONE EMOTIVA):**
1. Riconosci il disagio ("Comprendiamo il suo disappunto...")
2. Rispondi con empatia, non difensivamente
3. Offri soluzione concreta
4. Invita al dialogo`;
    } else if (subIntents && subIntents.bereavement) {
      hint = `**STRUTTURA RISPOSTA RACCOMANDATA (LUTTO):**
1. Esprimi vicinanza sincera
2. Fornisci informazioni pratiche con discrezione
3. Offri disponibilità umana`;
    } else if (category === 'sacrament') {
      hint = `**STRUTTURA RISPOSTA RACCOMANDATA (SACRAMENTO):**
1. Accogli con calore la richiesta
2. Fornisci requisiti / documenti necessari
3. Indica date / modi per procedere
4. Offri disponibilità per chiarimenti`;
    } else if (category === 'complaint') {
      hint = `**STRUTTURA RISPOSTA RACCOMANDATA (RECLAMO):**
1. NON minimizzare il problema
2. Riconosci il disagio
3. Spiega / offri soluzione
4. Mantieni tono professionale ma empatico`;
    } else if (category === 'quotation') {
      hint = `**STRUTTURA RISPOSTA RACCOMANDATA (PREVENTIVO/OFFERTA):**
1. Ringrazia per l'invio del preventivo/offerta
2. Conferma la ricezione e che prenderete visione
3. Comunica che esaminerete e rispondrete
4. Chiudi in modo cortese

⚠️ IMPORTANTE: NON usare frasi come:
- "Restiamo a disposizione per chiarimenti" (siamo noi che abbiamo ricevuto)
- "Contattateci per domande" (sono loro che ci hanno scritto)

✅ USA invece:
- "Vi ricontatteremo dopo aver valutato"
- "Ci faremo sentire per una risposta"`;
    }

    return hint;
  }

  // ========================================================================
  // TEMPLATE 16: CRONOLOGIA CONVERSAZIONE
  // ========================================================================

  _renderConversationHistory(conversationHistory) {
    return `**CRONOLOGIA CONVERSAZIONE:**
Messaggi precedenti per contesto. Non ripetere info già fornite.
<conversation_history>
${conversationHistory}
</conversation_history>`;
  }

  // ========================================================================
  // TEMPLATE 17: CONTENUTO EMAIL
  // ========================================================================

  _renderEmailContent(emailContent, emailSubject, senderName, senderEmail, detectedLanguage) {
    return `**EMAIL DA RISPONDERE:**
Da: ${senderEmail} (${senderName})
Oggetto: ${emailSubject}
Lingua: ${detectedLanguage.toUpperCase()}

Contenuto:
<user_email>
${emailContent}
</user_email>`;
  }

  // ========================================================================
  // TEMPLATE 18: CONTENUTO ALLEGATI (OCR/PDF)
  // ========================================================================

  _renderAttachmentContext(attachmentsContext) {
    if (!attachmentsContext) return '';
    return `**ALLEGATI (TESTO OCR/PDF):**
${attachmentsContext}`;
  }

  // ========================================================================
  // TEMPLATE 19: REGOLE NO REPLY
  // ========================================================================

  _renderNoReplyRules() {
    return `**QUANDO NON RISPONDERE (scrivi solo "NO_REPLY"):**

1. Newsletter, pubblicità, email automatiche
2. Bollette, fatture, ricevute
3. Condoglianze, necrologi
4. Email con "no-reply"
5. Comunicazioni politiche

6. **Follow-up di SOLO ringraziamento** (tutte queste condizioni):
   ✓ Oggetto inizia con "Re:"
   ✓ Contiene SOLO: ringraziamenti, conferme
   ✓ NON contiene: domande, nuove richieste

⚠️ "NO_REPLY" significa che NON invierò risposta.`;
  }

  // ========================================================================
  // TEMPLATE 20: LINEE GUIDA TONO UMANO
  // ========================================================================

  _renderHumanToneGuidelines() {
    return `══════════════════════════════════════════════════════
🎬 LINEE GUIDA PER TONO UMANO E NATURALE
══════════════════════════════════════════════════════

1. **VOCE ISTITUZIONALE MA CALDA:**
   ✅ GIUSTO: "Siamo lieti di accompagnarvi", "Restiamo a disposizione"
   ❌ SBAGLIATO: "Sono disponibile", "Ti rispondo"
   → Usa SEMPRE prima persona plurale (noi/restiamo/siamo)

2. **ACCOGLIENZA SPONTANEA:**
   ✅ GIUSTO: "Siamo contenti di sapere che...", "Ci fa piacere che..."
   ❌ SBAGLIATO: Tono robotico o freddo

3. **CONCISIONE INTELLIGENTE:**
   ✅ GIUSTO: Info complete ma senza ripetizioni
   ❌ SBAGLIATO: Ripetere le stesse cose in modi diversi

4. **EMPATIA SITUAZIONALE:**

   Per SACRAMENTI:
   • "Siamo lieti di accompagnarvi in questo importante passo"
   
   Per URGENZE:
   • "Comprendiamo l'urgenza della sua richiesta"
   
   Per PROBLEMI:
   • "Comprendiamo il disagio e ce ne scusiamo"

5. **STRUTTURA RESPIRABILE:**
   • Paragrafi brevi (2-3 frasi max)
   • Spazi bianchi tra concetti diversi
   • Elenchi puntati per info multiple

6. **PERSONALIZZAZIONE:**
   • Se è una RISPOSTA (Re:), sii più diretto e conciso
   • Se è PRIMA INTERAZIONE, sii più completo
   • Se conosci il NOME, usalo nel saluto

══════════════════════════════════════════════════════`;
  }

  // ========================================================================
  // TEMPLATE 21: ESEMPI
  // ========================================================================

  _renderExamples(category) {
    if (!category || !['sacrament', 'information', 'appointment'].includes(category)) {
      return null;
    }

    return `══════════════════════════════════════════════════════
📚 ESEMPI CON FORMATTAZIONE CORRETTA
══════════════════════════════════════════════════════

**ESEMPIO 1 - CAMMINO DI SANTIAGO (con link corretti):**

✅ VERSIONE CORRETTA:
\`\`\`markdown
Buonasera, siamo lieti di fornirle le informazioni sul pellegrinaggio.

### 🚶 Cammino di Santiago 2026

**📆 Date:** 27 giugno - 4 luglio 2026 (8 giorni)
**📍 Percorso:** Tui (Portogallo) → Santiago (Spagna)

**🔗 Iscrizioni e Info:**
• Iscrizione online: https://tinyurl.com/santiago26
• Programma dettagliato: https://tinyurl.com/cammino26

Restiamo a disposizione per qualsiasi chiarimento.

Cordiali saluti,
Segreteria Parrocchia Sant'Eugenio
\`\`\`

❌ VERSIONE SBAGLIATA (DA EVITARE):
\`\`\`markdown
Buonasera, Siamo lieti di fornirle... ← ERRORE: maiuscola dopo virgola

• Iscrizione: [tinyurl.com/santiago26](https://tinyurl.com/santiago26) ← ERRORE: URL ripetuto
\`\`\`

══════════════════════════════════════════════════════

**QUANDO NON FORMATTARE:**

✅ ESEMPIO CORRETTO (senza formattazione):
"Buongiorno, la catechesi inizia domenica 21 settembre alle ore 10:00."

→ Info singola, breve, chiara = no formattazione necessaria.

══════════════════════════════════════════════════════`;
  }

  // ========================================================================
  // TEMPLATE 22: LINEE GUIDA RISPOSTA
  // ========================================================================

  _renderResponseGuidelines(lang, season, salutation, closing) {
    let formatSection, contentSection, languageReminder;

    if (lang === 'en') {
      formatSection = `1. **Response Format (ENGLISH REQUIRED):**
   ${salutation}
   [Concise and relevant body - ✅ USE FORMATTING IF APPROPRIATE]
   ${closing}
   Parish Secretariat of Sant'Eugenio`;
      contentSection = `2. **Content:**
   • Answer ONLY what is asked
   • Use ONLY information from the knowledge base
   • ✅ Format elegantly if 3+ elements/times
   • Follow-up (Re:): be more direct and concise`;
      languageReminder = `4. **LANGUAGE: ⚠️ RESPOND IN ENGLISH ONLY**
   • NO Italian words allowed
   • Use English for everything: greeting, body, closing`;
    } else if (lang === 'es') {
      formatSection = `1. **Formato de respuesta (ESPAÑOL REQUERIDO):**
   ${salutation}
   [Cuerpo conciso y pertinente - ✅ USA FORMATO SI ES APROPIADO]
   ${closing}
   Secretaría Parroquia Sant'Eugenio`;
      contentSection = `2. **Contenido:**
   • Responde SOLO lo que se pregunta
   • Usa SOLO información de la base de conocimientos
   • ✅ Formatea elegantemente si 3+ elementos/horarios
   • Seguimiento (Re:): sé más directo y conciso`;
      languageReminder = `4. **IDIOMA: ⚠️ RESPONDE SOLO EN ESPAÑOL**
   • NO se permiten palabras italianas
   • Usa español para todo: saludo, cuerpo, despedida`;
    } else {
      formatSection = `1. **Formato risposta:**
   ${salutation}
   [Corpo conciso e pertinente - ✅ USA FORMATTAZIONE SE APPROPRIATO]
   ${closing}
   Segreteria Parrocchia Sant'Eugenio`;
      contentSection = `2. **Contenuto:**
   • Rispondi SOLO a ciò che è chiesto
   • Usa SOLO info dalla knowledge base
   • ✅ Formatta elegantemente se 3+ elementi/orari
   • Follow-up (Re:): sii più diretto e conciso`;
      languageReminder = `4. **Lingua:** Rispondi in italiano`;
    }

    return `**LINEE GUIDA RISPOSTA:**

${formatSection}

${contentSection}

3. **Orari:** Mostra SOLO orari del periodo corrente (${season})

${languageReminder}`;
  }

  // ========================================================================
  // TEMPLATE 23: CASI SPECIALI
  // ========================================================================

  _renderSpecialCases() {
    return `**CASI SPECIALI:**

• **Cresima:** Se genitore → info Cresima ragazzi. Se adulto → info Cresima adulti.
• **Padrino/Madrina:** Se vuole fare da padrino/madrina, includi criteri idoneità.
• **Impegni lavorativi:** Se impossibilitato → offri programmi flessibili.
• **Filtro temporale:** "a giugno" → rispondi SOLO con info di giugno.

══════════════════════════════════════════════════════
⚠️ SITUAZIONI CANONICAMENTE COMPLESSE - RICHIESTA PRUDENZA
══════════════════════════════════════════════════════

Se l'email menziona uno di questi elementi:
• **Divorziato/a** o **separato/a** che vuole sposarsi
• **Risposato/a** civilmente
• **Convivente** che chiede matrimonio
• **Non cattolico** che vuole sposarsi in chiesa
• **Matrimonio precedente** non annullato

ALLORA:
1. ✅ Accogli con calore e senza giudizio
2. ✅ Invita a parlare DIRETTAMENTE con un sacerdote
3. ✅ Fornisci SOLO i contatti per fissare un appuntamento
4. ❌ NON fornire dettagli su procedure matrimoniali standard
5. ❌ NON dare per scontato che il matrimonio sia possibile

Esempio di risposta CORRETTA per persona divorziata:
"Comprendiamo la delicatezza della sua situazione. Per poter valutare insieme 
il suo caso specifico, le consigliamo di parlare direttamente con un sacerdote.
Può contattarci per fissare un appuntamento: Tel. 06 323 18 84.
Restiamo a disposizione."

══════════════════════════════════════════════════════`;
  }

  // ========================================================================
  // TEMPLATE 24: TEMPLATE SBATTEZZO
  // ========================================================================

  _renderSbattezzoTemplate(senderName) {
    // Sanitizzazione senderName per sicurezza
    const sanitizedName = (senderName || 'Utente')
      .replace(/[<>]/g, '')
      .substring(0, 50)
      .trim() || 'Utente';

    return `══════════════════════════════════════════════════════
🚨 TEMPLATE OBBLIGATORIO: RICHIESTA CANCELLAZIONE REGISTRI (SBATTEZZO) 🚨
══════════════════════════════════════════════════════

USA ESATTAMENTE QUESTA STRUTTURA E QUESTO TONO. NON AGGIUNGERE ALTRO.

Gentile ${sanitizedName},

con la presente confermiamo di aver ricevuto la Sua richiesta.

Come primo passo, questa parrocchia verificherà i propri registri per accertare se il Suo Battesimo sia stato celebrato presso questa sede.

* Se il Battesimo risulterà registrato in questa parrocchia, trasmetteremo prontamente la Sua richiesta all'Ordinario Diocesano, allegando il certificato di Battesimo. La Curia diocesana La contatterà per un colloquio personale, volto a chiarire le conseguenze canoniche della decisione espressa. Qualora la Sua volontà resti confermata, l'Ordinario emetterà un apposito Decreto e questa parrocchia provvederà all'annotazione sul registro di Battesimo.

* Se invece il Battesimo non risulterà nei registri di questa parrocchia, Le comunicheremo l'impossibilità di procedere oltre in questa sede e Le indicheremo la parrocchia alla quale rivolgersi.

Conclusa la verifica, sarà nostra cura informarLa dell'esito.

Ci preme ricordarle che la Chiesa non "cancella" il dato storico del sacramento (che resta un fatto avvenuto), ma annota formalmente la volontà di non appartenere più alla Chiesa cattolica.

Cordiali saluti,
Segreteria Parrocchia Sant'Eugenio

⚠️ REGOLE CRITICHE:
1. NON invitare a telefonare.
2. NON invitare a fissare un appuntamento in segreteria (sarà la Curia a farlo).
3. NON aggiungere commenti pastorali o teologici oltre a quanto scritto sopra.
4. Mantieni rigorosamente la terza persona o il "noi" istituzionale.
══════════════════════════════════════════════════════`;
  }

  // ========================================================================
  // METODI UTILITÀ
  // ========================================================================

  /**
   * Tronca KB semanticamente per paragrafi preservando il contesto
   * Invece di tagliare a metà frase, mantiene paragrafi completi fino al budget
   * @param {string} kbContent - Contenuto KB originale
   * @param {number} maxTokens - Token massimi per l'intero prompt
   * @returns {string} KB troncata
   */
  _truncateKbSemantically(kbContent, maxTokens) {
    // Budget: ~50% dei token max per KB (in caratteri, ~4 caratteri/token)
    // Se maxTokens non è definito, assume un valore sicuro di default (10000)
    const effectiveMaxTokens = maxTokens || 10000;
    const budgetChars = effectiveMaxTokens * 4 * 0.5;

    // Se già entro il budget, restituisci così com'è
    if (kbContent.length <= budgetChars) {
      return kbContent;
    }

    // Dividi in paragrafi
    const paragraphs = kbContent.split(/\n{2,}|(?=════{3,})|(?=────{3,})/);

    let result = [];
    let currentLength = 0;
    const truncationMarker = '\n\n... [SEZIONI OMESSE PER LIMITI LUNGHEZZA - INFO PRINCIPALI PRESERVATE] ...\n\n';
    const markerLength = truncationMarker.length;

    // Aggiungi paragrafi fino a ~80% del budget (lascia spazio per il marcatore)
    const targetLength = budgetChars * 0.8;

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (!trimmedPara) continue;

      // Verifica se aggiungere questo paragrafo supererebbe il budget
      if (currentLength + trimmedPara.length + markerLength > targetLength) {
        if (result.length > 0) {
          break;
        }
        // Se il primo paragrafo è troppo lungo, prendi una porzione
        result.push(trimmedPara.substring(0, Math.floor(targetLength * 0.7)));
        break;
      }

      result.push(trimmedPara);
      currentLength += trimmedPara.length + 2; // +2 per riunire con \n\n
    }

    // Costruisci KB troncata
    const truncatedContent = result.join('\n\n');

    // Log statistiche troncamento
    const originalParagraphs = paragraphs.filter(p => p.trim()).length;
    const keptParagraphs = result.length;
    console.log(`📦 KB troncata: ${keptParagraphs}/${originalParagraphs} paragrafi (${truncatedContent.length}/${kbContent.length} caratteri)`);

    return truncatedContent + truncationMarker;
  }
}

// Funzione factory per compatibilità
function createPromptEngine() {
  return new PromptEngine();
}

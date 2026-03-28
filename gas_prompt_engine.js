/**
 * PromptEngine.gs - Generazione prompt modulare
 * Sezioni template modulari (numero variabile per profilo/condizioni)
 * Supporta filtro dinamico basato su profilo
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

    this.logger.info('PromptEngine inizializzato', { templateSections: 'variabile' });
  }

  /**
   * Stima token (approx 4 char/token per l'italiano/inglese)
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Normalizza valori eterogenei in stringa sicura per il prompt.
   */
  _normalizePromptTextInput(value, fallback = '') {
    if (value == null) return fallback;
    if (typeof value === 'string') return value;

    try {
      const serialized = JSON.stringify(value);
      return typeof serialized === 'string' ? serialized : String(value);
    } catch (e) {
      return String(value);
    }
  }

  /**
   * Determina se un template deve essere incluso in base a profilo e concern
   */
  _shouldIncludeTemplate(templateName, promptProfile, activeConcerns = {}) {
    if (promptProfile === 'heavy') {
      return true;
    }

    if (promptProfile === 'lite') {
      if (this.LITE_SKIP_TEMPLATES.includes(templateName)) {
        return false;
      }
    }

    if (promptProfile === 'standard') {
      if (this.STANDARD_SKIP_TEMPLATES.includes(templateName)) {
        if (!activeConcerns.formatting_risk) {
          return false;
        }
      }
    }

    return true;
  }

  buildPrompt(options = {}) {
    const {
      emailContent,
      emailSubject,
      knowledgeBase,
      doctrineBase = '',
      doctrineStructured = null,
      aiCoreLite = '',
      aiCore = '',
      senderName = 'Utente',
      senderEmail = '',
      conversationHistory = '',
      category = null,
      topic = '',
      detectedLanguage = 'it',
      currentSeason = 'invernale',
      currentDate = null,
      salutation = 'Buongiorno.',
      closing = 'Cordiali saluti,',
      subIntents = {},
      memoryContext = {},
      promptProfile = 'heavy',
      activeConcerns = {},
      salutationMode = 'full',
      responseDelay = null,
      territoryContext = null,
      attachmentsContext = '',
      requestTypeObj = {}
    } = options;

    const safeCurrentDate = currentDate || (
      (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function')
        ? Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd')
        : new Date().toISOString().slice(0, 10)
    );

    const normalizedConcerns = Array.isArray(activeConcerns)
      ? activeConcerns.reduce((acc, concernKey) => {
        if (typeof concernKey === 'string' && concernKey) {
          acc[concernKey] = true;
        }
        return acc;
      }, {})
      : ((activeConcerns && typeof activeConcerns === 'object') ? activeConcerns : {});

    let sections = [];
    let skippedCount = 0;

    const MAX_SAFE_TOKENS = typeof CONFIG !== 'undefined' && CONFIG.MAX_SAFE_TOKENS ? CONFIG.MAX_SAFE_TOKENS : 35000;
    const kbCharsLimit = Math.round((MAX_SAFE_TOKENS * 0.5) * 4); // 50% budget approx
    let workingKnowledgeBase = this._normalizePromptTextInput(knowledgeBase, '');
    let kbWasTruncated = false;

    if (workingKnowledgeBase && workingKnowledgeBase.length > kbCharsLimit) {
      workingKnowledgeBase = this._truncateKbSemantically(workingKnowledgeBase, kbCharsLimit);
      kbWasTruncated = true;
    }

    let workingAttachmentsContext = this._normalizePromptTextInput(attachmentsContext, '');

    let usedTokens = 0;
    const addSection = (section, label, options = {}) => {
      if (!section) return;
      const sectionTokens = this.estimateTokens(section);
      if (!options.force && usedTokens + sectionTokens > MAX_SAFE_TOKENS) {
        skippedCount++;
        return;
      }
      sections.push(section);
      usedTokens += sectionTokens;
    };

    const addTemplate = (templateName, content, label) => {
      if (this._shouldIncludeTemplate(templateName, promptProfile, normalizedConcerns)) {
        addSection(content, label || templateName);
      } else {
        skippedCount++;
      }
    };

    // BLOCCO 1: SETUP CRITICO
    addSection(this._renderSystemRole(), 'SystemRole', { force: true });
    addSection(this._renderLanguageInstruction(detectedLanguage), 'LanguageInstruction', { force: true });
    addSection(this._renderKnowledgeBase(workingKnowledgeBase), 'KnowledgeBase');

    if (territoryContext) {
      addSection(this._renderTerritoryVerification(territoryContext), 'TerritoryVerification');
    }

    // BLOCCO 2: CONTESTO
    addSection(this._renderMemoryContext(memoryContext), 'MemoryContext');
    addSection(this._renderConversationContinuity(salutationMode), 'ConversationContinuity');
    addSection(this._renderResponseDelay(responseDelay, detectedLanguage), 'ResponseDelay');

    if (conversationHistory) {
      addSection(this._renderConversationHistory(conversationHistory), 'ConversationHistory');
    }

    addSection(this._renderEmailContent(emailContent, emailSubject, senderName, senderEmail, detectedLanguage), 'EmailContent');
    addSection(this._renderAttachmentContext(workingAttachmentsContext), 'AttachmentsContext');

    // BLOCCO 3: LINEE GUIDA
    addTemplate('FormattingGuidelinesTemplate', this._renderFormattingGuidelines(), 'FormattingGuidelines');
    addSection(this._renderResponseStructure(category, subIntents), 'ResponseStructure');

    const normalizedTopic = String(topic || '').toLowerCase();
    const normalizedCategory = String(category || '').toLowerCase();

    // Ripristinato riferimento a requestTypeObj come richiesto
    const isFormalRequest = normalizedCategory === 'formal' || normalizedCategory === 'sbattezzo' || (typeof requestTypeObj !== 'undefined' && requestTypeObj.type === 'formal');

    if (normalizedTopic.includes('sbattezzo') || isFormalRequest) {
      addSection(this._renderSbattezzoTemplate(senderName), 'SbattezzoTemplate');
    }

    addTemplate('HumanToneGuidelinesTemplate', this._renderHumanToneGuidelines(), 'HumanToneGuidelines');
    addTemplate('ExamplesTemplate', this._renderExamples(category), 'Examples');
    addSection(this._renderResponseGuidelines(detectedLanguage, currentSeason, salutation, closing), 'ResponseGuidelines');

    // BLOCCO 4: RINFORZO
    addSection(this._renderCriticalErrorsReminder(), 'CriticalErrorsReminder');
    addSection(this._renderContextualChecklist(detectedLanguage, territoryContext, salutationMode), 'ContextualChecklist');
    addSection('**Genera la risposta completa seguendo le linee guida sopra:**', 'FinalInstruction', { force: true });

    const prompt = sections.join('\n\n');
    return prompt;
  }

  _renderCriticalErrorsReminder() {
    return `
🚨 REMINDER ERRORI CRITICI (verifica finale):
❌ Maiuscola dopo virgola: "Ciao, Siamo" → SBAGLIATO
✅ Minuscola dopo virgola: "Ciao, siamo" → GIUSTO
❌ Link ridondante: [url](url) → SBAGLIATO 
✅ Link pulito: Iscrizione: https://url → GIUSTO
❌ Nome minuscolo: "federica" → SBAGLIATO
✅ Nome maiuscolo: "Federica" → GIUSTO
`;
  }

  _renderContextualChecklist(detectedLanguage, territoryContext, salutationMode) {
    const checks = ['□ Ho risposto SOLO alla domanda posta', '□ Ho usato SOLO informazioni dalla KB'];
    if (detectedLanguage === 'it') {
      checks.push('□ Minuscola dopo virgola');
      checks.push('□ Nomi propri MAIUSCOLI');
    }
    return `
✅ CHECKLIST FINALE CONTESTUALE
${checks.join('\n')}
`;
  }

  _renderSystemRole() {
    return `Sei la segreteria della Parrocchia di Sant'Eugenio a Roma.
• Mantieni un tono istituzionale ma umano.
• Usa SEMPRE la forma di cortesia (Lei).
• RISPONDI SOLO A QUANTO CHIESTO.`;
  }

  _renderLanguageInstruction(lang) {
    return `Rispondi in ${lang === 'en' ? 'Inglese' : 'Italiano'}.`;
  }

  _renderKnowledgeBase(knowledgeBase) {
    return `<knowledge_base>\n${knowledgeBase}\n</knowledge_base>`;
  }

  _renderTerritoryVerification(territoryContext) {
    return `**VERIFICA TERRITORIO:**\n${territoryContext}`;
  }

  _renderMemoryContext(memoryContext) {
    if (!memoryContext || Object.keys(memoryContext).length === 0) return null;
    return `🧠 CONTESTO MEMORIA:\n${JSON.stringify(memoryContext)}`;
  }

  _renderConversationContinuity(salutationMode) {
    if (salutationMode === 'full') return null;
    return `📍 MODALITÀ SALUTO: ${salutationMode}`;
  }

  _renderResponseDelay(responseDelay, lang) {
    if (!responseDelay || !responseDelay.shouldApologize) return null;
    return `⌛ Scusati per il ritardo.`;
  }

  _renderConversationHistory(history) {
    return `<conversation_history>\n${history}\n</conversation_history>`;
  }

  _renderEmailContent(content, subject, name, email, lang) {
    return `**EMAIL DA RISPONDERE:**\nDa: ${name}\nOggetto: ${subject}\n\n${content}`;
  }

  _renderAttachmentContext(context) {
    if (!context) return '';
    return `**ALLEGATI:**\n${context}`;
  }

  _renderFormattingGuidelines() {
    return `✨ LINEE GUIDA FORMATTAZIONE:\n- Usa elenchi puntati\n- Usa icone (📍, 🗓️, ✉️)`;
  }

  _renderResponseStructure(category, subIntents) {
    return `**STRUTTURA RISPOSTA:**\n1. Accoglienza\n2. Corpo\n3. Saluti`;
  }

  _renderSbattezzoTemplate(name) {
    return `Gentile ${name},\ncon la presente confermiamo la ricezione della sua richiesta di sbattezzo...`;
  }

  _renderHumanToneGuidelines() {
    return `🎬 TONO UMANO: Evita risposte robotiche, sii caloroso.`;
  }

  _renderExamples(category) {
    return `**ESEMPIO:**\nBuongiorno, ecco le info richieste...`;
  }

  _renderResponseGuidelines(lang, season, salutation, closing) {
    return `**ISTRUZIONI FINALI:**\nSaluto: ${salutation}\nChiusura: ${closing}`;
  }

  _truncateKbSemantically(kb, limit) {
    return kb.length > limit ? kb.substring(0, limit) + '...' : kb;
  }
}

function createPromptEngine() {
  return new PromptEngine();
}
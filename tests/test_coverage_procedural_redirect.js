const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    passedTests++;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function setupContext(options = {}) {
  const cacheMap = new Map();
  const logs = [];
  const warns = [];
  const errors = [];
  const context = vm.createContext({
    console: {
      log(...args) { logs.push(args.join(' ')); },
      warn(...args) { warns.push(args.join(' ')); },
      error(...args) { errors.push(args.join(' ')); }
    },
    UrlFetchApp: {},
    CONFIG: {
      SEMANTIC_VALIDATION: {
        enabled: true,
        completenessAlways: true,
        completenessMode: 'enforce',
        ...options
      }
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => cacheMap.get(key),
        put: (key, val) => cacheMap.set(key, val)
      })
    }
  });

  const files = [
    'gas_response_strategy.js',
    'gas_response_validator.js',
    'gas_email_processor.js',
    'gas_gemini_service.js'
  ];
  for (const file of files) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInContext(code, context, { filename: path.join(root, file) });
  }

  return {
    c: context,
    validator: new context.ResponseValidator(),
    semanticValidator: new context.SemanticValidator(),
    logs,
    warns,
    errors
  };
}

const kbProiezione = `
Proiezione film "Madonna di Guadalupe" - 22 Novembre ore 21:00 presso il Teatro Parrocchiale.
Non è possibile effettuare prenotazioni via email o telefonicamente.
Le iscrizioni e prenotazioni dei posti sono gestite esclusivamente online tramite il portale:
https://parrocchia.it/eventi/guadalupe-prenotazioni
`;

console.log('--- Esecuzione Matrice dei 5 Test Pre-Deploy: Reindirizzamento procedurale e copertura ---');

// CASO 1: Reindirizzamento conforme alla KB
test('Caso 1: Reindirizzamento conforme alla KB con link e procedura autorizzata', () => {
  const { semanticValidator, validator } = setupContext();
  const requestItem = {
    id: 'req_prenotazione_1',
    need: 'prenotare posto per la proiezione del 22/11',
    evidence: 'Vorrei prenotare un posto per il film del 22 novembre',
    role: 'primary'
  };
  const responseText = `Buonasera,

per la proiezione del film sulla Madonna di Guadalupe del 22 novembre non è possibile prenotare via email. Può riservare il suo posto direttamente tramite il modulo online dedicato: https://parrocchia.it/eventi/guadalupe-prenotazioni

Cordiali saluti,
Segreteria Parrocchia Sant'Eugenio`;
  
  const mockPayload = {
    contentValid: true,
    isValid: true,
    confidence: 0.95,
    reason: "La risposta applica correttamente la procedura della KB reindirizzando l'utente al modulo online.",
    hallucinations: { unsupportedClaims: [] },
    irrelevantDetails: [],
    presence: { state: 'compatible', reason: 'Nessuno spostamento proposto', requestEvidence: '', responseEvidence: '' },
    coverage: {
      evaluated: true,
      purpose: 'operational',
      goal: 'prenotare posto proiezione',
      requests: [{
        id: 'req_prenotazione_1',
        need: requestItem.need,
        evidence: requestItem.evidence,
        status: 'addressed',
        procedureStatus: 'supported',
        reason: 'Indica la procedura corretta e il link autorizzato per la prenotazione.',
        sourceRef: 'https://parrocchia.it/eventi/guadalupe-prenotazioni'
      }],
      additionalRequests: [],
      unsupportedExtractedRequests: [],
      noOpenRequests: false,
      noOpenRequestsReason: '',
      undeterminableReason: null
    }
  };

  const coverageContext = semanticValidator._prepareCoverageContext_('Vorrei prenotare un posto per il film del 22 novembre', {
    requestCoverage: { goal: 'prenotare', openRequests: [requestItem] }
  });

  const parsed = semanticValidator._parseSemanticResponse(JSON.stringify(mockPayload), {
    coverageRequired: true,
    presenceRequired: true,
    coverageContext,
    knowledgeBase: kbProiezione,
    responseText
  });

  assert.equal(parsed.contentValid, true, 'contentValid deve essere true');
  assert.equal(parsed.coverageState, 'complete', 'coverageState deve essere complete');
  assert.equal(parsed.isValid, true, 'isValid complessivo deve essere true');
  assert.ok(Array.isArray(parsed.coverage.itemsDiag), 'itemsDiag deve essere presente');
  assert.equal(parsed.coverage.itemsDiag[0].procedureAuthorized, true, 'procedureAuthorized deve essere true');

  // Verifica integrazione in ResponseValidator
  validator.semanticValidator.validateHallucinations = () => parsed;
  validator.semanticValidator.validateThinkingLeak = () => ({ isValid: true, skipped: true });

  const validationResult = validator.validate(responseText, {
    knowledgeBase: kbProiezione,
    emailContent: 'Vorrei prenotare un posto per il film del 22 novembre',
    emailSubject: 'Prenotazione film 22/11',
    salutationMode: 'full',
    temporalContext: {
      currentTime: '20:00',
      validationContext: {
        requestCoverage: { goal: 'prenotare', openRequests: [requestItem] }
      }
    }
  });

  if (!validationResult.isValid) {
    console.error('DEBUG Caso 1:', {
      isValid: validationResult.isValid,
      score: validationResult.score,
      reasonCode: validationResult.reasonCode,
      pendingSemanticReview: validationResult.pendingSemanticReview,
      errors: validationResult.errors
    });
  }
  assert.equal(validationResult.isValid, true, 'ValidationResult deve essere valido');
  assert.equal(validationResult.errors.length, 0, 'Non devono esserci errori di validazione');
});

// CASO 2: Reindirizzamento errato o non autorizzato dalla KB
test('Caso 2: Reindirizzamento errato con procedura o canali inventati (allucinazione)', () => {
  const { semanticValidator, validator } = setupContext();
  const requestItem = {
    id: 'req_prenotazione_2',
    need: 'prenotare posto per la proiezione',
    evidence: 'Vorrei prenotare',
    role: 'primary'
  };
  const responseText = `Buonasera,

per prenotare, invii un bonifico di 15 euro con causale Guadalupe e contatti il numero 333-9999999.

Cordiali saluti,
Segreteria Parrocchia Sant'Eugenio`;

  const mockPayload = {
    contentValid: false,
    isValid: false,
    confidence: 0.95,
    reason: 'La risposta propone canali e procedure non previsti dalla KB (bonifico e telefono non censiti).',
    hallucinations: {
      unsupportedClaims: [{
        text: 'inviare bonifico e contattare 333-9999999',
        reason: 'Procedura e contatti inesistenti nella KB'
      }]
    },
    irrelevantDetails: [],
    presence: { state: 'compatible', reason: 'Nessuno spostamento proposto', requestEvidence: '', responseEvidence: '' },
    coverage: {
      evaluated: true,
      purpose: 'operational',
      goal: 'prenotare',
      requests: [{
        id: 'req_prenotazione_2',
        need: requestItem.need,
        evidence: requestItem.evidence,
        status: 'addressed',
        procedureStatus: 'unsupported',
        reason: 'Ha risposto ma con informazioni non veritiere',
        sourceRef: ''
      }],
      additionalRequests: [],
      unsupportedExtractedRequests: [],
      noOpenRequests: false,
      noOpenRequestsReason: '',
      undeterminableReason: null
    }
  };

  const coverageContext = semanticValidator._prepareCoverageContext_('Vorrei prenotare', {
    requestCoverage: { goal: 'prenotare', openRequests: [requestItem] }
  });

  const parsed = semanticValidator._parseSemanticResponse(JSON.stringify(mockPayload), {
    coverageRequired: true,
    presenceRequired: true,
    coverageContext,
    knowledgeBase: kbProiezione
  });

  assert.equal(parsed.contentValid, false, 'contentValid deve essere false per allucinazione');
  assert.equal(parsed.isValid, false, 'isValid deve essere false');

  validator.semanticValidator.validateHallucinations = () => parsed;
  validator.semanticValidator.validateThinkingLeak = () => ({ isValid: true, skipped: true });

  const validationResult = validator.validate(responseText, {
    knowledgeBase: kbProiezione,
    emailContent: 'Vorrei prenotare',
    emailSubject: 'Prenotazione',
    salutationMode: 'full',
    temporalContext: {
      currentTime: '20:00',
      validationContext: {
        requestCoverage: { goal: 'prenotare', openRequests: [requestItem] }
      }
    }
  });

  assert.equal(validationResult.isValid, false, 'ValidationResult deve essere respinto');
  assert.ok(validationResult.errors.some(e => e.includes('Affermazioni non supportate') || e.includes('Affermazioni senza riscontro') || e.includes('Contenuto')), 'Deve segnalare affermazioni non supportate');
});

// Una parafrasi non verificabile mantiene distinto il contenuto dall'incertezza sulla fonte.
test('Caso 3: Procedura corretta ma sourceRef parafrasato richiede revisione senza allucinazioni fittizie', () => {
  const { semanticValidator, validator } = setupContext();
  const requestItem = {
    id: 'req_prenotazione_3',
    need: 'prenotazione proiezione 22/11',
    evidence: 'Vorrei prenotare',
    role: 'primary'
  };
  const responseText = `Buonasera,

le prenotazioni per la proiezione si effettuano online al link: https://parrocchia.it/eventi/guadalupe-prenotazioni

Cordiali saluti,
Segreteria Parrocchia Sant'Eugenio`;

  // Il modello estrae sourceRef con parole sue diverse dal testo esatto
  const mockPayload = {
    contentValid: true,
    isValid: true,
    confidence: 0.92,
    reason: 'Risposta corretta che rispetta la procedura.',
    hallucinations: { unsupportedClaims: [] },
    irrelevantDetails: [],
    presence: { state: 'compatible', reason: 'Nessuno spostamento proposto', requestEvidence: '', responseEvidence: '' },
    coverage: {
      evaluated: true,
      purpose: 'operational',
      goal: 'prenotare',
      requests: [{
        id: 'req_prenotazione_3',
        need: requestItem.need,
        evidence: requestItem.evidence,
        status: 'addressed',
        procedureStatus: 'supported',
        reason: 'Ha fornito il canale online',
        sourceRef: 'modulo iscrizioni telematico evento cinematografico parrocchiale' // parafrasi non testuale
      }],
      additionalRequests: [],
      unsupportedExtractedRequests: [],
      noOpenRequests: false,
      noOpenRequestsReason: '',
      undeterminableReason: null
    }
  };

  const coverageContext = semanticValidator._prepareCoverageContext_('Vorrei prenotare', {
    requestCoverage: { goal: 'prenotare', openRequests: [requestItem] }
  });

  const parsed = semanticValidator._parseSemanticResponse(JSON.stringify(mockPayload), {
    coverageRequired: true,
    presenceRequired: true,
    coverageContext,
    knowledgeBase: kbProiezione
  });

  // La parafrasi non intacca contentValid, ma non certifica la citazione.
  assert.equal(parsed.contentValid, true, 'contentValid deve rimanere true');
  assert.equal(parsed.coverageState, 'undeterminable');
  assert.equal(parsed.isValid, false);
  assert.equal(parsed.coverage.itemsDiag[0].procedureAuthorized, null);

  validator.semanticValidator.validateHallucinations = () => parsed;
  validator.semanticValidator.validateThinkingLeak = () => ({ isValid: true, skipped: true });

  const validationResult = validator.validate(responseText, {
    knowledgeBase: kbProiezione,
    emailContent: 'Vorrei prenotare',
    emailSubject: 'Prenotazione',
    salutationMode: 'full',
    temporalContext: {
      currentTime: '20:00',
      validationContext: {
        requestCoverage: { goal: 'prenotare', openRequests: [requestItem] }
      }
    }
  });

  assert.equal(validationResult.isValid, false);
  assert.equal(validationResult.pendingSemanticReview, 'semantic_context_insufficient');
  assert.equal(validationResult.errors.length, 0, 'Una citazione incerta non diventa un fatto inventato');
});

// CASO 4: Richiesta multipla parzialmente evasa
test('Caso 4: Richiesta multipla parzialmente evasa (coverage missing ma contentValid=true, nessun elogio in error)', () => {
  const { semanticValidator, validator } = setupContext();
  const req1 = { id: 'r1', need: 'prenotazione posto', evidence: 'posso prenotare?', role: 'primary' };
  const req2 = { id: 'r2', need: 'orario di inizio', evidence: 'a che ora inizia?', role: 'primary' };
  const responseText = `Buonasera,

può prenotare online al link: https://parrocchia.it/eventi/guadalupe-prenotazioni

Cordiali saluti,
Segreteria Parrocchia Sant'Eugenio`;

  const mockPayload = {
    contentValid: true,
    isValid: false,
    confidence: 0.95,
    // Il modello erroneamente scrive una motivazione apparentemente positiva o focalizzata sulla parte evasa
    reason: "La risposta gestisce correttamente la richiesta di prenotazione applicando la regola della KB che vieta le iscrizioni via email.",
    hallucinations: { unsupportedClaims: [] },
    irrelevantDetails: [],
    presence: { state: 'compatible', reason: 'Nessuno spostamento proposto', requestEvidence: '', responseEvidence: '' },
    coverage: {
      evaluated: true,
      purpose: 'operational',
      goal: 'prenotazione e orario',
      requests: [
        { id: 'r1', need: req1.need, evidence: req1.evidence, status: 'addressed', procedureStatus: 'supported', reason: 'Fornito link modulo online', sourceRef: 'https://parrocchia.it/eventi/guadalupe-prenotazioni' },
        { id: 'r2', need: req2.need, evidence: req2.evidence, status: 'missing', procedureStatus: 'not_applicable', reason: 'Orario di inizio omesso nella risposta', sourceRef: '' }
      ],
      additionalRequests: [],
      unsupportedExtractedRequests: [],
      noOpenRequests: false,
      noOpenRequestsReason: '',
      undeterminableReason: null
    }
  };

  const coverageContext = semanticValidator._prepareCoverageContext_('posso prenotare? a che ora inizia?', {
    requestCoverage: { goal: 'prenotazione e orario', openRequests: [req1, req2] }
  });

  const parsed = semanticValidator._parseSemanticResponse(JSON.stringify(mockPayload), {
    coverageRequired: true,
    presenceRequired: true,
    coverageContext,
    knowledgeBase: kbProiezione
  });

  assert.equal(parsed.contentValid, true, 'contentValid deve essere true perché non ci sono allucinazioni');
  assert.equal(parsed.coverageState, 'missing', 'coverageState deve essere missing');
  assert.equal(parsed.isValid, false, 'isValid complessivo deve essere false');

  validator.semanticValidator.validateHallucinations = () => parsed;
  validator.semanticValidator.validateThinkingLeak = () => ({ isValid: true, skipped: true });

  const validationResult = validator.validate(responseText, {
    knowledgeBase: kbProiezione,
    emailContent: 'posso prenotare? a che ora inizia?',
    emailSubject: 'Info film',
    salutationMode: 'full',
    temporalContext: {
      currentTime: '20:00',
      validationContext: {
        requestCoverage: { goal: 'prenotazione e orario', openRequests: [req1, req2] }
      }
    }
  });

  assert.equal(validationResult.isValid, false, 'ValidationResult deve fallire per omissione');
  // Verifica cruciale: NESSUN messaggio di elogio positivo inserito in errors!
  for (const err of validationResult.errors) {
    assert.ok(!/gestisce corrett/i.test(err), `L'errore non deve contenere elogi positivi: "${err}"`);
  }
  assert.ok(validationResult.errors.some(e => e.includes('Copertura: esigenza essenziale non affrontata') || e.includes('Copertura incompleta')), 'Deve segnalare copertura incompleta');
});

// Un verdetto contraddittorio rimane da verificare anche quando le singole voci appaiono positive.
test('Caso 5: Modello restituisce isValid: false con copertura completa, il disaccordo richiede revisione', () => {
  const { semanticValidator, validator } = setupContext();
  const req1 = {
    id: 'r_prenota',
    need: 'prenotare posto proiezione',
    evidence: 'Vorrei prenotare un posto via email',
    role: 'primary'
  };
  const responseText = `Buonasera,

le prenotazioni per la proiezione del film sulla Madonna di Guadalupe non possono essere raccolte via email, ma si effettuano al seguente indirizzo: https://parrocchia.it/eventi/guadalupe-prenotazioni

Cordiali saluti,
Segreteria Parrocchia Sant'Eugenio`;

  // Simuliamo il caso esatto del log utente:
  // Il modello, applicando la vecchia idea che negare la prenotazione email sia missing, aveva messo isValid: false
  // ma nella compilazione di coverage la richiesta è soddisfatta tramite indirizzamento autorizzato (addressed).
  const mockPayload = {
    contentValid: true,
    isValid: false, // Disaccordo nativo del modello
    confidence: 0.94,
    reason: "La risposta gestisce correttamente la richiesta di prenotazione applicando la regola della KB che vieta le iscrizioni via email e indirizzando l'utente al link corretto.",
    hallucinations: { unsupportedClaims: [] },
    irrelevantDetails: [],
    presence: { state: 'compatible', reason: 'Nessuno spostamento proposto', requestEvidence: '', responseEvidence: '' },
    coverage: {
      evaluated: true,
      purpose: 'operational',
      goal: 'prenotare',
      requests: [{
        id: 'r_prenota',
        need: req1.need,
        evidence: req1.evidence,
        status: 'addressed',
        procedureStatus: 'supported',
        reason: 'Indirizza correttamente al modulo ufficiale online.',
        sourceRef: 'https://parrocchia.it/eventi/guadalupe-prenotazioni'
      }],
      additionalRequests: [],
      unsupportedExtractedRequests: [],
      noOpenRequests: false,
      noOpenRequestsReason: '',
      undeterminableReason: null
    }
  };

  const coverageContext = semanticValidator._prepareCoverageContext_('Vorrei prenotare un posto via email', {
    requestCoverage: { goal: 'prenotare', openRequests: [req1] }
  });

  const parsed = semanticValidator._parseSemanticResponse(JSON.stringify(mockPayload), {
    coverageRequired: true,
    presenceRequired: true,
    coverageContext,
    knowledgeBase: kbProiezione
  });

  assert.equal(parsed.contentValid, true, 'contentValid deve essere true');
  assert.equal(parsed.coverageState, 'contract_error');
  assert.equal(parsed.isValid, false, 'Il codice non promuove un verdetto negativo');
  assert.match(parsed.coverageError, /Verdetto negativo/);

  validator.semanticValidator.validateHallucinations = () => parsed;
  validator.semanticValidator.validateThinkingLeak = () => ({ isValid: true, skipped: true });

  const validationResult = validator.validate(responseText, {
    knowledgeBase: kbProiezione,
    emailContent: 'Vorrei prenotare un posto via email',
    emailSubject: 'Prenotazione',
    salutationMode: 'full',
    temporalContext: {
      currentTime: '20:00',
      validationContext: {
        requestCoverage: { goal: 'prenotare', openRequests: [req1] }
      }
    }
  });

  assert.equal(validationResult.isValid, false);
  assert.equal(validationResult.pendingSemanticReview, 'semantic_contract_error');
  assert.equal(validationResult.errors.length, 0, 'Nessun errore di validazione generato');
});

console.log(`\nRisultato: tutti i ${passedTests}/5 casi di test della matrice sono passati con successo!`);

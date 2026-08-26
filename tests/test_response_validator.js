const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.CONFIG = {
  VALIDATION_MIN_SCORE: 0.6,
  SEMANTIC_VALIDATION: { enabled: false }
};

global.LANGUAGE_MARKERS = {
  it: ['grazie', 'cordiali', 'saluti', 'gentile', 'parrocchia']
};

const gasValidatorPath = path.join(__dirname, '..', 'gas_response_validator.js');
const code = fs.readFileSync(gasValidatorPath, 'utf8');
vm.runInThisContext(code, { filename: gasValidatorPath });

const validator = new ResponseValidator();

console.log('--- Test ResponseValidator: VALIDATION_MIN_SCORE=0 resta valido ---');
{
  const originalMinScore = CONFIG.VALIDATION_MIN_SCORE;
  CONFIG.VALIDATION_MIN_SCORE = 0;
  try {
    const zeroThresholdValidator = new ResponseValidator();
    assert(zeroThresholdValidator.MIN_VALID_SCORE === 0, 'la soglia esplicita 0 non deve ricadere sul default 0.6');
  } finally {
    CONFIG.VALIDATION_MIN_SCORE = originalMinScore;
  }
}

console.log('--- Test _extractExplicitDates_: separatori numerici coerenti ---');
{
  const mixedDates = validator._extractExplicitDates_('Appuntamento 01/02-2026', new Date(2026, 0, 1));
  const strictDates = validator._extractExplicitDates_('Appuntamento 01/02/2026', new Date(2026, 0, 1));
  assert(mixedDates.length === 0, 'date con separatori misti non devono essere accettate');
  assert(
    strictDates.length === 1 &&
      strictDates[0].date.getFullYear() === 2026 &&
      strictDates[0].date.getMonth() === 1 &&
      strictDates[0].date.getDate() === 1,
    'date numeriche con separatore coerente devono restare valide'
  );
}

console.log('--- Test _checkForbiddenContent (placeholder) ---');
const placeholderResult = validator._checkForbiddenContent('Gentile utente, XXX Cordiali saluti.');
assert(placeholderResult.score === 0.0, 'placeholder deve portare score a 0');
assert(
  placeholderResult.errors.some((e) => e.includes('Contiene placeholder')),
  'deve segnalare errore placeholder'
);

console.log('--- Test _checkForbiddenContent (frase incertezza) ---');
const uncertainResult = validator._checkForbiddenContent('Non sono sicuro di poter confermare.');
assert(uncertainResult.score === 1.0, 'frase prudente non deve ridurre score');
assert(
  uncertainResult.warnings.some((w) => w.includes('Tono prudente rilevato')),
  'deve segnalare warning prudenziale'
);

console.log('--- Test _checkForbiddenContent (todo minuscolo non placeholder) ---');
const spanishTodoResult = validator._checkForbiddenContent('Gracias por todo, le responderemos pronto.');
assert(
  !spanishTodoResult.errors.some((e) => e.includes('Contiene placeholder')),
  '"todo" minuscolo non deve essere rilevato come placeholder TODO'
);

console.log('--- Test _checkForbiddenContent (ellissi non placeholder) ---');
const ellipsisResult = validator._checkForbiddenContent('La risposta puo continuare... la ricontattiamo appena possibile.');
assert(
  !ellipsisResult.errors.some((e) => e.includes('Contiene placeholder')),
  'i puntini di sospensione nel testo naturale non devono essere trattati come placeholder'
);
const bracketEllipsisResult = validator._checkForbiddenContent('Gentile [...], la aspettiamo alle ore 10:00.');
assert(
  bracketEllipsisResult.errors.some((e) => e.includes('Contiene placeholder')),
  'il placeholder [...] deve restare bloccante'
);

console.log('--- Test _checkForbiddenContent (nessun placeholder quadro) ---');
const noBracketPlaceholderResult = validator._checkForbiddenContent(
  'Gentile signora, le confermo che la Santa Messa festiva è celebrata ogni domenica alle ore 10:00.'
);
assert(
  !noBracketPlaceholderResult.errors.some((e) => e.includes('Contiene placeholder')),
  'una risposta senza placeholder tra quadre non deve generare TypeError né errore placeholder'
);

console.log('--- Test _checkForbiddenContent (parentesi quadre testuali non placeholder) ---');
const textualBracketResult = validator._checkForbiddenContent(
  'Le invio il riferimento alla nota [PARROCCHIA] riportata nel documento.'
);
assert(
  !textualBracketResult.errors.some((e) => e.includes('Contiene placeholder')),
  'un riferimento testuale maiuscolo tra quadre non deve essere bloccato come placeholder'
);

console.log('--- Test _checkForbiddenContent (parentesi quadre placeholder esplicito) ---');
const explicitBracketPlaceholderResult = validator._checkForbiddenContent(
  'Gentile [NOME], la aspettiamo alle ore 10:00.'
);
assert(
  explicitBracketPlaceholderResult.errors.some((e) => e.includes('Contiene placeholder')),
  'un campo esplicito tra quadre deve restare bloccante'
);

console.log('--- Test _ottimizzaSalutoTemporale (saluto reale) ---');
{
  const originalUtilities = global.Utilities;
  global.Utilities = {
    formatDate: () => '20'
  };
  try {
    const saluto = validator._ottimizzaSalutoTemporale(
      'Buongiorno, le confermo gli orari della parrocchia.',
      'it'
    );
    assert(saluto.startsWith('Buonasera,'), 'il saluto mattutino deve diventare serale senza accedere a gruppi inesistenti');
  } finally {
    global.Utilities = originalUtilities;
  }
}

console.log('--- Test _ottimizzaSalutoTemporale: currentTime runtime prevale sul clock ---');
{
  const originalUtilities = global.Utilities;
  global.Utilities = {
    formatDate: () => '20'
  };
  try {
    const saluto = validator._ottimizzaSalutoTemporale(
      'Buonasera, le confermo gli orari della parrocchia.',
      'it',
      { temporal: { currentTime: '09:30' } }
    );
    assert(
      saluto.startsWith('Buongiorno,'),
      'il saluto deve usare temporal.currentTime quando fornito, non il clock corrente'
    );
  } finally {
    global.Utilities = originalUtilities;
  }
}

console.log('--- Test _getCurrentHourInRome_ (fallback se Utilities non numerica) ---');
{
  const originalUtilities = global.Utilities;
  const originalDateTimeFormat = global.Intl.DateTimeFormat;
  let seenTimeZone = '';
  global.Utilities = {
    formatDate: () => 'ora-non-valida'
  };
  global.Intl.DateTimeFormat = function (_locale, options) {
    seenTimeZone = options && options.timeZone;
    return {
      formatToParts: () => [{ type: 'hour', value: '22' }]
    };
  };
  try {
    const hour = validator._getCurrentHourInRome_();
    assert(hour === 22, `fallback ora deve usare Intl timezone-aware, ottenuto ${hour}`);
    assert(seenTimeZone === 'Europe/Rome', 'fallback Intl deve usare Europe/Rome');
  } finally {
    global.Utilities = originalUtilities;
    global.Intl.DateTimeFormat = originalDateTimeFormat;
  }
}

console.log('--- Test _resolveTemporalCurrentDate_: messageDate non diventa currentDate ---');
{
  const originalUtilities = global.Utilities;
  global.Utilities = {
    formatDate: () => '2026-05-15'
  };
  try {
    const resolved = validator._resolveTemporalCurrentDate_({ messageDate: '2026-05-07' });
    assert(
      validator._formatDateOnly_(resolved) === '2026-05-15',
      `currentDate deve usare oggi/fallback, non messageDate: ${validator._formatDateOnly_(resolved)}`
    );
  } finally {
    global.Utilities = originalUtilities;
  }
}

console.log('--- Test _resolveTemporalCurrentDate_: fallback Intl resta timezone-aware su Roma ---');
{
  const originalUtilities = global.Utilities;
  const originalDateTimeFormat = global.Intl.DateTimeFormat;
  let seenTimeZone = null;
  global.Utilities = {
    formatDate: () => { throw new Error('timezone unavailable'); }
  };
  global.Intl.DateTimeFormat = function(_locale, options) {
    seenTimeZone = options && options.timeZone;
    return {
      formatToParts: () => [
        { type: 'year', value: '2026' },
        { type: 'literal', value: '-' },
        { type: 'month', value: '06' },
        { type: 'literal', value: '-' },
        { type: 'day', value: '08' }
      ]
    };
  };
  try {
    const resolved = validator._resolveTemporalCurrentDate_(null);
    assert(
      validator._formatDateOnly_(resolved) === '2026-06-08',
      `fallback currentDate deve usare Intl Europe/Rome, ottenuto ${validator._formatDateOnly_(resolved)}`
    );
    assert(seenTimeZone === 'Europe/Rome', 'fallback Intl della data corrente deve usare Europe/Rome');
  } finally {
    global.Utilities = originalUtilities;
    global.Intl.DateTimeFormat = originalDateTimeFormat;
  }
}

console.log('--- Test _checkLanguage conserva testo dopo gmail_quote chiuso ---');
{
  const result = validator._checkLanguage(
    'Intro <div class="gmail_quote">thank regards dear</div> Gentile parrocchia, grazie e cordiali saluti.',
    'it'
  );
  assert(result.markerScores.it >= 4, 'il testo successivo a gmail_quote non deve essere troncato');
}

console.log('--- Test _checkLanguage blocca segmenti in una lingua diversa ---');
{
  const localValidator = new ResponseValidator();
  localValidator.languageMarkers = {
    it: ['grazie', 'cordiali', 'saluti', 'gentile', 'parrocchia'],
    en: ['thank', 'regards', 'dear', 'parish', 'mass', 'church', 'would', 'could']
  };

  const mixedResult = localValidator._checkLanguage(
    'Gentile, thank you for your email to the parish. Kind regards.',
    'it'
  );
  assert(
    mixedResult.errors.some((e) => e.includes('Lingua mista')),
    'un segmento inglese dentro una risposta italiana deve essere bloccante'
  );
  assert(mixedResult.score < 0.30, `la lingua mista forte deve degradare nettamente lo score, ottenuto ${mixedResult.score}`);

  const englishResult = localValidator._checkLanguage(
    'Dear parish, thank you for your email. Could you confirm the mass schedule? Kind regards.',
    'it'
  );
  assert(
    englishResult.errors.some((e) => e.includes('Lingua non corrispondente')),
    'una risposta interamente EN a target IT deve restare bloccante'
  );
}

console.log('--- Test _checkLanguage: intercetta formula italiana dentro risposta francese ---');
{
  const localValidator = new ResponseValidator();
  localValidator.languageMarkers = {
    it: ['grazie', 'cordiali', 'saluti', 'gentile', 'parrocchia', 'messa'],
    fr: ['merci', 'cordialement', 'paroisse', 'messe', 'bonjour', 'bonsoir']
  };
  const result = localValidator._checkLanguage(
    [
      'Bonsoir,',
      'La messe est célébrée à 19h00. Vous pouvez vous adresser à la sacristie avant la célébration.',
      'Qualora le fosse possibile passare da Roma, saremo lieti di incontrarla anche di persona.',
      'Cordialement.'
    ].join('\n'),
    'fr'
  );

  assert(
    result.errors.some((error) => error.includes('Lingua mista') && error.includes('IT')),
    'la frase italiana deve essere intercettata anche se la lingua prevalente è correttamente francese'
  );
  assert(result.foreignSegments.some((item) => item.language === 'it'), 'il segmento italiano deve restare osservabile nei dettagli');
}

console.log('--- Test _checkLanguage: blocchi italiani rilevati anche per lingua target non preconfigurata ---');
{
  const localValidator = new ResponseValidator();
  const result = localValidator._checkLanguage(
    'Uw verzoek is ontvangen.\nQualora le fosse possibile passare da Roma, saremo lieti di incontrarla anche di persona.',
    'nl'
  );
  assert(
    result.errors.some((error) => error.includes('Lingua mista') && error.includes('IT')),
    'un blocco standard italiano deve essere bloccato anche quando la lingua target non è nella mappa principale'
  );
}

console.log('--- Test _checkLanguage: marker accentati con confini non ASCII ---');
{
  const localValidator = new ResponseValidator();
  localValidator.languageMarkers = {
    it: ['parrocchia'],
    pt: ['par\u00f3quia'],
    de: ['gr\u00fc\u00dfe']
  };

  const portugueseResult = localValidator._checkLanguage(
    'Ol\u00e1, a par\u00f3quia confirma o recebimento.',
    'it'
  );
  assert(portugueseResult.markerScores.pt === 1, 'marker portoghese accentato deve essere rilevato');

  const germanResult = localValidator._checkLanguage(
    'Vielen Dank, gr\u00fc\u00dfe an die Gemeinde.',
    'it'
  );
  assert(germanResult.markerScores.de === 1, 'marker tedesco accentato deve essere rilevato');
}

console.log('--- Test _ottimizzaCapitalAfterComma (maiuscole, nomi propri e apostrofi) ---');
{
  const fixedCaps = validator._ottimizzaCapitalAfterComma(
    "La aspettiamo, Il gruppo si riunisce in aula, La Sapienza resta un nome proprio, E' possibile confermare.",
    'it'
  );
  assert(fixedCaps.includes(', il gruppo'), 'deve correggere una parola funzionale maiuscola dopo virgola');
  assert(fixedCaps.includes(', La Sapienza'), 'non deve corrompere nomi propri o sintagmi con seconda maiuscola');
  assert(fixedCaps.includes(", E' possibile"), 'non deve corrompere forme con apostrofo');
}

console.log('--- Test _perfezionamentoAutomatico (hardening helper cosmetici) ---');
{
  const hardenedValidator = new ResponseValidator();
  hardenedValidator._ottimizzaCapitalAfterComma = () => { throw new Error('boom caps'); };
  hardenedValidator._ottimizzaSalutoTemporale = (text) => text.replace('Buongiorno', 'Buonasera');
  const result = hardenedValidator._perfezionamentoAutomatico(
    'Buongiorno, le confermo gli orari della parrocchia.',
    [],
    'it'
  );
  assert(result.fixed === true, 'un helper cosmetico fallito non deve bloccare quelli successivi');
  assert(result.text.startsWith('Buonasera,'), 'il perfezionamento successivo deve continuare dopo un errore locale');
}

console.log('--- Test _checkExposedReasoning (thinking leak critico) ---');
const reasoningResult = validator._checkExposedReasoning(
  'Rivedendo la knowledge base, la invito a contattare la segreteria.'
);
assert(reasoningResult.score === 0.0, 'thinking leak critico deve portare score a 0');
assert(
  reasoningResult.errors.some((e) => e.includes('RAGIONAMENTO ESPOSTO CRITICO')),
  'deve segnalare ragionamento esposto critico'
);

const memoryLeakResult = validator._checkExposedReasoning(
  "Secondo l'analisi interna, la memoria indica di rispondere solo alla domanda residua."
);
assert(memoryLeakResult.score === 0.0, 'leak su memoria/analisi interna deve portare score a 0');

const previousMemoryLeakResult = validator._checkExposedReasoning(
  'Uso la memoria precedente solo se pertinente.'
);
assert(previousMemoryLeakResult.score === 0.0, 'leak sulla memoria precedente deve essere bloccante');

const internalMarkerLeakResult = validator._checkExposedReasoning(
  '## CORNICE DECISIONALE OPERATIVA\n- Segnali attivi: concern:longitudinal_sensitivity, responseMode:pastoral_longitudinal\n- Routing moduli: aiCoreLite=true'
);
assert(internalMarkerLeakResult.score === 0.0, 'leak di marker interni della cornice decisionale deve essere bloccante');
assert(
  internalMarkerLeakResult.errors.some((e) => e.includes('RAGIONAMENTO ESPOSTO CRITICO')),
  'deve segnalare come critico il leak di responseMode/concern e sezioni interne'
);

console.log('--- Test validateResponse: estrae solo blocco <email> e ignora <analisi> ---');
{
  const xmlResult = validator.validateResponse(
    '<analisi>Rivedendo la knowledge base, questo testo non deve essere validato.</analisi><email>Gentile utente, la ringraziamo per averci scritto. Cordiali saluti.</email>',
    'it',
    'La parrocchia risponde alle richieste degli utenti.',
    'Vorrei informazioni.',
    'Richiesta informazioni',
    'full',
    false
  );

  assert(xmlResult.isValid === true, 'il blocco <analisi> non deve causare thinking leak se <email> è presente');
  assert(
    xmlResult.metadata.responseLength === 'Gentile utente, la ringraziamo per averci scritto. Cordiali saluti.'.length,
    'la risposta validata deve essere solo il contenuto del tag <email>'
  );
}

console.log('--- Test validateResponse: fallback rimuove blocco <analisi> senza <email> ---');
{
  const fallbackResult = validator.validateResponse(
    '<analisi>Rivedendo la knowledge base, questo testo va rimosso.</analisi>Gentile utente, la ringraziamo per averci scritto. Cordiali saluti.',
    'it',
    'La parrocchia risponde alle richieste degli utenti.',
    'Vorrei informazioni.',
    'Richiesta informazioni',
    'full',
    false
  );

  assert(fallbackResult.isValid === true, 'il fallback deve rimuovere <analisi> prima dei controlli anti reasoning leak');
}

console.log('--- Test _checkSignature (none_or_continuity) ---');
const signatureResult = validator._checkSignature('Messaggio follow-up senza firma', 'none_or_continuity');
assert(signatureResult.score === 1.0, 'in none_or_continuity la firma non deve penalizzare');
assert(signatureResult.warnings.length === 0, 'in none_or_continuity non deve esserci warning firma');

console.log('--- Test _checkSignature (session) ---');
const sessionSignatureResult = validator._checkSignature('Messaggio follow-up rapido senza firma', 'session');
assert(sessionSignatureResult.score === 1.0, 'in session la firma non deve penalizzare');
assert(sessionSignatureResult.warnings.length === 0, 'in session non deve esserci warning firma');

console.log('--- Test hallucination: civico non deve essere interpretato come orario ---');
const civicResult = validator._checkHallucinations(
  'Per la verifica territoriale risulta Via Roma civico 12.30.',
  'Copertura territoriale: Via Roma civico 12.30',
  'Abito in Via Roma civico 12.30'
);
assert(civicResult.score === 1.0, 'civico 12.30 non deve generare warning orari inventati');
assert(
  !civicResult.warnings.some((w) => w.includes('Orari non in KB')),
  'non deve segnalare orari inventati nel caso civico'
);

console.log('--- Test hallucination: email con sottodominio non viene troncata ---');
{
  const emailResult = validator._checkHallucinations(
    'Può scrivere a segreteria@mail.example.org.',
    'Contatto autorizzato: segreteria@mail.example.com.',
    ''
  );
  assert(
    emailResult.errors.some((error) => error.includes('segreteria@mail.example.org')),
    'TLD diversi su un sottodominio devono restare indirizzi distinti e quello inventato va bloccato'
  );
}

console.log('--- Test hallucination: numero civico non deve autorizzare orario inventato ---');
const streetNumberResult = validator._checkHallucinations(
  'La messa e alle 10:00.',
  'Orari disponibili: 09:00 e 11:00.',
  'Abito in Via Roma 10, vorrei informazioni.'
);
assert(
  streetNumberResult.errors.some((e) => e.includes('Orari non in KB: 10:00')),
  'numero civico 10 non deve sdoganare 10:00 come orario presente nel messaggio originale'
);
assert(
  Array.isArray(streetNumberResult.hallucinations.times) &&
  streetNumberResult.hallucinations.times.includes('10:00'),
  '10:00 deve essere registrato tra gli orari inventati'
);

console.log('--- Test hallucination: currentTime runtime viene bloccato come orario tecnico, non come orario inventato ---');
const currentTimeTechnicalLeakResult = validator._checkHallucinations(
  'Sono le 10:00. La segreteria le risponderà appena possibile.',
  'Orari disponibili: 09:00 e 11:00.',
  'Vorrei sapere gli orari delle messe.',
  { temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' } }
);
assert(
  currentTimeTechnicalLeakResult.errors.some((e) => e.includes('Orari tecnici da non citare: 10:00')),
  'currentTime runtime citato nella risposta deve essere bloccato come leak tecnico'
);
assert(
  !currentTimeTechnicalLeakResult.errors.some((e) => e.includes('Orari non in KB: 10:00')),
  'currentTime runtime non deve essere duplicato come orario inventato generico'
);
assert(
  Array.isArray(currentTimeTechnicalLeakResult.hallucinations.technicalTimes) &&
    currentTimeTechnicalLeakResult.hallucinations.technicalTimes.includes('10:00'),
  'currentTime runtime deve essere registrato tra gli orari tecnici vietati'
);

console.log('--- Test hallucination: messageTime runtime viene bloccato come orario tecnico ---');
const messageTimeTechnicalLeakResult = validator._checkHallucinations(
  'Abbiamo ricevuto la sua email alle 10:45 e le rispondiamo ora.',
  'Orari disponibili: 09:00 e 11:00.',
  'Vorrei informazioni sul percorso per adulti.',
  { temporal: { currentDate: '2026-06-08', currentTime: '15:30', messageDate: '2026-06-08', messageTime: '10:45' } }
);
assert(
  messageTimeTechnicalLeakResult.errors.some((e) => e.includes('Orari tecnici da non citare: 10:45')),
  'messageTime runtime citato nella risposta deve essere bloccato come leak tecnico'
);
assert(
  !messageTimeTechnicalLeakResult.errors.some((e) => e.includes('Orari non in KB: 10:45')),
  'messageTime runtime non deve finire nel bucket generico Orari non in KB'
);

console.log('--- Test hallucination: orario uguale al runtime resta valido se presente in KB ---');
const runtimeTimeAlsoInKbResult = validator._checkHallucinations(
  'Il corso inizia alle 10:45.',
  'Corso adulti: sabato alle 10:45.',
  'Vorrei informazioni sul corso.',
  { temporal: { currentDate: '2026-06-08', currentTime: '10:45', messageDate: '2026-06-08', messageTime: '08:15' } }
);
assert(
  runtimeTimeAlsoInKbResult.score === 1.0,
  'un orario uguale al runtime non deve essere bloccato se e presente in KB'
);

console.log('--- Test validateResponse: orario inventato è bloccante ---');
const inventedTimeValidation = validator.validateResponse(
  'Gentile utente, la Santa Messa è alle 10:00. Cordiali saluti.',
  'it',
  'Orari disponibili: 09:00 e 11:00.',
  'Vorrei sapere gli orari delle messe.',
  'Richiesta orari',
  'full',
  false
);
assert(inventedTimeValidation.isValid === false, 'un orario non presente in KB o nel messaggio originale deve bloccare la risposta');
assert(
  inventedTimeValidation.errors.some((e) => e.includes('Orari non in KB: 10:00')),
  'la validazione deve esporre l orario inventato come errore'
);

console.log('--- Test hallucination: data esplicita inventata è bloccante ---');
{
  const inventedDateResult = validator._checkHallucinations(
    'La celebrazione è prevista il 24 maggio 2026.',
    'Cresima adulti: la data va concordata con la segreteria.',
    'Vorrei informazioni sulla Cresima.',
    { temporal: { currentDate: '2026-05-15', messageDate: '2026-05-15', timeZone: 'Europe/Rome' } }
  );
  assert(
    inventedDateResult.errors.some((e) => e.includes('Date non in KB o nel messaggio originale: 2026-05-24')),
    'una data esplicita non presente nelle fonti deve essere segnalata'
  );
  assert(
    Array.isArray(inventedDateResult.hallucinations.dates) &&
      inventedDateResult.hallucinations.dates.includes('2026-05-24'),
    'la data inventata deve essere registrata tra le hallucination'
  );
}

console.log('--- Test hallucination: data esplicita in KB è ammessa ---');
{
  const kbDateResult = validator._checkHallucinations(
    'La celebrazione è prevista il 24 maggio 2026.',
    'Cresima adulti: celebrazione il 24 maggio 2026.',
    'Vorrei informazioni sulla Cresima.',
    { temporal: { currentDate: '2026-05-15', messageDate: '2026-05-15', timeZone: 'Europe/Rome' } }
  );
  assert(
    !kbDateResult.hallucinations.dates || kbDateResult.hallucinations.dates.length === 0,
    'una data presente in KB non deve essere trattata come inventata'
  );
}

console.log('--- Test hallucination: data derivata da relativo utente è ammessa ---');
{
  const derivedDateResult = validator._checkHallucinations(
    'Può passare l\'8 maggio 2026.',
    'Segreteria: apertura su appuntamento.',
    'Domani posso passare?',
    {
      temporal: {
        currentDate: '2026-05-15',
        messageDate: '2026-05-07',
        processingEpochMs: new Date('2026-05-15T08:00:00Z').getTime(),
        messageEpochMs: new Date('2026-05-07T08:00:00Z').getTime(),
        timeZone: 'Europe/Rome'
      }
    }
  );
  assert(
    !derivedDateResult.hallucinations.dates || derivedDateResult.hallucinations.dates.length === 0,
    'una data esplicitata dalla risposta ma derivata da domani dell utente deve essere ammessa'
  );
}

console.log('--- Test hallucination: data ricorrente senza anno in KB autorizza anno esplicitato ---');
{
  const recurringDateResult = validator._checkHallucinations(
    'Il 15 agosto 2026 si seguono gli orari festivi.',
    'Il 15 agosto, solennità dell Assunzione, si seguono gli orari festivi.',
    'Quali sono gli orari per l Assunzione?',
    { temporal: { currentDate: '2026-09-01', messageDate: '2026-08-30', timeZone: 'Europe/Rome' } }
  );
  assert(
    !recurringDateResult.hallucinations.dates || recurringDateResult.hallucinations.dates.length === 0,
    'una data annuale senza anno in KB deve autorizzare la stessa ricorrenza con anno esplicitato'
  );
}

console.log('--- Test hallucination: date numeriche senza anno in KB autorizzano anno esplicitato ---');
{
  const numericRecurringDateResult = validator._checkHallucinations(
    'Il primo turno del corso prematrimoniale si terrà il 17 ottobre 2026, il 24 ottobre 2026, il 7 novembre 2026, il 14 novembre 2026 e il 21 novembre 2026.',
    'Corso prematrimoniale primo turno: 17/10, 24/10, 07/11, 14/11, 21/11.',
    'Potremmo avere informazioni sul primo turno 2026/2027?',
    { temporal: { currentDate: '2026-06-18', messageDate: '2026-06-18', timeZone: 'Europe/Rome' } }
  );
  assert(
    !numericRecurringDateResult.hallucinations.dates || numericRecurringDateResult.hallucinations.dates.length === 0,
    'date numeriche senza anno presenti in KB devono autorizzare la stessa data con anno esplicitato nella risposta'
  );
}

console.log('--- Test hallucination: cellulare italiano compatto inventato è bloccante ---');
const inventedMobileResult = validator._checkHallucinations(
  'Può contattarci al 3331234567.',
  'Contatti disponibili: 06 12345678.',
  'Vorrei informazioni sugli orari.'
);
assert(
  inventedMobileResult.errors.some((e) => e.includes('Numeri telefono non in KB: 3331234567')),
  'un cellulare italiano compatto non presente in KB deve essere segnalato'
);
assert(
  Array.isArray(inventedMobileResult.hallucinations.phones) &&
  inventedMobileResult.hallucinations.phones.includes('3331234567'),
  'il cellulare inventato deve essere registrato tra le hallucination telefoniche'
);

console.log('--- Test hallucination: ora solo numerica in KB deve validare 10:00 ---');
const hourOnlyKbResult = validator._checkHallucinations(
  'La messa è alle 10:00.',
  'Orari messe festive: domenica alle ore 10.',
  'Vorrei sapere gli orari della domenica.'
);
assert(hourOnlyKbResult.score === 1.0, 'una KB con "ore 10" deve autorizzare una risposta con 10:00');
assert(
  !hourOnlyKbResult.warnings.some((w) => w.includes('Orari non in KB')),
  'non deve segnalare orari inventati se la KB contiene un\'ora contestuale equivalente'
);
assert(
  !hourOnlyKbResult.hallucinations.times || hourOnlyKbResult.hallucinations.times.length === 0,
  'non deve registrare 10:00 tra gli orari allucinati quando la KB contiene "ore 10"'
);

console.log('--- Test hallucination: ore 24 in KB autorizza 24:00 ---');
const midnightHourKbResult = validator._checkHallucinations(
  'La Messa della notte di Natale è alle 24:00.',
  'Natale: la Messa della notte è celebrata alle ore 24.',
  'Vorrei sapere l orario della Messa di Natale.'
);
assert(midnightHourKbResult.score === 1.0, 'una KB con "ore 24" deve autorizzare una risposta con 24:00');
assert(
  !midnightHourKbResult.hallucinations.times || midnightHourKbResult.hallucinations.times.length === 0,
  '24:00 non deve essere registrato tra gli orari allucinati quando la KB contiene "ore 24"'
);

console.log('--- Test hallucination: versetti biblici paolini/cattolici non sono orari inventati ---');
const bibleVerseResult = validator._checkHallucinations(
  'Per il gruppo biblico leggeremo Rm 9,20, 1Cor 13.4, Ef 2,10 e 2Pt 1,10.',
  '',
  ''
);
assert(
  !bibleVerseResult.warnings.some((w) => w.includes('Orari non in KB')),
  'versetti Rm/1Cor/Ef/2Pt non devono generare warning orari inventati'
);
assert(
  !bibleVerseResult.hallucinations.times || bibleVerseResult.hallucinations.times.length === 0,
  'i versetti biblici non devono essere registrati tra gli orari allucinati'
);

console.log('--- Test riferimenti papali: Papa Francesco in presente dopo 2025 è bloccante ---');
const stalePopeResult = validator._checkCurrentPopeReferences(
  'Papa Francesco ci invita costantemente a contrastare la cultura dello scarto.',
  'Caritas: raccolta indumenti per persone senza fissa dimora.',
  '',
  { currentDate: '2026-05-29' }
);
assert(stalePopeResult.score === 0.0, 'Papa Francesco in presente dopo il cambio di pontificato deve essere bloccante');
assert(
  stalePopeResult.errors.some((e) => e.includes('Riferimento papale non aggiornato') && e.includes('Leone XIV')),
  'l errore deve indicare il riferimento papale non aggiornato e il Papa attuale'
);

console.log('--- Test riferimenti papali: Papa regnante da KB prevale sul default ---');
const kbCurrentPopeResult = validator._checkCurrentPopeReferences(
  'Papa Leone XIV ci invita a pregare.',
  'Informazioni di contesto | Papa regnante | Pio XIII',
  '',
  { currentDate: '2026-05-29' }
);
assert(kbCurrentPopeResult.score === 0.0, 'un Papa non regnante secondo la KB non deve passare come voce presente');
assert(
  kbCurrentPopeResult.errors.some((e) => e.includes('Leone XIV') && e.includes('Pio XIII')),
  'l errore deve usare il Papa regnante indicato dalla KB'
);

const kbCurrentPopeAllowed = validator._checkCurrentPopeReferences(
  'Papa Pio XIII ci invita a pregare.',
  'Informazioni di contesto | Papa regnante | Pio XIII',
  '',
  { currentDate: '2026-05-29' }
);
assert(kbCurrentPopeAllowed.score === 1.0, 'il Papa regnante indicato dalla KB deve essere ammesso come riferimento presente');

console.log('--- Test riferimenti papali: runtimeContext prevale sulla KB downstream ---');
{
  const runtimePapalResult = validator._checkCurrentPopeReferences(
    'Papa Leone XIV ci invita a pregare.',
    'Informazioni di contesto | Papa regnante | Leone XIV',
    '',
    {
      temporal: { currentDate: '2026-05-29' },
      papal: {
        currentName: 'Papa Pio XIII',
        previousName: 'Papa Francesco',
        currentSince: '2026-01-01'
      }
    }
  );
  assert(runtimePapalResult.score === 0.0, 'il validator deve fidarsi del runtimeContext papal prima della KB ricontrollata downstream');
  assert(runtimePapalResult.currentPope === 'Papa Pio XIII', 'il Papa corrente validato deve venire dal runtimeContext');
  assert(
    runtimePapalResult.errors.some((e) => e.includes('Leone XIV') && e.includes('Papa Pio XIII')),
    'l errore deve mostrare la precedenza del runtimeContext'
  );
}

console.log('--- Test riferimenti papali: citazione storica di Papa Francesco resta ammessa ---');
const historicalPopeResult = validator._checkCurrentPopeReferences(
  'Il Giubileo straordinario della Misericordia fu indetto da papa Francesco.',
  'Il Giubileo straordinario della Misericordia fu indetto da papa Francesco.',
  '',
  { currentDate: '2026-05-29' }
);
assert(historicalPopeResult.score === 1.0, 'una citazione storica al passato deve restare valida');

console.log('--- Test riferimenti papali: warning usa previousName dinamico da CONFIG ---');
{
  const originalConfig = global.CONFIG;
  global.CONFIG = Object.assign({}, originalConfig, {
    PAPAL_CONTEXT: {
      currentName: 'Papa Pio XIII',
      previousName: 'Papa Benedetto XVI',
      currentSince: '2025-01-01'
    }
  });

  try {
    const dynamicPreviousNeutral = validator._checkCurrentPopeReferences(
      'Il testo cita Papa Benedetto XVI senza fonte esplicita.',
      'Caritas: raccolta indumenti per persone senza fissa dimora.',
      '',
      { currentDate: '2026-05-29' }
    );
    assert(dynamicPreviousNeutral.score === 1.0, 'una citazione neutra del Papa precedente dinamico senza fonte non deve produrre warning');
    assert(dynamicPreviousNeutral.warnings.length === 0, 'una citazione neutra del Papa precedente non deve essere rumorosa');

    const dynamicPreviousResult = validator._checkCurrentPopeReferences(
      'Papa Benedetto XVI, in questa risposta, ricorda la cura dei poveri.',
      'Caritas: raccolta indumenti per persone senza fissa dimora.',
      '',
      { currentDate: '2026-05-29' }
    );
    assert(dynamicPreviousResult.score < 1.0, 'una citazione al presente del Papa precedente dinamico senza fonte deve produrre warning');
    assert(
      dynamicPreviousResult.warnings.some((w) => w.includes('Papa Benedetto XVI')),
      'il warning deve usare il previousName configurato, non un nome hardcoded'
    );

    const dynamicPreviousAllowed = validator._checkCurrentPopeReferences(
      'Il testo cita Papa Benedetto XVI senza fonte esplicita.',
      'Fonte storica: Papa Benedetto XVI.',
      '',
      { currentDate: '2026-05-29' }
    );
    assert(dynamicPreviousAllowed.score === 1.0, 'la citazione del previousName configurato presente nelle fonti deve essere ammessa');
  } finally {
    global.CONFIG = originalConfig;
  }
}

console.log('--- Test riferimenti papali: previousName accentato usa confini Unicode ---');
{
  const originalConfig = global.CONFIG;
  global.CONFIG = Object.assign({}, originalConfig, {
    PAPAL_CONTEXT: {
      currentName: 'Papa Pio XIII',
      previousName: 'Papa André',
      currentSince: '2025-01-01'
    }
  });

  try {
    const accentedPreviousResult = validator._checkCurrentPopeReferences(
      'Papa André, oggi, ricorda la cura dei poveri.',
      'Caritas: raccolta indumenti per persone senza fissa dimora.',
      '',
      { currentDate: '2026-05-29' }
    );
    assert(accentedPreviousResult.score < 1.0, 'un previousName con finale accentata deve essere riconosciuto senza \\b ASCII');
  } finally {
    global.CONFIG = originalConfig;
  }
}

console.log('--- Test riferimenti papali: underscore non crea falso nome papale ---');
{
  const underscoredCurrent = validator._checkCurrentPopeReferences(
    'Leone_XIV è Papa nel testo tecnico ricevuto.',
    'Informazioni di contesto | Papa regnante | Leone XIV',
    '',
    { currentDate: '2026-05-29' }
  );
  assert(underscoredCurrent.score === 1.0, 'sequenze con underscore non devono essere catturate come nomi papali naturali');
}

console.log('--- Test temporal consistency: data futura non può essere presentata come passata ---');
const temporalPastFutureResult = validator._checkTemporalConsistency(
  'La celebrazione della Cresima si è tenuta il 24 maggio 2026 alle ore 17:30.',
  'it',
  { currentDate: '2026-05-15' }
);
assert(temporalPastFutureResult.score === 0.0, 'una data futura qualificata come passata deve bloccare la risposta');
assert(
  temporalPastFutureResult.errors.some((e) => e.includes('Incoerenza temporale')),
  'deve segnalare incoerenza temporale'
);
assert(
  temporalPastFutureResult.checkedDates > 0,
  'il ramo con violazioni deve restituire checkedDates valorizzato'
);
assert(temporalPastFutureResult.skipped === false, 'il ramo con violazioni deve dichiarare skipped=false');

console.log('--- Test temporal consistency: data futura programmata passa ---');
const temporalFutureOkResult = validator._checkTemporalConsistency(
  'La celebrazione della Cresima è in programma il 24 maggio 2026 alle ore 17:30.',
  'it',
  { currentDate: '2026-05-15' }
);
assert(temporalFutureOkResult.score === 1.0, 'una data futura presentata come programmata deve passare');
assert(temporalFutureOkResult.skipped === false, 'il ramo sano deve dichiarare skipped=false');

console.log('--- Test temporal consistency: conclusione futura non è scambiata per passato ---');
const temporalFutureConclusionResult = validator._checkTemporalConsistency(
  'Il corso si conclude il 23 maggio 2026.',
  'it',
  { currentDate: '2026-05-15' }
);
assert(temporalFutureConclusionResult.score === 1.0, 'una conclusione futura espressa al presente non deve essere bloccata');

console.log('--- Test temporal references: relativi utente ancorati a messageDate ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-05-15',
      currentTime: '10:00',
      messageDate: '2026-05-07',
      processingEpochMs: new Date('2026-05-15T08:00:00Z').getTime(),
      messageEpochMs: new Date('2026-05-07T08:00:00Z').getTime()
    }
  };
  const refs = validator._extractTemporalReferences_('Domani posso passare?', runtimeContext, 'user');
  const tomorrowRef = refs.find(ref => /domani/i.test(ref.text));
  assert(tomorrowRef && validator._formatDateOnly_(tomorrowRef.normalizedDate) === '2026-05-08', 'domani nel testo utente deve ancorarsi a messageDate');
  assert(tomorrowRef.anchorRole === 'messageDate', 'il riferimento utente deve dichiarare anchorRole=messageDate');
}

console.log('--- Test temporal references: email scritta lunedì interpreta domani come martedì ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-07',
      currentTime: '14:00',
      messageDate: '2026-06-01',
      processingEpochMs: new Date('2026-06-07T12:00:00Z').getTime(),
      messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
      timeZone: 'Europe/Rome'
    }
  };
  const refs = validator._extractTemporalReferences_('Ci vediamo domani.', runtimeContext, 'user');
  const tomorrowRef = refs.find(ref => /domani/i.test(ref.text));
  assert(
    tomorrowRef &&
      tomorrowRef.anchorRole === 'messageDate' &&
      validator._formatDateOnly_(tomorrowRef.normalizedDate) === '2026-06-02',
    'domani scritto lunedì 2026-06-01 deve risolversi a martedì 2026-06-02'
  );
}

console.log('--- Test temporal references: relativi ancorati agli epoch del runtimeContext ---');
{
  const runtimeContext = {
    temporal: {
      currentTime: '10:00',
      processingEpochMs: new Date('2026-05-15T08:00:00Z').getTime(),
      messageEpochMs: new Date('2026-05-07T08:00:00Z').getTime(),
      timeZone: 'Europe/Rome'
    }
  };
  const userRefs = validator._extractTemporalReferences_('Domani posso passare?', runtimeContext, 'user');
  const responseRefs = validator._extractTemporalReferences_('Domani può passare.', runtimeContext, 'response');
  const userTomorrow = userRefs.find(ref => /domani/i.test(ref.text));
  const responseTomorrow = responseRefs.find(ref => /domani/i.test(ref.text));
  assert(
    userTomorrow && validator._formatDateOnly_(userTomorrow.normalizedDate) === '2026-05-08',
    'domani utente deve derivare da messageEpochMs anche senza messageDate'
  );
  assert(
    responseTomorrow && validator._formatDateOnly_(responseTomorrow.normalizedDate) === '2026-05-16',
    'domani risposta deve derivare da processingEpochMs anche senza currentDate'
  );
}

console.log('--- Test temporal references: weekday prossimo usa anchor per ruolo ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-07',
      currentTime: '14:00',
      messageDate: '2026-06-01',
      processingEpochMs: new Date('2026-06-07T12:00:00Z').getTime(),
      messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
      timeZone: 'Europe/Rome'
    }
  };
  const userRefs = validator._extractTemporalReferences_('Ci vediamo sabato prossimo.', runtimeContext, 'user');
  const responseRefs = validator._extractTemporalReferences_('Ci vediamo sabato prossimo.', runtimeContext, 'response');
  const userSaturday = userRefs.find(ref => ref.type === 'weekday_relative');
  const responseSaturday = responseRefs.find(ref => ref.type === 'weekday_relative');
  assert(
    userSaturday && validator._formatDateOnly_(userSaturday.normalizedDate) === '2026-06-06',
    'sabato prossimo nel testo utente deve usare messageDate come anchor'
  );
  assert(
    responseSaturday && validator._formatDateOnly_(responseSaturday.normalizedDate) === '2026-06-13',
    'sabato prossimo nella risposta deve usare currentDate come anchor'
  );
}

console.log('--- Test temporal references: weekday relativo supporta ordine aggettivo/nome ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-01',
      messageDate: '2026-06-01',
      timeZone: 'Europe/Rome'
    }
  };
  const nextPrefix = validator._extractTemporalReferences_('Prossimo sabato posso passare.', runtimeContext, 'response')
    .find(ref => ref.type === 'weekday_relative');
  const nextMonday = validator._extractTemporalReferences_('Lunedì prossimo posso passare.', runtimeContext, 'response')
    .find(ref => ref.type === 'weekday_relative');
  assert(
    nextPrefix && validator._formatDateOnly_(nextPrefix.normalizedDate) === '2026-06-06',
    'prossimo sabato deve essere riconosciuto come sabato prossimo futuro'
  );
  assert(
    nextMonday && validator._formatDateOnly_(nextMonday.normalizedDate) === '2026-06-08',
    'lunedì prossimo con anchor lunedì deve riferirsi al lunedì successivo'
  );
}

console.log('--- Test temporal references: weekday scorso supporta entrambi gli ordini ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-07',
      messageDate: '2026-06-07',
      timeZone: 'Europe/Rome'
    }
  };
  const suffix = validator._extractTemporalReferences_('Lunedì scorso abbiamo inviato il documento.', runtimeContext, 'response')
    .find(ref => ref.type === 'weekday_relative');
  const prefix = validator._extractTemporalReferences_('Scorso lunedì abbiamo inviato il documento.', runtimeContext, 'response')
    .find(ref => ref.type === 'weekday_relative');
  assert(
    suffix && prefix &&
      validator._formatDateOnly_(suffix.normalizedDate) === '2026-06-01' &&
      validator._formatDateOnly_(prefix.normalizedDate) === '2026-06-01',
    'lunedì scorso e scorso lunedì devono risolversi alla stessa data passata'
  );
}

console.log('--- Test temporal references: overlap privilegia match composto più lungo ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-01',
      messageDate: '2026-06-01',
      timeZone: 'Europe/Rome'
    }
  };
  const refs = validator._extractTemporalReferences_('Il sabato della prossima settimana ci sarà il corso.', runtimeContext, 'response');
  assert(refs.length === 1, 'il match composto deve scartare il sotto-match prossima settimana');
  assert(refs[0].type === 'weekday_relative', 'il match composto deve restare un weekday relativo');
  assert(
    validator._formatDateOnly_(refs[0].normalizedDate) === '2026-06-13',
    'sabato della prossima settimana deve risolversi al sabato della settimana successiva'
  );
}

console.log('--- Test temporal references: intervallo settimana non diventa data puntuale ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-01',
      messageDate: '2026-06-01',
      timeZone: 'Europe/Rome'
    }
  };
  const refs = validator._extractTemporalReferences_('La prossima settimana ci sentiamo.', runtimeContext, 'response');
  const variantRefs = validator._extractTemporalReferences_('La settimana prossima ci sentiamo.', runtimeContext, 'response');
  const currentRefs = validator._extractTemporalReferences_('Questa settimana ci sentiamo.', runtimeContext, 'response');
  const weekRef = refs.find(ref => ref.type === 'relative_interval');
  const variantWeekRef = variantRefs.find(ref => ref.type === 'relative_interval');
  const currentWeekRef = currentRefs.find(ref => ref.type === 'relative_interval');
  assert(weekRef && !weekRef.normalizedDate, 'la prossima settimana deve produrre un intervallo, non una data puntuale');
  assert(
    validator._formatDateOnly_(weekRef.normalizedRange.start) === '2026-06-08' &&
      validator._formatDateOnly_(weekRef.normalizedRange.end) === '2026-06-14',
    'la prossima settimana deve coprire lunedì-domenica della settimana seguente'
  );
  assert(
    variantWeekRef &&
      validator._formatDateOnly_(variantWeekRef.normalizedRange.start) === '2026-06-08' &&
      validator._formatDateOnly_(variantWeekRef.normalizedRange.end) === '2026-06-14',
    'la settimana prossima deve essere equivalente alla prossima settimana'
  );
  assert(
    currentWeekRef &&
      validator._formatDateOnly_(currentWeekRef.normalizedRange.start) === '2026-06-01' &&
      validator._formatDateOnly_(currentWeekRef.normalizedRange.end) === '2026-06-07',
    'questa settimana deve essere riconosciuta come intervallo corrente'
  );
}

console.log('--- Test temporal references: offset con numero a lettere usa anchor assoluto ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-07',
      currentTime: '14:00',
      messageDate: '2026-06-01',
      processingEpochMs: new Date('2026-06-07T12:00:00Z').getTime(),
      messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
      timeZone: 'Europe/Rome'
    }
  };
  const userRefs = validator._extractTemporalReferences_('Passo fra due settimane.', runtimeContext, 'user');
  const offsetRef = userRefs.find(ref => ref.type === 'relative_offset');
  assert(offsetRef && offsetRef.meta.amount === 2 && offsetRef.meta.unit === 'weeks', 'fra due settimane deve normalizzare due come numero');
  assert(
    validator._formatDateOnly_(offsetRef.normalizedDate) === '2026-06-15',
    'fra due settimane nel testo utente deve usare messageDate come anchor'
  );
}

console.log('--- Test temporal references: ambigui non vengono normalizzati aggressivamente ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-01',
      messageDate: '2026-06-01',
      timeZone: 'Europe/Rome'
    }
  };
  const refs = validator._extractTemporalReferences_('Lunedì passo nei prossimi giorni.', runtimeContext, 'response');
  const ambiguousWeekday = refs.find(ref => ref.type === 'ambiguous_relative' && /Lunedì/i.test(ref.text));
  const fuzzyFuture = refs.find(ref => ref.type === 'ambiguous_relative' && /prossimi giorni/i.test(ref.text));
  assert(
    ambiguousWeekday && !ambiguousWeekday.normalizedDate && !ambiguousWeekday.normalizedRange,
    'lunedì senza qualificatore deve restare ambiguo'
  );
  assert(
    fuzzyFuture && !fuzzyFuture.normalizedDate && !fuzzyFuture.normalizedRange && fuzzyFuture.meta.direction === 'future',
    'nei prossimi giorni deve restare ambiguo senza range arbitrario'
  );
}

console.log('--- Test temporal references: fallback anchor è marcato come diagnostico ---');
{
  const originalUtilities = global.Utilities;
  const originalDateTimeFormat = global.Intl.DateTimeFormat;
  let seenTimeZone = null;
  global.Utilities = {
    formatDate: () => { throw new Error('timezone unavailable'); }
  };
  global.Intl.DateTimeFormat = function(_locale, options) {
    seenTimeZone = options && options.timeZone;
    return {
      formatToParts: () => [
        { type: 'year', value: '2026' },
        { type: 'literal', value: '-' },
        { type: 'month', value: '06' },
        { type: 'literal', value: '-' },
        { type: 'day', value: '08' }
      ]
    };
  };
  try {
    const refs = validator._extractTemporalReferences_('Domani posso passare?', {}, 'response');
    const tomorrow = refs.find(ref => ref.type === 'relative_point');
    assert(
      tomorrow && tomorrow.anchorIsFallback === true && tomorrow.anchorRole === 'systemFallback' && tomorrow.confidence <= 0.35,
      'senza runtimeContext il parser deve marcare esplicitamente il fallback al clock'
    );
    assert(seenTimeZone === 'Europe/Rome', 'il fallback anchor deve restare normalizzato su Europe/Rome');
    assert(
      validator._formatDateOnly_(tomorrow.normalizedDate) === '2026-06-09',
      'il relativo su fallback deve usare la data Roma normalizzata'
    );
  } finally {
    global.Utilities = originalUtilities;
    global.Intl.DateTimeFormat = originalDateTimeFormat;
  }
}

console.log('--- Test temporal references: response senza currentDate usa messageDate prima del clock ---');
{
  const refs = validator._extractTemporalReferences_(
    'Domani posso passare?',
    { messageDate: '2026-06-01', timeZone: 'Europe/Rome' },
    'response'
  );
  const tomorrow = refs.find(ref => ref.type === 'relative_point');
  assert(
    tomorrow &&
      tomorrow.anchorRole === 'messageDateFallback' &&
      tomorrow.anchorIsFallback === false &&
      validator._formatDateOnly_(tomorrow.normalizedDate) === '2026-06-02',
    'senza currentDate la risposta deve usare messageDate come fallback stabile prima del clock'
  );
}

console.log('--- Test temporal consistency: intervallo futuro qualificato come passato è bloccante ---');
{
  const result = validator._checkTemporalConsistency(
    'La riunione della prossima settimana si è già svolta.',
    'it',
    { currentDate: '2026-06-01' }
  );
  assert(result.score === 0.0, 'un intervallo futuro descritto come già svolto deve bloccare la risposta');
  assert(
    result.violations.some((violation) => violation.type === 'relative_interval'),
    'la violazione deve preservare il tipo relative_interval'
  );
}

console.log('--- Test temporal consistency: data passata qualificata come futura è bloccante ---');
{
  const result = validator._checkTemporalConsistency(
    'La riunione del 6 giugno 2026 si terrà alle 18.',
    'it',
    { currentDate: '2026-06-07' }
  );
  assert(result.score === 0.0, 'una data passata presentata come futura deve bloccare la risposta');
  assert(
    result.violations.some((violation) => violation.direction === 'past_as_future'),
    'la violazione deve indicare past_as_future'
  );
}

console.log('--- Test temporal consistency: forme future italiane comuni sono bloccanti su date passate ---');
{
  const samples = [
    'Il 6 giugno 2026 ci saranno le messe alle 18.',
    'Il 6 giugno 2026 si terranno le celebrazioni alle 18.',
    'Il 6 giugno 2026 gli incontri avranno luogo in oratorio.'
  ];
  samples.forEach((sample) => {
    const result = validator._checkTemporalConsistency(sample, 'it', { currentDate: '2026-06-07' });
    assert(
      result.score === 0.0 &&
        result.violations.some((violation) => violation.direction === 'past_as_future'),
      `deve bloccare la forma futura italiana: ${sample}`
    );
  });
}

console.log('--- Test temporal consistency: passato prossimo plurale italiano e bloccante su date future ---');
{
  const result = validator._checkTemporalConsistency(
    'Le celebrazioni del 10 giugno 2026 si sono svolte alle 18.',
    'it',
    { currentDate: '2026-06-07' }
  );
  assert(result.score === 0.0, 'una data futura qualificata con passato prossimo plurale deve bloccare la risposta');
  assert(
    result.violations.some((violation) => violation.direction === 'future_as_past'),
    'la violazione deve indicare future_as_past'
  );
}

console.log('--- Test temporal consistency: intervallo corrente non usa inizio range come passato ---');
{
  const result = validator._checkTemporalConsistency(
    'Questa settimana si terrà il corso.',
    'it',
    { currentDate: '2026-06-03' }
  );
  assert(result.score === 1.0, 'un intervallo che contiene la data corrente non deve essere trattato come passato');
}

console.log('--- Test temporal consistency: intervallo attraversa mese e anno ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-12-27',
      messageDate: '2026-12-27',
      timeZone: 'Europe/Rome'
    }
  };
  const refs = validator._extractTemporalReferences_('La prossima settimana ci sarà il corso.', runtimeContext, 'response');
  const weekRef = refs.find(ref => ref.type === 'relative_interval');
  assert(
    weekRef &&
      validator._formatDateOnly_(weekRef.normalizedRange.start) === '2026-12-28' &&
      validator._formatDateOnly_(weekRef.normalizedRange.end) === '2027-01-03',
    'la prossima settimana a fine anno deve attraversare correttamente 2026/2027'
  );
  const result = validator._checkTemporalConsistency(
    'La prossima settimana si è già svolto il corso.',
    'it',
    runtimeContext
  );
  assert(result.score === 0.0, 'un intervallo futuro cross-year qualificato come passato deve restare bloccante');
}

console.log('--- Test temporal references: intervallo passato confronta sulla fine range ---');
{
  const refs = validator._extractTemporalReferences_(
    'La settimana scorsa si è concluso il corso.',
    { currentDate: '2026-06-10' },
    'response'
  );
  const intervalRef = refs.find(ref => ref.type === 'relative_interval');
  const compareDate = validator._getTemporalReferenceCompareDate_(intervalRef);
  assert(
    compareDate && validator._formatDateOnly_(compareDate) === '2026-06-07',
    'un intervallo interamente passato deve confrontare sulla data finale'
  );
}

console.log('--- Test temporal references: date esplicite uguali restano uguali con anchor diverso ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-07',
      currentTime: '16:00',
      messageDate: '2026-06-01',
      processingEpochMs: new Date('2026-06-07T14:00:00Z').getTime(),
      messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
      timeZone: 'Europe/Rome'
    }
  };
  const userDate = validator._extractTemporalReferences_('Appuntamento del 2 giugno 2026.', runtimeContext, 'user')
    .find(ref => ref.type === 'explicit_date');
  const responseDate = validator._extractTemporalReferences_('Appuntamento del 2 giugno 2026.', runtimeContext, 'response')
    .find(ref => ref.type === 'explicit_date');
  assert(
    userDate &&
      responseDate &&
      userDate.anchorRole === 'messageDate' &&
      responseDate.anchorRole === 'currentDate' &&
      validator._formatDateOnly_(userDate.normalizedDate) === '2026-06-02' &&
      validator._formatDateOnly_(responseDate.normalizedDate) === '2026-06-02',
    'una data esplicita completa deve restare stabile anche con anchor diversi'
  );
  const result = validator._checkOriginalDateQualification(
    "L'appuntamento del 2 giugno 2026 si è svolto regolarmente.",
    'Appuntamento del 2 giugno 2026.',
    runtimeContext,
    'it'
  );
  assert(result.score === 1.0, 'la stessa data esplicita passata, qualificata come passata, non deve creare discrepanza');
}

console.log('--- Test original date qualification: domani vecchio non resta futuro ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-05-15',
      currentTime: '10:00',
      messageDate: '2026-05-07',
      processingEpochMs: new Date('2026-05-15T08:00:00Z').getTime(),
      messageEpochMs: new Date('2026-05-07T08:00:00Z').getTime(),
      daysAgo: 8,
      isOldMessage: true
    }
  };
  const result = validator._checkOriginalDateQualification(
    'Domani può passare in segreteria.',
    'Domani posso passare in segreteria?',
    runtimeContext,
    'it'
  );
  assert(result.score === 0.0, 'un domani scritto otto giorni fa non deve essere riqualificato come futuro nella risposta');
  assert(
    result.errors.some((e) => e.includes('Discrepanza temporale')),
    'deve segnalare discrepanza temporale dedicata'
  );
}

console.log('--- Test original date qualification: oggi vecchio non resta futuro nella risposta ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-07',
      currentTime: '11:30',
      messageDate: '2026-06-01',
      processingEpochMs: new Date('2026-06-07T09:30:00Z').getTime(),
      messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
      daysAgo: 6,
      isOldMessage: true,
      timeZone: 'Europe/Rome'
    }
  };
  const result = validator._checkOriginalDateQualification(
    'Oggi può passare in segreteria.',
    'Oggi posso passare in segreteria?',
    runtimeContext,
    'it'
  );
  assert(result.score === 0.0, 'oggi scritto in una email vecchia non deve essere ripetuto come futuro/presente operativo');
  assert(
    result.violations.some((violation) => violation.originalDate === '2026-06-01' && violation.responseDate === '2026-06-07'),
    'la violazione deve mostrare la distanza tra oggi originale e oggi della risposta'
  );
}

console.log('--- Test original date qualification: intervallo vecchio non resta futuro ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-21',
      currentTime: '10:00',
      messageDate: '2026-06-01',
      processingEpochMs: new Date('2026-06-21T08:00:00Z').getTime(),
      messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
      daysAgo: 20,
      isOldMessage: true,
      timeZone: 'Europe/Rome'
    }
  };
  const result = validator._checkOriginalDateQualification(
    'Confermiamo che ci vediamo la prossima settimana per il corso.',
    'Ci vediamo la prossima settimana per il corso.',
    runtimeContext,
    'it'
  );
  assert(result.score === 0.0, 'un intervallo relativo scritto in un email vecchia non deve restare futuro nella risposta');
  assert(
    result.violations.some((violation) => violation.originalType === 'relative_interval' && violation.responseType === 'relative_interval'),
    'il controllo deve includere riferimenti intervallari'
  );
}

console.log('--- Test original date qualification: weekday futuro ripetuto non resta futuro se email vecchia ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-21',
      currentTime: '10:00',
      messageDate: '2026-06-14',
      processingEpochMs: new Date('2026-06-21T08:00:00Z').getTime(),
      messageEpochMs: new Date('2026-06-14T08:00:00Z').getTime(),
      daysAgo: 7,
      isOldMessage: true,
      timeZone: 'Europe/Rome'
    }
  };
  const result = validator._checkOriginalDateQualification(
    'Prossimo lunedì può passare in segreteria.',
    'Lunedì prossimo posso passare in segreteria?',
    runtimeContext,
    'it'
  );
  assert(result.score === 0.0, 'un weekday futuro scritto in una email vecchia non deve restare futuro se ripetuto');
  assert(
    result.violations.some((violation) => violation.originalType === 'weekday_relative' && violation.responseType === 'weekday_relative'),
    'il match deve agganciare weekday relativi con stessa direzione'
  );
}

console.log('--- Test original date qualification: weekday con direzione opposta non viene collegato solo per nome giorno ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-21',
      currentTime: '10:00',
      messageDate: '2026-06-14',
      processingEpochMs: new Date('2026-06-21T08:00:00Z').getTime(),
      messageEpochMs: new Date('2026-06-14T08:00:00Z').getTime(),
      daysAgo: 7,
      isOldMessage: true,
      timeZone: 'Europe/Rome'
    }
  };
  const result = validator._checkOriginalDateQualification(
    'Prossimo lunedì può passare in segreteria.',
    'Lunedì scorso posso passare in segreteria?',
    runtimeContext,
    'it'
  );
  assert(result.score === 1.0, 'un weekday passato e uno futuro non devono essere collegati solo perché sono entrambi lunedì');
  assert(
    Array.isArray(result.violations) && result.violations.length === 0,
    'il controllo deve evitare una violazione lessicale fittizia su direzioni opposte'
  );
}

console.log('--- Test temporal greeting: saluto usa currentTime e non messageDate ---');
{
  const runtimeContext = {
    temporal: {
      currentDate: '2026-06-07',
      currentTime: '20:30',
      messageDate: '2026-06-01',
      timeZone: 'Europe/Rome'
    }
  };
  const wrongGreeting = validator._checkTimeBasedGreeting('Buongiorno, le confermiamo la disponibilità.', 'it', runtimeContext);
  const correctGreeting = validator._checkTimeBasedGreeting('Buonasera, le confermiamo la disponibilità.', 'it', runtimeContext);
  assert(
    wrongGreeting.score < 1.0 && wrongGreeting.expectedTimeSlot === 'evening',
    'alle 20:30 correnti il saluto mattutino deve essere incongruente anche se messageDate è vecchia'
  );
  assert(
    correctGreeting.score === 1.0 && correctGreeting.expectedTimeSlot === 'evening',
    'alle 20:30 correnti il saluto serale deve passare'
  );
}

console.log('--- Test temporal greeting: currentTime mancante usa fallback, invalido salta la verifica ---');
{
  const missingTime = validator._checkTimeBasedGreeting(
    'Buongiorno, le confermiamo la disponibilità.',
    'it',
    { temporal: { currentDate: '2026-06-07', messageDate: '2026-06-07', timeZone: 'Europe/Rome' } }
  );
  assert(
    missingTime.skipped !== true &&
      Number.isInteger(missingTime.currentHour) &&
      missingTime.currentHour >= 0 &&
      missingTime.currentHour <= 23 &&
      !missingTime.warnings.includes('missing currentTime'),
    'senza currentTime esplicito il controllo saluto deve usare il fallback del clock di sistema'
  );
  const invalidTime = validator._checkTimeBasedGreeting(
    'Buongiorno, le confermiamo la disponibilità.',
    'it',
    { temporal: { currentDate: '2026-06-07', currentTime: 'sera', messageDate: '2026-06-07', timeZone: 'Europe/Rome' } }
  );
  assert(
    invalidTime.skipped === true &&
      invalidTime.score === 1.0 &&
      invalidTime.warnings.includes('invalid currentTime'),
    'con currentTime invalido il controllo saluto deve essere saltato senza usare il clock reale'
  );
}

console.log('--- Test riferimenti papali: cleanup rimuove titolo e suffisso tabellare ---');
{
  const cleaned = validator._cleanPopeName_('Pontefice Leone XIV | aggiornato al 2026');
  assert(cleaned === 'Leone XIV', 'il cleanup deve rimuovere titolo pontefice e suffisso dopo pipe');
}

console.log('--- Test riferimenti papali: riga tabellare conserva Papa attuale e precedente ---');
{
  const extracted = validator._extractPapalContextFromText_(
    'Informazioni di contesto | Papa regnante | Leone XIV | Papa precedente | Francesco'
  );
  assert(extracted.currentName === 'Leone XIV', 'la riga tabellare deve estrarre il Papa regnante');
  assert(extracted.previousName === 'Francesco', 'la stessa riga tabellare deve estrarre anche il Papa precedente');
}

console.log('--- Test riferimenti papali: ministryStart disponibile nel validator ---');
{
  const context = validator._getCurrentPopeContext_('', {
    currentName: 'Papa Pio XIII',
    previousName: 'Papa Leone XIV',
    currentSince: '2026-01-01',
    ministryStart: '2026-01-08'
  });
  assert(context.ministryStart === '2026-01-08', 'il contesto papale del validator deve includere ministryStart');
}

console.log('--- Test perfezionamento automatico: rimuove thinking leak critico ---');
{
  const refined = validator._perfezionamentoAutomatico(
    'Consultando la knowledge base, le confermiamo che la segreteria è aperta domani. Cordiali saluti.',
    ['RAGIONAMENTO ESPOSTO CRITICO: "Regex Match: consultando la knowledge base..."'],
    'it'
  );
  assert(refined.fixed === true, 'il thinking leak critico deve attivare un perfezionamento automatico');
  assert(
    !/consultando la knowledge base/i.test(refined.text),
    'il perfezionamento deve rimuovere il prefisso di ragionamento esposto'
  );
}

console.log('--- Test _checkCapitalAfterComma: rileva maiuscole latine accentate ---');
{
  const accentedCap = validator._checkCapitalAfterComma('Hola, Él responderá pronto.', 'es');
  assert(
    Array.isArray(accentedCap.violations) && accentedCap.violations.includes('Él'),
    'la regex deve catturare token maiuscoli accentati dopo virgola'
  );
}

console.log('--- Test _checkCapitalAfterComma: pronomi di cortesia italiani dopo virgola ---');
{
  const courtesyLa = validator._checkCapitalAfterComma('Gentile Mario, La informo che la pratica è pronta.', 'it');
  assert(!courtesyLa.violations.includes('La'), 'La pronome di cortesia seguito da verbo formale non deve essere segnalato');

  const courtesyLe = validator._checkCapitalAfterComma('Gentile Mario, Le comunico gli orari aggiornati.', 'it');
  assert(!courtesyLe.violations.includes('Le'), 'Le pronome di cortesia seguito da verbo formale non deve essere segnalato');

  const articleLa = validator._checkCapitalAfterComma('Ciao, La messa è alle 10.', 'it');
  assert(articleLa.violations.includes('La'), 'La articolo dopo virgola deve restare segnalato');
}

console.log('--- Test SemanticValidator: motivo thinking leak non mascherato da hallucination valida ---');
{
  const semanticValidator = new ResponseValidator();
  semanticValidator.semanticValidator = {
    shouldRun: () => true,
    validateHallucinations: () => ({
      isValid: true,
      confidence: 0.95,
      reason: 'Tutti gli orari sono presenti nella KB'
    }),
    validateThinkingLeak: () => ({
      isValid: false,
      confidence: 0.42,
      reason: 'Ragionamento esposto rilevato'
    })
  };

  const result = semanticValidator.validateResponse(
    'Gentile utente, la segreteria risponderà alla richiesta con le informazioni disponibili.',
    'it',
    'Informazioni disponibili.',
    'Vorrei informazioni.',
    'Richiesta informazioni',
    'full',
    false
  );

  assert(
    result.errors.some((error) => error.includes('Ragionamento esposto rilevato')),
    'il motivo semantico deve provenire dal controllo che ha fallito'
  );
  assert(
    !result.errors.some((error) => error.includes('Tutti gli orari sono presenti nella KB')),
    'il motivo di successo hallucination non deve mascherare il thinking leak'
  );
}

console.log('--- Test territory consistency: NON RIENTRA non puo diventare rientra ---');
{
  const result = validator.validateResponse(
    'Gentile utente, sì, Via Barnaba Oriani rientra nel territorio della parrocchia.',
    'it',
    'Informazioni territoriali disponibili.',
    'Abito in via Barnaba Oriani, rientro nel territorio?',
    'Territorio',
    'full',
    false,
    {
      temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
      territoryContext: 'ESITO VERIFICA: NON RIENTRA nel territorio della parrocchia di Sant Eugenio.\nIndirizzo verificato: via Barnaba Oriani.'
    }
  );

  assert(result.isValid === false, 'una risposta che ribalta NON RIENTRA deve fallire');
  assert(
    result.errors.some((error) => error.includes('Coerenza territorio')),
    'il validator deve segnalare la contraddizione territoriale'
  );
}

console.log('--- Test territory consistency: RIENTRA non puo diventare non rientra ---');
{
  const result = validator._checkTerritoryConsistency(
    'Gentile utente, l indirizzo non rientra nel territorio parrocchiale.',
    { territoryContext: 'ESITO VERIFICA: RIENTRA nel territorio parrocchiale.' }
  );

  assert(result.score === 0.0, 'una risposta che nega RIENTRA deve essere bloccata');
  assert(result.expected === 'inside', 'il validator deve distinguere RIENTRA da NON RIENTRA');
}

console.log('--- Test document mismatch template: snapshot positivo valido ---');
{
  const mismatchContext = {
    temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
    validationContext: {
      documentMismatch: {
        active: true,
        mode: 'taxonomy',
        expected: 'certificato di cresima',
        received: 'certificato di battesimo'
      }
    }
  };
  const result = validator.validateResponse(
    'Gentile utente,\n\nL’allegato ricevuto sembra non corrispondere al certificato di cresima. La invitiamo a verificare il file e, se necessario, a reinviare il documento corretto.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'certificato di cresima; certificato di battesimo; verificare file; reinviare documento corretto',
    'Invio in allegato il certificato di cresima.',
    'Certificato di cresima',
    'full',
    false,
    mismatchContext
  );

  assert(result.isValid === true, 'il template positivo per mismatch documentale deve passare');
  assert(result.details.documentMismatchTemplate.checked === true, 'il controllo template documentale deve essere eseguito');
}

console.log('--- Test document mismatch template: blocca regressione prudenziale ---');
{
  const mismatchContext = {
    temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
    validationContext: {
      documentMismatch: { active: true, mode: 'semantic', expected: 'locandina Perillo' }
    }
  };
  const result = validator.validateResponse(
    'Gentile utente,\n\nCon la dovuta prudenza, l’allegato ricevuto sembra non corrispondere alla locandina Perillo. La invitiamo a verificare il file e, se necessario, a reinviare il documento corretto.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'locandina Perillo; verificare file; reinviare documento corretto',
    'Invio in allegato la locandina Perillo.',
    'Locandina Perillo',
    'full',
    false,
    mismatchContext
  );

  assert(result.isValid === false, 'la regressione prudenziale deve essere bloccata');
  assert(
    result.errors.some((error) => error.includes('formula metatestuale o prudenziale')),
    'il validator deve indicare la formula prudenziale/metatestuale'
  );
}

console.log('--- Test document mismatch template: blocca risposta senza template ---');
{
  const mismatchContext = {
    temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
    validationContext: {
      documentMismatch: { active: true, mode: 'semantic', expected: 'locandina Perillo' }
    }
  };
  const result = validator.validateResponse(
    'Gentile utente,\n\nL’allegato potrebbe essere diverso da quello indicato. La invitiamo a controllare e a rimandarlo.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'locandina Perillo; verificare file; reinviare documento corretto',
    'Invio in allegato la locandina Perillo.',
    'Locandina Perillo',
    'full',
    false,
    mismatchContext
  );

  assert(result.isValid === false, 'la risposta senza template positivo deve essere bloccata');
  assert(
    result.errors.some((error) => error.includes('template positivo')),
    'il validator deve segnalare la mancanza del template positivo'
  );
}

console.log('--- Test document mismatch template: unverified_attachment valido ---');
{
  const mismatchContext = {
    temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
    validationContext: {
      documentMismatch: {
        active: true,
        mode: 'unverified_attachment',
        expected: 'scheda di iscrizione al corso prematrimoniale'
      }
    }
  };
  const result = validator.validateResponse(
    'Gentile utente,\n\nAbbiamo ricevuto l’allegato, ma non possiamo confermare con certezza che corrisponda alla scheda di iscrizione al corso prematrimoniale. La invitiamo a verificarlo e, se necessario, a reinviare il file corretto.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'scheda di iscrizione al corso prematrimoniale; verificare; reinviare file corretto',
    'Vi invio la scheda di iscrizione al corso prematrimoniale.',
    'Scheda iscrizione',
    'full',
    false,
    mismatchContext
  );

  assert(result.isValid === true, 'il template unverified_attachment deve passare senza pretendere il mismatch');
  assert(result.details.documentMismatchTemplate.mode === 'unverified_attachment', 'il validator deve conservare il mode unverified_attachment');
  assert(result.details.documentMismatchTemplate.hasUnverifiedTemplate === true, 'il template non verificabile deve essere riconosciuto');
}

console.log('--- Test document mismatch template: unverified_attachment blocca falso mismatch ---');
{
  const mismatchContext = {
    temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
    validationContext: {
      documentMismatch: {
        active: true,
        mode: 'unverified_attachment',
        expected: 'scheda di iscrizione al corso prematrimoniale'
      }
    }
  };
  const result = validator.validateResponse(
    'Gentile utente,\n\nL’allegato ricevuto sembra non corrispondere alla scheda di iscrizione al corso prematrimoniale. La invitiamo a verificare il file e, se necessario, a reinviare il documento corretto.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'scheda di iscrizione al corso prematrimoniale; verificare; reinviare file corretto',
    'Vi invio la scheda di iscrizione al corso prematrimoniale.',
    'Scheda iscrizione',
    'full',
    false,
    mismatchContext
  );

  assert(result.isValid === false, 'unverified_attachment non deve passare con linguaggio da mismatch');
  assert(
    result.errors.some((error) => error.includes('Allegato non verificabile')),
    'il validator deve segnalare il contratto non verificabile'
  );
}

console.log('--- Test expected document missing: template valido ---');
{
  const missingContext = {
    temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
    validationContext: {
      expectedDocumentMissing: {
        active: true,
        expected: 'scheda di iscrizione al corso prematrimoniale',
        deliveryChannel: 'attachment',
        bodyContainsUsableDocumentContent: false
      }
    }
  };
  const result = validator.validateResponse(
    'Gentile utente,\n\nNon troviamo allegata né riportata nel testo la scheda di iscrizione al corso prematrimoniale. Può cortesemente reinviarla o inserirne i dati nel corpo del messaggio?\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'scheda di iscrizione al corso prematrimoniale; reinviare; inserire dati nel corpo',
    'VI INVIAMO LA SCHEDA DI ISCRIZIONE AL NOSTRO CORSO PREMATRIMONIALE',
    'Scheda iscrizione corso prematrimoniale',
    'full',
    false,
    missingContext
  );

  assert(result.isValid === true, 'il template documento mancante deve passare');
  assert(result.details.expectedDocumentMissingTemplate.checked === true, 'il controllo documento mancante deve essere eseguito');
}

console.log('--- Test expected document missing: blocca conferma ricezione ---');
{
  const missingContext = {
    temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
    validationContext: {
      expectedDocumentMissing: {
        active: true,
        expected: 'scheda di iscrizione al corso prematrimoniale',
        deliveryChannel: 'attachment',
        bodyContainsUsableDocumentContent: false
      }
    }
  };
  const result = validator.validateResponse(
    'Gentile utente,\n\nAbbiamo ricevuto la documentazione e procederemo alla verifica. Se tutto risulterà completo, effettueremo la registrazione nei nostri archivi.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'scheda di iscrizione al corso prematrimoniale; reinviare; inserire dati nel corpo',
    'VI INVIAMO LA SCHEDA DI ISCRIZIONE AL NOSTRO CORSO PREMATRIMONIALE',
    'Scheda iscrizione corso prematrimoniale',
    'full',
    false,
    missingContext
  );

  assert(result.isValid === false, 'documento mancante non deve confermare ricezione');
  assert(
    result.errors.some((error) => error.includes('Documento atteso mancante')),
    'il validator deve segnalare la conferma indebita del documento mancante'
  );
}

console.log('--- Test sensitive continuity: lutto in memoria non va riaperto se non ripreso ---');
{
  const result = validator.validateResponse(
    'Buongiorno,\nricordando il lutto che ha vissuto, le confermo che l incontro è previsto alle 18:00.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'Incontro: ore 18:00.',
    'A che ora ci vediamo?',
    'Re: incontro',
    'full',
    false,
    {
      temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
      validationContext: {
        activeConcerns: { longitudinal_sensitivity: true },
        continuityCase: { key: 'bereavement_continuity', longitudinal: true },
        responseRegister: 'pastoral_supportive'
      }
    }
  );

  assert(result.isValid === false, 'la riapertura del lutto non ripreso deve essere bloccante');
  assert(
    result.errors.some((error) => error.includes('Continuita sensibile')),
    'il validator deve segnalare la continuita sensibile violata'
  );
}

console.log('--- Test sensitive continuity: lutto citato dall utente resta citabile ---');
{
  const result = validator.validateResponse(
    'Buongiorno,\nper la Messa in suffragio di suo padre defunto, le confermo che l incontro è previsto alle 18:00.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'Incontro: ore 18:00.',
    'Dopo il lutto di mio padre, vorrei fissare la Messa in suffragio.',
    'Messa in suffragio',
    'full',
    false,
    {
      temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
      validationContext: {
        activeConcerns: { longitudinal_sensitivity: true },
        continuityCase: { key: 'bereavement_continuity', longitudinal: true },
        responseRegister: 'pastoral_supportive'
      }
    }
  );

  assert(
    !result.errors.some((error) => error.includes('Continuita sensibile')),
    'se il lutto e ripreso dall utente, il validator non deve bloccarne la citazione'
  );
}

console.log('--- Test sensitive continuity: apertura relazionale troppo burocratica produce warning ---');
{
  const result = validator._checkSensitiveContinuityQuality(
    'Gentile signora, La informiamo che la richiesta deve essere presentata con il modulo previsto.',
    'Grazie, vorrei capire quale modulo serve.',
    {
      validationContext: {
        activeConcerns: { relational_warmth: true },
        continuityCase: { key: 'relational_opening_continuity', relationalWarmth: true },
        responseRegister: 'pastoral_supportive'
      }
    }
  );

  assert(result.errors.length === 0, 'il tono burocratico su apertura relazionale deve restare warning, non errore');
  assert(
    result.warnings.some((warning) => warning.includes('Qualita sensibile')),
    'il validator deve rendere visibile il registro troppo procedurale'
  );
  assert(result.score < 1.0, 'il warning qualitativo deve ridurre moderatamente lo score');
}

console.log('--- Test sensitive continuity: registro formale blocca contaminazione pastorale ---');
{
  const result = validator.validateResponse(
    'Gentile Mario,\nprima di procedere la invitiamo a riflettere ancora e a restare nella Chiesa. Per la procedura formale può inviare la richiesta firmata.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
    'it',
    'Procedura formale: richiesta firmata.',
    'Vorrei procedere con la richiesta formale.',
    'Richiesta formale',
    'full',
    false,
    {
      temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' },
      validationContext: {
        activeConcerns: { longitudinal_sensitivity: true },
        continuityCase: { key: 'canonical_continuity', longitudinal: true },
        responseRegister: 'formal_institutional',
        category: 'formal',
        requestType: 'formal'
      }
    }
  );

  assert(result.isValid === false, 'la contaminazione pastorale in registro formale deve essere bloccante');
  assert(
    result.errors.some((error) => error.includes('Registro formale')),
    'il validator deve segnalare la contaminazione del registro formale'
  );
}

console.log('--- Test SemanticValidator: fallback lazy senza GeminiService/CacheService ---');
{
  const originalConfig = global.CONFIG;
  const originalGeminiService = global.GeminiService;
  const originalCacheService = global.CacheService;
  const originalUrlFetchApp = global.UrlFetchApp;

  try {
    global.CONFIG = { VALIDATION_MIN_SCORE: 0.6, SEMANTIC_VALIDATION: { enabled: true } };
    global.GeminiService = undefined;
    global.CacheService = undefined;
    global.UrlFetchApp = undefined;

    const lazyValidator = new ResponseValidator();
    assert(lazyValidator.semanticValidator !== null, 'SemanticValidator deve inizializzarsi anche senza GeminiService');
    assert(lazyValidator.semanticValidator.runtimeSemanticAvailable === false, 'runtimeSemanticAvailable deve restare false fuori runtime GAS');

    const fallback = lazyValidator.semanticValidator.validateThinkingLeak('Risposta naturale.', { score: 0.9 });
    assert(fallback.skipped === true && fallback.fallback === true, 'senza runtime semantico deve usare fallback lazy');
    assert(fallback.isValid === true, 'fallback lazy con score alto deve restare valido');
  } finally {
    global.CONFIG = originalConfig;
    global.GeminiService = originalGeminiService;
    global.CacheService = originalCacheService;
    global.UrlFetchApp = originalUrlFetchApp;
  }
}

console.log('--- Test SemanticValidator: fallback token se estimateTokenCount non caricato ---');
{
  const originalEstimateTokenCount = global.estimateTokenCount;
  try {
    delete global.estimateTokenCount;
  } catch (e) {
    global.estimateTokenCount = undefined;
  }

  try {
    let capturedEstimatedTokens = null;
    const semantic = Object.create(SemanticValidator.prototype);
    semantic.taskType = 'semantic';
    semantic.maxRetries = 1;
    semantic.geminiService = {
      useRateLimiter: true,
      rateLimiter: {
        executeRequest: (_taskType, _requestFn, options) => {
          capturedEstimatedTokens = options.estimatedTokens;
          return { success: true, result: '{"isValid":true}', modelUsed: 'fallback-model' };
        }
      }
    };

    const result = semantic._generateSemantic('testo breve');
    assert(result === '{"isValid":true}', 'SemanticValidator deve completare anche senza estimateTokenCount globale');
    assert(capturedEstimatedTokens > 0, 'il fallback deve passare una stima token positiva al RateLimiter');
  } finally {
    if (typeof originalEstimateTokenCount === 'undefined') {
      try {
        delete global.estimateTokenCount;
      } catch (e) {
        global.estimateTokenCount = undefined;
      }
    } else {
      global.estimateTokenCount = originalEstimateTokenCount;
    }
  }
}

console.log('--- Test SemanticValidator: modelKey backup usa la chiave di riserva ---');
{
  const semantic = Object.create(SemanticValidator.prototype);
  semantic.taskType = 'semantic';
  semantic.maxRetries = 1;
  let capturedApiKey = null;
  semantic.geminiService = {
    primaryKey: 'primary-key',
    backupKey: 'backup-key',
    useRateLimiter: true,
    _generateWithModel: (_prompt, _modelName, apiKey) => {
      capturedApiKey = apiKey;
      return '{"isValid":true}';
    },
    rateLimiter: {
      executeRequest: (taskType, requestFn) => ({
        success: true,
        result: requestFn('gemini-3.5-flash-lite', {
          taskType,
          modelKey: 'flash-lite-backup',
          usesBackupKey: true
        }),
        modelUsed: 'gemini-3.5-flash-lite'
      })
    }
  };

  const result = semantic._generateSemantic('prompt semantico');
  assert(result === '{"isValid":true}', 'la validazione semantica deve restituire il payload del modello selezionato');
  assert(capturedApiKey === 'backup-key', 'un modelKey backup non deve eseguire la richiesta con la chiave primaria');
}

console.log('--- Test knowledge contextualization: rileva alternativa composta trasferita dalla KB ---');
{
  const email = 'Lavoro come infermiera in pronto soccorso e lavoro su turni. Vorrei sapere come funziona e quando inizierà il corso.';
  const kb = 'Per chi lavora su turni è possibile concordare un programma personalizzato o anticipare alcuni incontri.';
  const copiedResponse = 'Riguardo alle turnazioni, è possibile concordare un programma personalizzato o anticipare alcuni incontri d’intesa con il sacerdote.';
  const focusedResponse = 'Data la turnazione, è possibile concordare modalità di partecipazione flessibili con il sacerdote responsabile.';

  const copiedRisk = validator._checkKnowledgeContextualizationRisk(copiedResponse, kb, email);
  const focusedRisk = validator._checkKnowledgeContextualizationRisk(focusedResponse, kb, email);

  assert(copiedRisk.requiresSemanticReview === true, 'il trasferimento di un ramo alternativo dalla KB deve richiedere revisione semantica');
  assert(copiedRisk.signals.includes('compound_alternative_transferred'), 'il segnale deve identificare l’alternativa composta non posta dall’utente');
  assert(focusedRisk.requiresSemanticReview === false, 'una sintesi contestuale senza alternativa accessoria non deve attivare la revisione');
}

console.log('--- Test knowledge contextualization: negazione istituzionale forza il controllo semantico ---');
{
  const email = [
    'Ho orari di lavoro variabili e avrei difficoltà a seguire giorni e orari fissi.',
    'Ho saputo che è possibile un percorso personalizzato con un tutor.',
    'Vorrei sapere se fosse possibile nel mio caso.'
  ].join(' ');
  const kb = [
    'Possibilità di programmi personalizzati per giorno e ora diversi per esigenze lavorative.',
    'Possibilità di concordare con il sacerdote un eventuale anticipo degli incontri.'
  ].join('\n');
  const unsupportedNegative = 'Non disponiamo di programmi di tutoraggio individuale completamente slegati dal calendario delle lezioni.';

  const risk = validator._checkKnowledgeContextualizationRisk(unsupportedNegative, kb, email);
  assert(risk.requiresSemanticReview === true, 'una indisponibilità istituzionale deve essere riesaminata anche con scarso overlap lessicale');
  assert(risk.signals.includes('institutional_negative_claim'), 'il rischio deve identificare la negazione istituzionale');

  const semantic = Object.create(SemanticValidator.prototype);
  const semanticPrompt = semantic._buildHallucinationPrompt(unsupportedNegative, kb, email, 'information_request');
  assert(
    semanticPrompt.includes('affermazioni di disponibilità, indisponibilità, divieto o limite') &&
      semanticPrompt.includes("l'EMAIL ORIGINALE da sola non le dimostra") &&
      semanticPrompt.includes("l'assenza di un dettaglio non autorizza una negazione"),
    'il validatore semantico deve applicare il radicamento anche alle affermazioni negative'
  );
}

console.log('--- Test knowledge contextualization: il rischio forza la validazione semantica anche con score alto ---');
{
  const previousSemanticValidator = validator.semanticValidator;
  let forcedOptions = null;
  try {
    validator.semanticValidator = {
      shouldRun: () => false,
      validateHallucinations: (_response, _kb, _regex, _email, options) => {
        forcedOptions = options;
        return {
          isValid: false,
          confidence: 0.35,
          reason: 'Pertinenza KB: alternativa accessoria non richiesta',
          details: {
            irrelevantDetails: [
              { text: 'anticipare alcuni incontri', reason: 'non risponde al vincolo espresso' }
            ]
          }
        };
      },
      validateThinkingLeak: () => ({ isValid: true, confidence: 0.99, skipped: true })
    };

    const result = validator.validateResponse(
      'Buongiorno.\n\nÈ possibile concordare un programma personalizzato o anticipare alcuni incontri con il sacerdote.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
      'it',
      'Per chi lavora su turni è possibile concordare un programma personalizzato o anticipare alcuni incontri.',
      'Lavoro come infermiera in pronto soccorso e lavoro su turni. Vorrei informazioni sul corso.',
      'Corso Cresima',
      'full',
      false
    );

    assert(forcedOptions && forcedOptions.forceRelevanceReview === true, 'il rischio lessicale deve forzare il controllo semantico di pertinenza');
    assert(result.isValid === false, 'un dettaglio vero ma materialmente irrilevante deve bloccare la risposta');
    assert(result.errors.some(error => error.includes('Pertinenza KB')), 'l’errore deve distinguere la pertinenza dall’allucinazione');
  } finally {
    validator.semanticValidator = previousSemanticValidator;
  }
}

console.log('--- Test semantic quality: supporto email per mobilita resta warning ad alto punteggio ---');
{
  const previousSemanticValidator = validator.semanticValidator;
  try {
    validator.semanticValidator = {
      shouldRun: () => true,
      validateHallucinations: () => ({
        isValid: false,
        confidence: 0.9,
        reason: 'Pertinenza KB: suggerimento email non indispensabile',
        details: {
          irrelevantDetails: [
            { text: 'può inviare la richiesta via email', reason: 'alternativa non strettamente richiesta' }
          ]
        }
      }),
      validateThinkingLeak: () => ({ isValid: true, confidence: 0.99, skipped: true })
    };

    const result = validator.validateResponse(
      'Buongiorno.\n\nPer evitarle uno spostamento, può inviare la richiesta via email; la segreteria le risponderà con le indicazioni necessarie.\n\nCordiali saluti,\nSegreteria Parrocchia Sant\'Eugenio',
      'it',
      'La segreteria riceve richieste anche via email.',
      'Sono anziano, disabile e ho difficoltà di movimento. Come posso procedere?',
      'Richiesta informazioni',
      'full',
      false,
      {
        physicalPresenceConstraint: {
          has_constraint: true,
          type: 'mobility',
          visit_policy: 'avoid_invitation'
        }
      }
    );

    assert(result.isValid === true, 'un suggerimento remoto fondato e coerente con il vincolo di mobilita non deve bloccare la risposta');
    assert(result.score >= 0.85, 'l osservazione qualitativa non deve abbassare artificialmente lo score alto');
    assert(result.warnings.some(warning => warning.includes('Semantica qualitativa')), 'il rilievo deve restare osservabile come warning');
  } finally {
    validator.semanticValidator = previousSemanticValidator;
  }
}

console.log('--- Test request purpose: procedura preliminare in richiesta operativa forza revisione ---');
{
  const email = 'Richiedo il certificato di battesimo in originale per uso matrimonio. Il battesimo è stato celebrato a Sant Eugenio e verrò a ritirarlo lunedì.';
  const kb = 'Il certificato deve essere richiesto esclusivamente alla parrocchia in cui è stato celebrato il sacramento. Gli originali possono essere ritirati in segreteria.';
  const response = 'Le ricordiamo che il certificato deve essere richiesto esclusivamente alla parrocchia in cui è stato celebrato il sacramento. Abbiamo preso nota della richiesta per il ritiro.';
  const temporalContext = {
    validationContext: {
      requestPurpose: { type: 'operational_request', confidence: 0.96 }
    }
  };
  const risk = validator._checkKnowledgeContextualizationRisk(response, kb, email, temporalContext);

  assert(risk.requiresSemanticReview === true, 'una spiegazione preliminare in una richiesta operativa deve essere riesaminata semanticamente');
  assert(risk.signals.includes('operational_request_kb_scope'), 'il rischio deve essere attribuito allo scopo operativo, non al solo topic');

  const previousSemanticValidator = validator.semanticValidator;
  let receivedPurpose = null;
  try {
    validator.semanticValidator = {
      shouldRun: () => false,
      validateHallucinations: (_response, _kb, _regex, _email, options) => {
        receivedPurpose = options.requestPurpose;
        return {
          isValid: false,
          confidence: 0.4,
          reason: 'Pertinenza KB: spiegazione procedurale già soddisfatta',
          details: { irrelevantDetails: [{ text: 'deve essere richiesto esclusivamente', reason: 'procedura già compresa' }] }
        };
      },
      validateThinkingLeak: () => ({ isValid: true, confidence: 0.99, skipped: true })
    };

    const result = validator.validateResponse(
      `Buongiorno.\n\n${response}\n\nCordiali saluti,\nSegreteria Parrocchia Sant'Eugenio`,
      'it',
      kb,
      email,
      'Certificato di battesimo',
      'full',
      false,
      temporalContext
    );
    assert(receivedPurpose && receivedPurpose.type === 'operational_request', 'il validator semantico deve ricevere lo scopo classificato');
    assert(result.isValid === false, 'la procedura vera ma superflua deve bloccare la risposta operativa');
  } finally {
    validator.semanticValidator = previousSemanticValidator;
  }
}

console.log('--- Test SemanticValidator: dettagli KB irrilevanti senza isValid diventano invalidanti ---');
{
  const semantic = Object.create(SemanticValidator.prototype);
  const normalized = semantic._normalizeSemanticPayload({
    hallucinations: { times: [], emails: [], phones: [] },
    irrelevantDetails: [{ text: 'anticipare alcuni incontri', reason: 'alternativa non richiesta' }],
    confidence: 0.82,
    reason: 'Pertinenza KB insufficiente'
  });

  assert(normalized.isValid === false, 'i dettagli materialmente irrilevanti devono rendere il payload non valido');
  assert(Array.isArray(normalized.details.irrelevantDetails), 'i dettagli di pertinenza devono essere preservati per il retry');

  const inconsistent = semantic._normalizeSemanticPayload({
    irrelevantDetails: [{ text: 'eccezione accessoria' }],
    isValid: true,
    confidence: 0.9
  });
  assert(inconsistent.isValid === false, 'un isValid incoerente non deve neutralizzare i dettagli irrilevanti espliciti');
}

console.log('--- Test SemanticValidator: hallucinations senza isValid diventano invalidanti ---');
{
  const semantic = Object.create(SemanticValidator.prototype);
  const normalized = semantic._normalizeSemanticPayload({
    hallucinations: { times: ['10:00'], emails: [], phones: [] },
    confidence: 0,
    reason: 'orario non presente nella KB'
  });

  assert(normalized.isValid === false, 'hallucinations non vuote devono rendere il payload non valido');
  assert(normalized.confidence === 0, 'confidence 0 deve essere preservata e non sostituita con default');
  assert(Array.isArray(normalized.details.times), 'i dettagli hallucinations devono essere preservati');
}

console.log('--- Test SemanticValidator: prompt hallucination non tronca KB a 2000 caratteri ---');
{
  const semantic = Object.create(SemanticValidator.prototype);
  const lateKbFact = 'NATALE_SENTINEL: Messa della notte alle ore 24.';
  const longKnowledgeBase = 'Intro KB. ' + 'x'.repeat(2500) + lateKbFact + ' ' + 'y'.repeat(500);
  const prompt = semantic._buildHallucinationPrompt(
    'La Messa della notte di Natale è alle 24:00.',
    longKnowledgeBase,
    'Vorrei sapere gli orari di Natale.',
    'information_request'
  );

  assert(prompt.includes(lateKbFact), 'il prompt semantico deve includere dati KB oltre i vecchi 2000 caratteri');
  assert(!prompt.includes('[TRUNCATED]'), 'una KB sotto 30000 caratteri non deve essere troncata');
  assert(
    prompt.includes('COMPITO B — PERTINENZA CONTESTUALE') &&
      prompt.includes('unità informative separate') &&
      prompt.includes('irrelevantDetails') &&
      prompt.includes('informazioni che aiutano concretamente a gestire un vincolo dichiarato') &&
      prompt.includes('Prima distingui lo scopo') &&
      prompt.includes('Se lo scopo è operativo'),
    'il validatore semantico deve controllare anche selezione e contestualizzazione dei fatti veri della KB'
  );
}


console.log('--- Test SemanticValidator: hash include lunghezza testo ---');
{
  const semantic = Object.create(SemanticValidator.prototype);
  const shortHash = semantic._hashText('abc');
  const longerHash = semantic._hashText('abc ');
  assert(shortHash.startsWith('3_'), 'la chiave hash deve includere la lunghezza del testo breve');
  assert(longerHash.startsWith('4_'), 'la chiave hash deve distinguere anche testi con stesso prefisso ma lunghezza diversa');
}

console.log('✅ Test core ResponseValidator passati');

console.log('--- Test ResponseValidator: blocca leak response_strategy nella risposta finale ---');
{
  const validator = Object.create(ResponseValidator.prototype);
  validator.thinkingRegexes = [];
  validator.thinkingPatterns = ['orientamento della risposta', 'secondo la strategia', 'la strategia di risposta'];
  const strategyLeak = validator._checkExposedReasoning('Secondo la strategia, indico il prossimo passo.');
  const sectionLeak = validator._checkExposedReasoning('## ORIENTAMENTO DELLA RISPOSTA\nPer questa risposta');
  assert(strategyLeak.score === 0.0, 'deve rilevare leak su strategia di risposta');
  assert(sectionLeak.score === 0.0, 'deve rilevare leak sulla sezione interna');
}

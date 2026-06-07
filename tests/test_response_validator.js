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

console.log('--- Test _checkLanguage conserva testo dopo gmail_quote chiuso ---');
{
  const result = validator._checkLanguage(
    'Intro <div class="gmail_quote">thank regards dear</div> Gentile parrocchia, grazie e cordiali saluti.',
    'it'
  );
  assert(result.markerScores.it >= 4, 'il testo successivo a gmail_quote non deve essere troncato');
}

console.log('--- Test _checkLanguage declassa IT/EN misto ma blocca EN pieno ---');
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
  assert(mixedResult.errors.length === 0, 'IT/EN misto con segnale italiano non deve essere bloccante');
  assert(
    mixedResult.warnings.some((w) => w.includes('Possibile lingua mista IT/EN')),
    'IT/EN misto deve restare visibile come warning'
  );
  assert(mixedResult.score === 0.85, `IT/EN misto deve degradare a 0.85, ottenuto ${mixedResult.score}`);

  const englishResult = localValidator._checkLanguage(
    'Dear parish, thank you for your email. Could you confirm the mass schedule? Kind regards.',
    'it'
  );
  assert(
    englishResult.errors.some((e) => e.includes('Lingua non corrispondente')),
    'una risposta interamente EN a target IT deve restare bloccante'
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

console.log('--- Test temporal consistency: data futura programmata passa ---');
const temporalFutureOkResult = validator._checkTemporalConsistency(
  'La celebrazione della Cresima è in programma il 24 maggio 2026 alle ore 17:30.',
  'it',
  { currentDate: '2026-05-15' }
);
assert(temporalFutureOkResult.score === 1.0, 'una data futura presentata come programmata deve passare');

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


console.log('--- Test SemanticValidator: hash include lunghezza testo ---');
{
  const semantic = Object.create(SemanticValidator.prototype);
  const shortHash = semantic._hashText('abc');
  const longerHash = semantic._hashText('abc ');
  assert(shortHash.startsWith('3_'), 'la chiave hash deve includere la lunghezza del testo breve');
  assert(longerHash.startsWith('4_'), 'la chiave hash deve distinguere anche testi con stesso prefisso ma lunghezza diversa');
}

console.log('✅ Test core ResponseValidator passati');

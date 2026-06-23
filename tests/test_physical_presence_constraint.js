const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

global.CONFIG = {
  VALIDATION_MIN_SCORE: 0.6,
  SEMANTIC_VALIDATION: { enabled: false },
  KB_HALLUCINATION_RISK_THRESHOLD: 8000
};

global.LANGUAGE_MARKERS = {
  it: ['grazie', 'cordiali', 'saluti', 'gentile', 'parrocchia']
};

global.createLogger = function createLoggerStub() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };
};

function loadGasFile(fileName) {
  const filePath = path.join(__dirname, '..', fileName);
  vm.runInThisContext(fs.readFileSync(filePath, 'utf8'), { filename: filePath });
}

loadGasFile('gas_response_strategy.js');
loadGasFile('gas_email_processor.js');
loadGasFile('gas_prompt_context.js');
loadGasFile('gas_prompt_engine.js');
loadGasFile('gas_response_validator.js');

console.log('--- Test physical presence constraint: local fallback detects distance ---');
{
  const processor = Object.create(EmailProcessor.prototype);
  const result = processor._resolvePhysicalPresenceConstraint_(
    null,
    'Cresima adulti',
    'Vivo a Darmstadt in Germania e chiedo se e possibile seguire un percorso a distanza.'
  );

  assert(result.has_constraint === true, 'distance from Rome must activate the constraint');
  assert(result.type === 'geographic_distance', 'distance signal must use geographic_distance type');
  assert(result.visit_policy === 'conditional_only', 'distance signal must allow only conditional visits');
  assert(result.source === 'local_fallback', 'fallback detector must mark its source');
}

console.log('--- Test physical presence constraint: quick check wins when confident ---');
{
  const processor = Object.create(EmailProcessor.prototype);
  const result = processor._resolvePhysicalPresenceConstraint_(
    {
      has_constraint: 'true',
      type: 'health',
      confidence: 0.91,
      evidence: 'sono ricoverato',
      reason: 'hospital stay',
      visit_policy: 'avoid_invitation'
    },
    'Informazioni',
    'Vorrei informazioni.'
  );

  assert(result.has_constraint === true, 'quick check true string must normalize to boolean true');
  assert(result.type === 'health', 'confident quick check type must be preserved');
  assert(result.visit_policy === 'avoid_invitation', 'confident quick check policy must be preserved');
  assert(result.source === 'quick_check', 'confident quick check must be the primary source');
}

console.log('--- Test physical presence constraint: visit intent is not a constraint ---');
{
  const processor = Object.create(EmailProcessor.prototype);
  const result = processor._resolvePhysicalPresenceConstraint_(
    null,
    'Segreteria',
    "Posso passare domani in segreteria per consegnare un documento?"
  );

  assert(result.has_constraint === false, 'explicit wish to visit must not be treated as a constraint');
  assert(result.source === 'default', 'no signal must return the default object');
}

console.log('--- Test physical presence constraint: PromptContext concern ---');
{
  const context = createPromptContext({
    email: { isReply: false, detectedLanguage: 'it' },
    requestType: { type: 'technical' },
    classification: { confidence: 1, category: 'technical' },
    physicalPresenceConstraint: {
      has_constraint: true,
      type: 'geographic_distance',
      visit_policy: 'conditional_only'
    }
  });

  assert(
    context.concerns.physical_presence_constraint === true,
    'PromptContext must expose the active physical presence concern'
  );
}

console.log('--- Test physical presence constraint: PromptEngine guideline ---');
{
  const engine = Object.create(PromptEngine.prototype);
  const guideline = engine._renderPhysicalPresenceConstraintGuideline({
    has_constraint: true,
    type: 'legal_restriction',
    visit_policy: 'avoid_invitation',
    evidence: 'non posso raggiungervi'
  });

  assert(guideline.includes('POLICY PRESENZA FISICA'), 'prompt must include the dedicated policy');
  assert(guideline.includes('Non proporre'), 'prompt must forbid ordinary direct visit invitations');
  assert(guideline.includes('avoid_invitation'), 'prompt must preserve the visit policy');
  assert(
    guideline.includes('GESTIONE DIGITALE (OBBLIGATORIA)') &&
      guideline.includes('OMETTI COMPLETAMENTE: orari di apertura al pubblico'),
    'avoid_invitation must force digital handling and omit office hours'
  );
  assert(
    guideline.includes('Verificheremo i nostri registri') &&
      guideline.includes('glielo invieremo via email in formato PDF'),
    'avoid_invitation must show a digital-only correct formula'
  );
  assert(
    guideline.includes('Formula da evitare anche con vincolo avoid_invitation') &&
      !guideline.includes('Qualora le fosse possibile passare da Roma'),
    'avoid_invitation must not show the Rome visit formula as correct'
  );
  assert(
    guideline.includes('ECCEZIONE CANONICA - IDONEITÀ PADRINO/MADRINA') &&
      guideline.includes('questa regola prevale sulla gestione digitale dei documenti') &&
      guideline.includes('non è delegabile'),
    'sponsor eligibility must override generic digital document handling'
  );
  assert(
    guideline.includes('contattare telefonicamente un sacerdote') &&
      guideline.includes('Non scrivere "venga in segreteria"'),
    'sponsor eligibility with physical constraint must route to phone pastoral contact without direct visit wording'
  );
}

console.log('--- Test physical presence constraint: PromptEngine keeps conditional Rome visit for distance ---');
{
  const engine = Object.create(PromptEngine.prototype);
  const guideline = engine._renderPhysicalPresenceConstraintGuideline({
    has_constraint: true,
    type: 'geographic_distance',
    visit_policy: 'conditional_only',
    evidence: 'vivo fuori Roma'
  });

  assert(guideline.includes('GESTIONE DIGITALE: Se l\'utente chiede l\'invio di un documento via email'), 'conditional policy must still mention digital handling');
  assert(
    guideline.includes('Qualora le fosse possibile passare da Roma'),
    'conditional policy must preserve the respectful Rome visit formula'
  );
  assert(
    !guideline.includes('GESTIONE DIGITALE (OBBLIGATORIA)'),
    'conditional policy must not use the avoid_invitation digital-only rule'
  );
}

console.log('--- Test physical presence constraint: validator blocks direct invitation ---');
{
  const validator = new ResponseValidator();
  const direct = validator._checkPhysicalPresenceConstraint(
    'Puo chiamarci al numero 06 320 19 23 oppure venire in segreteria dal lunedi al venerdi.',
    {
      physicalPresenceConstraint: {
        has_constraint: true,
        type: 'geographic_distance',
        visit_policy: 'conditional_only'
      }
    }
  );

  assert(direct.score === 0.0, 'direct visit invitation must be blocking');
  assert(direct.errors.length === 1, 'direct visit invitation must produce an error');

  const conditional = validator._checkPhysicalPresenceConstraint(
    'Puo chiamarci al numero 06 320 19 23. Qualora le capitasse di trovarsi a Roma, saremo lieti di incontrarla anche di persona.',
    {
      physicalPresenceConstraint: {
        has_constraint: true,
        type: 'geographic_distance',
        visit_policy: 'conditional_only'
      }
    }
  );

  assert(conditional.score === 1.0, 'conditional in-person wording must be accepted');
  assert(conditional.errors.length === 0, 'conditional in-person wording must not produce errors');

  const avoidInvitationConditional = validator._checkPhysicalPresenceConstraint(
    'Puo chiamarci al numero 06 320 19 23. Qualora le fosse possibile passare in parrocchia, potremo parlarne anche di persona.',
    {
      physicalPresenceConstraint: {
        has_constraint: true,
        type: 'health',
        visit_policy: 'avoid_invitation'
      }
    }
  );

  assert(avoidInvitationConditional.score === 0.0, 'avoid_invitation must block conditional in-person wording too');
  assert(
    avoidInvitationConditional.errors.some(error => error.includes('avoid_invitation')),
    'avoid_invitation violation must be explicit for retry guidance'
  );
}

console.log('OK physical presence constraint tests passed');

/**
 * Funzioni condivise per la strategia di risposta.
 */

/** Fonte procedurale interna condivisa; descrive il flusso, non attesta azioni eseguite. */
function getBaptismAnnotationProcedure_() {
  return `FONTE INTERNA — ANNOTAZIONE NEI REGISTRI BATTESIMALI
Per una nuova richiesta operativa, conferma la ricezione rispettosa e indica la verifica nei registri della parrocchia. Se il Battesimo risulta qui, la parrocchia trasmetterà prontamente la richiesta all'Ordinario Diocesano con il certificato di Battesimo. La Curia contatterà la persona per un colloquio sulle conseguenze canoniche; se la volontà resta confermata, l'Ordinario emetterà un decreto e la parrocchia annoterà il registro. Se il Battesimo non risulta qui, comunica l'impossibilità di procedere presso questa sede e indica la parrocchia competente solo se conosciuta. L'esito sarà comunicato dopo la verifica.
Il fatto storico del sacramento resta registrato e si annota la volontà di non appartenere più alla Chiesa cattolica. Mantieni il solo colloquio della Curia previsto dalla procedura.
Una domanda informativa richiede spiegazione, non avvio della pratica. Nei seguiti e nelle richieste miste rispondi alle domande residue e al passo attuale; le azioni già compiute richiedono evidenza esplicita.`;
}

/** Fonte procedurale interna condivisa; descrive il flusso, non attesta azioni eseguite. */
function getBaptismAnnotationProcedure_() {
  return `FONTE INTERNA — ANNOTAZIONE NEI REGISTRI BATTESIMALI
Per una nuova richiesta operativa, conferma la ricezione rispettosa e indica la verifica nei registri della parrocchia. Se il Battesimo risulta qui, la parrocchia trasmetterà prontamente la richiesta all'Ordinario Diocesano con il certificato di Battesimo. La Curia contatterà la persona per un colloquio sulle conseguenze canoniche; se la volontà resta confermata, l'Ordinario emetterà un decreto e la parrocchia annoterà il registro. Se il Battesimo non risulta qui, comunica l'impossibilità di procedere presso questa sede e indica la parrocchia competente solo se conosciuta. L'esito sarà comunicato dopo la verifica.
Il fatto storico del sacramento resta registrato e si annota la volontà di non appartenere più alla Chiesa cattolica. Mantieni il solo colloquio della Curia previsto dalla procedura.
Una domanda informativa richiede spiegazione, non avvio della pratica. Nei seguiti e nelle richieste miste rispondi alle domande residue e al passo attuale; le azioni già compiute richiedono evidenza esplicita.`;
}

/** Descrive le esigenze del turno; le citazioni restano dati da riscontrare nelle fonti. */
function normalizeRequestCoverage_(value) {
  const input = value && typeof value === 'object' ? value : {};
  const text = (item, limit) => typeof item === 'string' ? item.trim().slice(0, limit) : '';
  const requests = Array.isArray(input.openRequests) ? input.openRequests : [];
  const seen = new Set();
  const openRequests = [];
  for (const item of requests.slice(0, 24)) {
    if (!item || !text(item.need, 300) || !text(item.evidence, 400)) continue;
    const id = text(item.id, 60) || `r${openRequests.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    openRequests.push({
      id, need: text(item.need, 300), evidence: text(item.evidence, 400),
      role: item.role === 'conditional' ? 'conditional' : 'primary',
      appliesWhen: item.role === 'conditional' ? text(item.appliesWhen, 300) : '',
      source: item.source === 'attachment' ? 'attachment' : 'email'
    });
  }
  return {
    goal: text(input.goal, 400), openRequests,
    extractionTruncated: input.extractionTruncated === true || requests.length > 24
  };
}

function normalizeRelationalPosture_(posture, fallback = 'direct') {
  const raw = String(posture || '').trim().toLowerCase();
  const aliases = {
    informational: 'direct',
    procedural: 'complaint',
    relational: 'personal',
    uncertain: 'hesitant',
    grateful: 'appreciative',
    gratitude: 'appreciative',
    enthusiastic: 'appreciative',
    frustrated: 'complaint',
    frustration: 'complaint',
    angry: 'complaint',
    upset: 'complaint'
  };
  const normalized = aliases[raw] || raw;
  const allowed = new Set([
    'direct', 'personal', 'hesitant', 'complaint', 'open',
    'appreciative', 'urgent', 'none'
  ]);
  if (allowed.has(normalized)) return normalized;

  const normalizedFallback = aliases[String(fallback || '').trim().toLowerCase()] ||
    String(fallback || '').trim().toLowerCase();
  return allowed.has(normalizedFallback) ? normalizedFallback : 'direct';
}

function hasMeaningfulMemoryContext_(memoryContext) {
  if (!memoryContext || typeof memoryContext !== 'object') return false;
  if (memoryContext.exists === true) return true;
  if (memoryContext.lastUpdated || memoryContext.memorySummary || memoryContext.conversationState) return true;
  if (Array.isArray(memoryContext.providedInfo) && memoryContext.providedInfo.length > 0) return true;
  return Boolean(
    memoryContext.contextualFlags &&
    typeof memoryContext.contextualFlags === 'object' &&
    Object.keys(memoryContext.contextualFlags).length > 0
  );
}

function hasStrongerResponseRoutingSignal_(category, requestType, isSbattezzo, physicalPresence, goalContinuity, responseFocus) {
  const normalize = value => String(value || '').trim().toLowerCase();
  return ['formal', 'sbattezzo', 'document_submission', 'document_submission_with_question', 'quotation'].includes(normalize(category)) ||
    ['formal', 'sbattezzo'].includes(normalize(requestType)) ||
    Boolean(isSbattezzo || physicalPresence || goalContinuity || responseFocus);
}

function mapRelationalPostureToResponseStrategy_(posture) {
  const normalized = normalizeRelationalPosture_(posture);
  const mapping = {
    direct: 'provide_information',
    personal: 'offer_reassurance',
    appreciative: 'offer_reassurance',
    open: 'offer_reassurance',
    hesitant: 'clarify_requirements',
    complaint: 'guide_next_step',
    urgent: 'reduce_user_effort'
  };
  return mapping[normalized] || 'none';
}

// Decisioni condivise tra orchestrazione e renderer; non producono testo prompt.
function isResponseFocusApplicable_(state, currentTopic = '', referenceDate = null) {
  if (!state || !['avoid_repeating_known_requirements', 'answer_only_residual_question',
    'provide_next_operational_step', 'acknowledge_document_without_reopening_procedure'].includes(state.responseFocusHint)) return false;
  const settings = typeof CONFIG !== 'undefined' && CONFIG.PROMPT_ENGINE || {};
  const bounded = (value, fallback, min, max) => {
    const number = Number(value);
    return value == null || value === '' || !Number.isFinite(number) ? fallback : Math.max(min, Math.min(max, number));
  };
  const threshold = bounded(settings.RESPONSE_FOCUS_MIN_CONFIDENCE, 0.65, 0, 1);
  const maxAge = bounded(settings.RESPONSE_FOCUS_MAX_AGE_DAYS, 45, 1, 365);
  if (!Number.isFinite(Number(state.responseFocusHintConfidence)) || Number(state.responseFocusHintConfidence) < threshold) return false;
  const normalize = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const topic = normalize(state.appliesToTopic);
  if (topic && normalize(currentTopic) && topic !== normalize(currentTopic)) return false;
  const updated = state.responseFocusHintUpdatedAt || state.updatedAt;
  const age = new Date(referenceDate || Date.now()).getTime() - new Date(updated || '').getTime();
  return Number.isFinite(age) && age >= -300000 && age <= maxAge * 86400000;
}

function normalizePhysicalPresenceState_(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.constraints)) return null;
  const allowed = ['geographic_distance', 'health', 'mobility', 'caregiving', 'legal_restriction',
    'temporary_unavailability', 'remote_request', 'other'];
  const entries = new Map();
  for (const entry of value.constraints.slice(0, 16)) {
    if (!entry || !allowed.includes(entry.type) || !['active', 'resolved'].includes(entry.status)) continue;
    const time = new Date(entry.updatedAt || '').getTime();
    if (!Number.isFinite(time) || time > Date.now() + 300000) continue;
    const previous = entries.get(entry.type);
    if (previous && Date.parse(previous.updatedAt) > time) continue;
    entries.set(entry.type, {type: entry.type, status: entry.status,
      updatedAt: new Date(time).toISOString(),
      policy: entry.policy === 'avoid_invitation' ? 'avoid_invitation' : 'conditional_only',
      source: ['current_message', 'legacy', 'current_resolution'].includes(entry.source) ? entry.source : 'legacy'});
  }
  // Uno stato malformato non deve disattivare il fallback compatibile.
  return entries.size ? {version: 1, constraints: Array.from(entries.values())} : null;
}

function mergePhysicalPresenceState_(existing, incoming) {
  const prior = normalizePhysicalPresenceState_(existing);
  const update = normalizePhysicalPresenceState_(incoming);
  if (!update) return prior;
  return normalizePhysicalPresenceState_({version: 1,
    constraints: [...(prior ? prior.constraints : []), ...update.constraints]});
}

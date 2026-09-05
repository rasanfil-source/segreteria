/**
 * Shared response strategy helpers.
 */

function mapRelationalPostureToResponseStrategy_(posture) {
  const normalized = String(posture || '').trim().toLowerCase();
  const mapping = {
    direct: 'provide_information',
    informational: 'provide_information',
    procedural: 'guide_next_step',
    personal: 'offer_reassurance',
    relational: 'offer_reassurance',
    appreciative: 'offer_reassurance',
    grateful: 'offer_reassurance',
    gratitude: 'offer_reassurance',
    enthusiastic: 'offer_reassurance',
    open: 'offer_reassurance',
    hesitant: 'clarify_requirements',
    uncertain: 'clarify_requirements',
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
  const maxAge = bounded(settings.RESPONSE_FOCUS_MAX_AGE_DAYS, 14, 1, 365);
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
  // Uno stato malformato non deve disattivare il fallback legacy.
  return entries.size ? {version: 1, constraints: Array.from(entries.values())} : null;
}

function mergePhysicalPresenceState_(existing, incoming) {
  const prior = normalizePhysicalPresenceState_(existing);
  const update = normalizePhysicalPresenceState_(incoming);
  if (!update) return prior;
  return normalizePhysicalPresenceState_({version: 1,
    constraints: [...(prior ? prior.constraints : []), ...update.constraints]});
}

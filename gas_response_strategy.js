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

// Riferimento stabile del confronto: le richieste operative ricevono una presa in carico incondizionata.
module.exports = function renderBaselineRequestPurposePolicy(requestPurpose) {
  const purpose = this._normalizeRequestPurpose_(requestPurpose);
  if (!purpose) return null;
  const policies = {
    information_request: 'Rispondi alle domande aperte con la sola procedura pertinente; non aggiungere passaggi accessori non richiesti.',
    operational_request: 'Accogli la richiesta concreta con un breve riscontro di ricezione e presa in carico. Mantieni la conferma su questo piano, senza attestare l’esecuzione, anticipare esiti o tempi né esprimere incertezza sul seguito.',
    status_update: 'Dai un breve riscontro al contenuto concreto comunicato, coerente con il suo scopo, e indica soltanto l’eventuale conseguenza o prossimo passo necessario.',
    acknowledgment: 'Rispondi in modo breve e proporzionato senza riaprire argomenti, requisiti o procedure.',
    mixed: 'Conferma ricezione e presa in carico, senza attestare esecuzione, anticipare esiti o tempi né esprimere incertezza; rispondi alle sole domande ancora aperte.'
  };
  return `## SCOPO DEL MESSAGGIO (VINCOLANTE)\nTipo: ${purpose.type}\nConfidenza: ${purpose.confidence.toFixed(2)}\n- ${policies[purpose.type]}\n- Questa classificazione rappresenta l'intento concreto dell'email ed e distinta dall'argomento/topic. Applica questa logica PRIMA di scegliere quali fatti della KB usare.\n- Non nominare questa classificazione nella risposta.`;
};

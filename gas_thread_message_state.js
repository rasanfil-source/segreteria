/** Owns the selected messages and the once-only marking lifecycle of one thread.
 * Only label operations are injected. Candidate/context changes remain visible if a phase throws.
 * This is message bookkeeping, not a shared pipeline context.
 */
var ThreadMessageState = {
  create(deps, { thread, labeledMessageIds, skippedMessageIds }) {
    let candidate = null;
    let externalUnread = [];
    let responseContextMessageIds = new Set();
    let responseContextMessages = [];
    const setResponseContextMessages = (messagesForResponse) => {
      const source = Array.isArray(messagesForResponse) ? messagesForResponse : [];
      responseContextMessageIds = new Set();
      responseContextMessages = [];
      source.forEach((message) => {
        if (!message || typeof message.getId !== 'function') return;
        const messageId = message.getId();
        if (!messageId || responseContextMessageIds.has(messageId)) return;
        responseContextMessageIds.add(messageId);
        responseContextMessages.push(message);
      });
      if (candidate && typeof candidate.getId === 'function') {
        const candidateId = candidate.getId();
        if (candidateId && !responseContextMessageIds.has(candidateId)) {
          responseContextMessageIds.add(candidateId);
          responseContextMessages.push(candidate);
        }
      }
    };
    const isInResponseContext = (message) => (
      message &&
      typeof message.getId === 'function' &&
      responseContextMessageIds.has(message.getId())
    );
    let markHandledUnread = () => { };
    let handledUnreadMarked = false;
    const markHandledUnreadOnce = () => {
      if (handledUnreadMarked) return;
      markHandledUnread();
      handledUnreadMarked = true;
    };
    const markFailureForCurrentBurst = (labelType, reviewContext = {}, markHandled = true) => {
      const targets = (responseContextMessages && responseContextMessages.length > 0)
        ? responseContextMessages
        : (candidate ? [candidate] : []);

      if (targets.length === 0) {
        deps._addErrorLabel(thread);
        return;
      }

      targets.forEach((message) => {
        if (labelType === 'validation') {
          deps._addValidationErrorLabel(message, reviewContext);
        } else {
          deps._addErrorLabel(message);
        }
        if (markHandled) deps._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds);
        else if (labeledMessageIds) labeledMessageIds.add(message.getId());
      });
    };
    return {
      get candidate() { return candidate; },
      set candidate(value) { candidate = value; },
      get externalUnread() { return externalUnread; },
      set externalUnread(value) { externalUnread = value; },
      get responseContextMessageIds() { return responseContextMessageIds; },
      get responseContextMessages() { return responseContextMessages; },
      get markHandledUnread() { return markHandledUnread; },
      set markHandledUnread(value) { markHandledUnread = value; },
      setResponseContextMessages,
      isInResponseContext,
      markHandledUnreadOnce,
      markFailureForCurrentBurst,
    };
  }
};

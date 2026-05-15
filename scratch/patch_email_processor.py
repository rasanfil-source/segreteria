import sys

file_path = 'gas_email_processor.js'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 1. Update constructor
for i, line in enumerate(lines):
    if 'this.gmailService = options.gmailService || new GmailService();' in line:
        if 'this._scriptTimeZone = null;' not in lines[i+1]:
            lines.insert(i+1, '    this._scriptTimeZone = null;\n')
        break

# 2. Update burst logic (already partially patched, let's fix it properly)
# I'll just look for the block and replace it.
content = "".join(lines)

old_burst = """      if (externalUnread.length > 1) {
        const candidateSenderEmail = this._normalizeEmailAddress_(messageDetails.senderEmail || '');
        const candidateId = candidate.getId();
        const aggregatedBody = externalUnread.map((message) => {
          const details = (message.getId() === candidateId
            ? messageDetails
            : this.gmailService.extractMessageDetails(message)) || {};
          const messageDate = (() => {
            if (!(details.date instanceof Date)) return 'data non disponibile';
            if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
              try {
"""

new_burst = """      if (externalUnread.length > 1) {
        const candidateId = candidate.getId();
        const candidateSenderEmail = this._normalizeEmailAddress_(messageDetails.senderEmail || '');
        const burstMessages = externalUnread.filter((message) => {
          if (!candidateSenderEmail || !message || typeof message.getFrom !== 'function') return message && message.getId && message.getId() === candidateId;
          const rawFrom = message.getFrom() || '';
          const sender = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
            ? this.gmailService._extractEmailAddress(rawFrom)
            : rawFrom;
          return this._normalizeEmailAddress_(sender || '') === candidateSenderEmail;
        });
        const aggregatedBody = burstMessages.map((message) => {
          const details = (message.getId() === candidateId
            ? messageDetails
            : this.gmailService.extractMessageDetails(message)) || {};
          const messageDate = (() => {
            if (!(details.date instanceof Date)) return 'data non disponibile';
            if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
              try {
"""
# Note: the above might fail if the file content is different.
# I'll use a more robust way: find the start and end of the block.

# 3. Update _shouldIgnoreEmail (clean up the mess I might have made)
# I'll just overwrite the whole function in the file content.

import re

ignore_pattern = re.compile(r'  _shouldIgnoreEmail\(messageDetails\) \{.*?    return false;\n  \}', re.DOTALL)
new_ignore = """  _shouldIgnoreEmail(messageDetails) {
    const email = this._normalizeEmailAddress_(messageDetails.senderEmail || '');
    const subject = (messageDetails.subject || '').toLowerCase();
    const body = (messageDetails.body || '').toLowerCase();

    // 1. Controllo Blacklist Domini/Email
    // NOTA: GLOBAL_CACHE.ignoreDomains include già CONFIG.IGNORE_DOMAINS (merge in _loadAdvancedConfig)
    const ignoreDomainsArray = (typeof GLOBAL_CACHE !== 'undefined' && Array.isArray(GLOBAL_CACHE.ignoreDomains))
      ? GLOBAL_CACHE.ignoreDomains
      : ((typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.IGNORE_DOMAINS)) ? CONFIG.IGNORE_DOMAINS : []);
    const ignoreDomains = ignoreDomainsArray
      .map(d => String(d == null ? '' : d).trim().toLowerCase())
      .filter(Boolean);

    const atIndex = email.lastIndexOf('@');
    const localPart = atIndex >= 0 ? email.substring(0, atIndex) : email;
    const senderDomain = atIndex >= 0 ? email.substring(atIndex + 1) : '';

    if (ignoreDomains.some(domain => {
      const blacklistDomain = domain.startsWith('@') ? domain.substring(1) : domain;
      const isExactMatch = email === domain;
      const isDomainMatch = (domain.startsWith('@') || !domain.includes('@')) && senderDomain === blacklistDomain;
      const isSubdomainMatch = !domain.startsWith('@') && !domain.includes('@') &&
        senderDomain.endsWith('.' + blacklistDomain);
      return isExactMatch || isDomainMatch || isSubdomainMatch;
    })) {
      console.log(`🚫 Ignorato: mittente in blacklist (${email})`);
      return true;
    }

    // Match username ristretto a pattern bot/notifica espliciti per evitare falsi positivi
    // su username legittimi (es. marketing@..., info@...).
    const BOT_USERNAMES = new Set(['noreply', 'no-reply', 'donotreply', 'mailer-daemon',
      'postmaster', 'bounce', 'notifications', 'newsletter', 'promo',
      'ads', 'bot', 'crm']);
    if (BOT_USERNAMES.has(localPart)) {
      console.log(`🚫 Ignorato: username di sistema/bot rilevato (${email})`);
      return true;
    }

    // 2. Controllo Keyword Oggetto/Corpo
    // NOTA: GLOBAL_CACHE.ignoreKeywords include già CONFIG.IGNORE_KEYWORDS (merge in _loadAdvancedConfig)
    const ignoreKeywordsArray = (typeof GLOBAL_CACHE !== 'undefined' && Array.isArray(GLOBAL_CACHE.ignoreKeywords))
      ? GLOBAL_CACHE.ignoreKeywords
      : ((typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.IGNORE_KEYWORDS)) ? CONFIG.IGNORE_KEYWORDS : []);
    const ignoreKeywords = ignoreKeywordsArray
      .map(k => String(k == null ? '' : k).trim().toLowerCase())
      .filter(Boolean);

    if (ignoreKeywords.some(keyword => subject.includes(keyword) || body.includes(keyword))) {
      console.log(`🚫 Ignorato: oggetto o corpo contiene keyword vietata`);
      return true;
    }

    // 3. Controllo Auto-reply e Notifiche (Standard)
    // NOTA: no-reply/noreply sono anche controllati in STEP 0.8 (defense-in-depth).
    // Qui manteniamo un set più mirato (segnali "sistemici" su sender/subject/body) per
    // ridurre falsi positivi rispetto al filtro preliminare regex più ampio.
    if (
      email.includes('no-reply') ||
      email.includes('noreply') ||
      email.includes('mailer-daemon') ||
      email.includes('postmaster') ||
      email.includes('notification@') ||
      email.includes('notifications@') ||
      // Filtro per evitare falsi positivi su indirizzi contenenti 'alert'.
      email.includes('alert@') || email.includes('alerts@') ||
      subject.includes('delivery status notification') ||
      subject.includes('automatic reply') ||
      subject.includes('fuori sede') ||
      subject.includes('out of office') ||
      body.includes('this is an automatically generated message') ||
      body.includes('do not reply to this email')
    ) {
      console.log('🚫 Ignorato: auto-reply o notifica di sistema');
      return true;
    }

    return false;
  }"""

content = ignore_pattern.sub(new_ignore, content)

# 4. Add _getCachedTimeZone and update _getBusinessDateString
if '_getCachedTimeZone()' not in content:
    old_date_fn = """  _getBusinessDateString(date = new Date()) {
    const parsedDate = (date instanceof Date) ? date : new Date(date);
    if (isNaN(parsedDate.getTime())) return '';

    if (typeof Utilities !== 'undefined' && Utilities &&
        typeof Utilities.formatDate === 'function') {
      try {
        const tz = (typeof Session !== 'undefined' && Session &&
                    typeof Session.getScriptTimeZone === 'function')
          ? Session.getScriptTimeZone()
          : 'Europe/Rome';
        return Utilities.formatDate(parsedDate, tz, 'yyyy-MM-dd');
      } catch (_) {
        // Fallback sotto
      }
    }"""
    
    new_date_fn = """  _getCachedTimeZone() {
    if (this._scriptTimeZone) return this._scriptTimeZone;

    this._scriptTimeZone = (typeof Session !== 'undefined' && Session &&
        typeof Session.getScriptTimeZone === 'function')
      ? Session.getScriptTimeZone()
      : 'Europe/Rome';
    return this._scriptTimeZone;
  }

  _getBusinessDateString(date = new Date()) {
    const parsedDate = (date instanceof Date) ? date : new Date(date);
    if (isNaN(parsedDate.getTime())) return '';

    if (typeof Utilities !== 'undefined' && Utilities &&
        typeof Utilities.formatDate === 'function') {
      try {
        return Utilities.formatDate(parsedDate, this._getCachedTimeZone(), 'yyyy-MM-dd');
      } catch (_) {
        // Fallback sotto
      }
    }"""
    content = content.replace(old_date_fn, new_date_fn)

# 5. Fix burst logic mapping
content = content.replace("        const aggregatedBody = externalUnread.map((message) => {", "        const burstMessages = externalUnread.filter((message) => {\n          if (!candidateSenderEmail || !message || typeof message.getFrom !== 'function') return message && message.getId && message.getId() === candidateId;\n          const rawFrom = message.getFrom() || '';\n          const sender = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')\n            ? this.gmailService._extractEmailAddress(rawFrom)\n            : rawFrom;\n          return this._normalizeEmailAddress_(sender || '') === candidateSenderEmail;\n        });\n        const aggregatedBody = burstMessages.map((message) => {")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

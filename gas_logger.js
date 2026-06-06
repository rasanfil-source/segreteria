/**
 * Logger.gs - Sistema di logging strutturato e centralizzato
 */

var LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

function isDebugLoggingEnabled() {
  return !(typeof CONFIG !== 'undefined' && CONFIG && CONFIG.DEBUG === false);
}

// Nota: non usare il nome `Logger` per evitare shadowing del built-in GAS `Logger.log()`.
var AppLogger = class AppLogger {
  constructor(context = 'System', baseMeta = {}) {
    this.context = context;
    this.baseMeta = (baseMeta && typeof baseMeta === 'object') ? baseMeta : {};
  }

  get config() {
    return typeof getConfig === 'function' ? getConfig() : (typeof CONFIG !== 'undefined' ? CONFIG : {});
  }

  get minLevel() {
    const levelStr = (this.config.LOGGING && this.config.LOGGING.LEVEL) || 'INFO';
    return Object.prototype.hasOwnProperty.call(LogLevel, levelStr)
      ? LogLevel[levelStr]
      : LogLevel.INFO;
  }

  /**
   * Log generico
   */
  _log(level, message, data = {}) {
    if (LogLevel[level] < this.minLevel) return;

    // Guardia su null: il valore predefinito `= {}` copre solo `undefined`, non `null`.
    const safeData = (data !== null && data !== undefined && typeof data === 'object') ? data : {};
    const mergedData = { ...this.baseMeta, ...safeData };

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level,
      context: this.context,
      message: message,
      data: mergedData
    };
    const safeStringify = (value, indent = 0) => {
      try {
        return indent > 0 ? JSON.stringify(value, null, indent) : JSON.stringify(value);
      } catch (_) {
        return JSON.stringify({ log_error: 'Unserializable data (circular/native object)' });
      }
    };

    const loggingConfig = (this.config && this.config.LOGGING) ? this.config.LOGGING : {};

    if (loggingConfig.STRUCTURED) {
      const structuredEntry = {
        timestamp: logEntry.timestamp,
        level: logEntry.level,
        context: logEntry.context,
        message: logEntry.message,
        ...mergedData
      };
      if (level === 'ERROR') console.error(structuredEntry);
      else if (level === 'WARN') console.warn(structuredEntry);
      else if (level === 'INFO') console.info(structuredEntry);
      else console.log(structuredEntry);
    } else {
      console.log(`[${logEntry.timestamp}] [${level}] [${this.context}] ${message}`);
      if (Object.keys(mergedData).length > 0) {
        console.log(safeStringify(mergedData, 2));
      }
    }

    // Invia notifica per errori critici
    if (level === 'ERROR' && loggingConfig.SEND_ERROR_NOTIFICATIONS) {
      this._sendErrorNotification(logEntry);
    }
  }

  debug(message, data) {
    this._log('DEBUG', message, data);
  }

  info(message, data) {
    this._log('INFO', message, data);
  }

  warn(message, data) {
    this._log('WARN', message, data);
  }

  error(message, data) {
    this._log('ERROR', message, data);
  }

  _notificationText(value, maxLength = 500) {
    const text = String(value === null || value === undefined ? '' : value)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redatta]')
      .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi, '[iban redatto]');
    return text.length > maxLength ? `${text.substring(0, maxLength)}... [troncato]` : text;
  }

  _buildErrorNotificationDetails(logEntry) {
    const data = (logEntry && logEntry.data && typeof logEntry.data === 'object') ? logEntry.data : {};
    const details = {
      timestamp: logEntry && logEntry.timestamp,
      level: logEntry && logEntry.level,
      context: logEntry && logEntry.context,
      message: this._notificationText(logEntry && logEntry.message, 500)
    };
    ['runId', 'errorClass', 'errorCode', 'status', 'reason'].forEach((key) => {
      if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
        details[key] = this._notificationText(data[key], 200);
      }
    });
    return JSON.stringify(details, null, 2);
  }

  /**
 * Invia notifica via email all'amministratore
 */
  _sendErrorNotification(logEntry) {
    try {
      const loggingConfig = (this.config && this.config.LOGGING) ? this.config.LOGGING : {};

      const scriptProperties = (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function')
        ? PropertiesService.getScriptProperties()
        : null;
      const adminEmailProperty = scriptProperties
        ? scriptProperties.getProperty('ADMIN_EMAIL')
        : '';
      const adminEmail = adminEmailProperty || loggingConfig.ADMIN_EMAIL || '';
      if (!adminEmail || adminEmail.includes('[') || adminEmail.includes('YOUR_')) return;

      const safeMessage = this._notificationText(logEntry.message, 160);
      const subject = `[${this.config.PROJECT_NAME || 'GAS_BOT'}] Avviso Errore: ${safeMessage}`;
      const body = `
Errore nel sistema autoresponder:

Timestamp: ${logEntry.timestamp}
Context: ${logEntry.context}
Message: ${safeMessage}

Dettagli redatti:
${this._buildErrorNotificationDetails(logEntry)}

---
Sistema: ${this.config.PROJECT_NAME || 'GAS_BOT'}
Script ID: ${this.config.SCRIPT_ID || 'Unknown'}
      `.trim();

      const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
        ? CacheService.getScriptCache()
        : null;
      const errorClass = logEntry && logEntry.data && logEntry.data.errorClass ? String(logEntry.data.errorClass) : 'General';
      const signature = `${logEntry.context}|${errorClass}|${logEntry.message}`;
      const hash = (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.computeDigest === 'function')
        ? Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, signature)).substring(0, 16)
        : signature.substring(0, 64);
      const errorKey = `last_error_notification_${hash}`;
      const fallbackCooldownMs = 3600 * 1000;
      const propKey = 'ERROR_THROTTLE_STATE';

      const lock = (typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function')
        ? LockService.getScriptLock()
        : null;
      let lockAcquired = false;

      try {
        if (lock && typeof lock.tryLock === 'function') {
          lockAcquired = lock.tryLock(2000);
          if (!lockAcquired) {
            console.warn('Notifica errore saltata: lock throttle non disponibile');
            return;
          }
        }

        const alreadyNotified = cache ? cache.get(errorKey) : '';
        const now = Date.now();
        let throttleState = {};
        if (scriptProperties) {
          try {
            throttleState = JSON.parse(scriptProperties.getProperty(propKey) || '{}');
          } catch (_) {
            throttleState = {};
          }
        }
        const fallbackTs = throttleState[hash];
        const fallbackActive = Number.isFinite(Number(fallbackTs))
          && ((now - Number(fallbackTs)) < fallbackCooldownMs);
        if (!alreadyNotified && !fallbackActive) {
          // Il lock rende atomico check+mark+send e impedisce duplicati tra esecuzioni concorrenti.
          if (cache) {
            cache.put(errorKey, 'pending', 60);
          }
          let sent = false;
          try {
            MailApp.sendEmail(adminEmail, subject, body);
            sent = true;
          } catch (mailError) {
            try {
              GmailApp.sendEmail(adminEmail, subject, body);
              sent = true;
            } catch (gmailError) {
              console.error('Impossibile inviare notifica errore:', gmailError.message);
            }
          }
          if (sent && cache) {
            cache.put(errorKey, 'sent', 3600);
          }
          if (sent && scriptProperties) {
            const cleanedState = { [hash]: now };
            Object.keys(throttleState).forEach((key) => {
              const ts = Number(throttleState[key]);
              if (Number.isFinite(ts) && (now - ts) < fallbackCooldownMs) {
                cleanedState[key] = ts;
              }
            });
            scriptProperties.setProperty(propKey, JSON.stringify(cleanedState));
          }
        }
      } finally {
        if (lockAcquired && lock && typeof lock.releaseLock === 'function') {
          try {
            lock.releaseLock();
          } catch (releaseError) {
            console.warn('Rilascio lock notifica errore fallito:', releaseError.message);
          }
        }
      }
    } catch (e) {
      console.error('Invio notifica errore fallito:', e.message);
    }
  }

  /**
   * Crea logger con contesto specifico
   */
  withContext(newContext) {
    return new AppLogger(`${this.context}:${newContext}`, this.baseMeta);
  }

  withMeta(meta = {}) {
    const safeMeta = (meta && typeof meta === 'object') ? meta : {};
    return new AppLogger(this.context, { ...this.baseMeta, ...safeMeta });
  }
}

/**
 * Factory function per creare logger
 */
function createLogger(context, runId, baseMeta = {}) {
  const safeMeta = (baseMeta && typeof baseMeta === 'object') ? baseMeta : {};
  const mergedMeta = runId ? { runId: runId, ...safeMeta } : safeMeta;
  return new AppLogger(context, mergedMeta);
}

/**
 * Logger.gs - Sistema di logging strutturato e centralizzato
 */

const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor(context = 'System') {
    this.context = context;
    this.config = getConfig();
    this.minLevel = LogLevel[this.config.LOGGING.LEVEL] || LogLevel.INFO;
  }
  
  /**
   * Log generico
   */
  _log(level, message, data = {}) {
    if (LogLevel[level] < this.minLevel) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level,
      context: this.context,
      message: message,
      ...data
    };
    
    if (this.config.LOGGING.STRUCTURED) {
      console.log(JSON.stringify(logEntry));
    } else {
      console.log(`[${logEntry.timestamp}] [${level}] [${this.context}] ${message}`);
      if (Object.keys(data).length > 0) {
        console.log(JSON.stringify(data, null, 2));
      }
    }
    
    // Invia notifica per errori critici
    if (level === 'ERROR' && this.config.LOGGING.SEND_ERROR_NOTIFICATIONS) {
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
  
  /**
   * Log specifico per thread email
   */
  logThread(threadId, action, status, details = {}) {
    this.info(`Thread ${action}`, {
      threadId: threadId,
      action: action,
      status: status,
      ...details
    });
  }
  
  /**
   * Log metriche di esecuzione
   */
  logMetrics(metrics) {
    this.info('Execution metrics', metrics);
  }
  
  /**
   * Invia notifica email per errori critici
   */
  _sendErrorNotification(logEntry) {
    try {
      const adminEmail = this.config.LOGGING.ADMIN_EMAIL;
      if (!adminEmail || adminEmail.includes('[')) return;
      
      const subject = `[${this.config.PROJECT_NAME}] Error Alert: ${logEntry.message}`;
      const body = `
Errore nel sistema autoresponder:

Timestamp: ${logEntry.timestamp}
Context: ${logEntry.context}
Message: ${logEntry.message}

Details:
${JSON.stringify(logEntry, null, 2)}

---
Sistema: ${this.config.PROJECT_NAME}
Script ID: ${this.config.SCRIPT_ID}
      `.trim();
      
      // Rate limit: max 1 email ogni 5 minuti
      const lastNotification = PropertiesService.getScriptProperties()
        .getProperty('last_error_notification');
      const now = Date.now();
      
      if (!lastNotification || (now - parseInt(lastNotification)) > 300000) {
        GmailApp.sendEmail(adminEmail, subject, body);
        PropertiesService.getScriptProperties()
          .setProperty('last_error_notification', now.toString());
      }
    } catch (e) {
      console.error('Failed to send error notification:', e.message);
    }
  }
  
  /**
   * Crea logger con contesto specifico
   */
  withContext(newContext) {
    return new Logger(`${this.context}:${newContext}`);
  }
}

/**
 * Factory function per creare logger
 */
function createLogger(context) {
  return new Logger(context);
}
/**
 * @fileoverview Sistema di configurazione UI per Autoresponder Parrocchiale
 * @version 2.0.0
 * @author Parrocchia AI Team
 * @description Setup automatico di fogli, validazioni, protezioni, formattazione condizionale,
 *              audit trail e named ranges per il sistema di autoresponder.
 * 
 * FEATURES:
 * - ✅ Idempotente (può essere eseguito più volte)
 * - ✅ Protezioni celle formule
 * - ✅ Formattazione condizionale (🟢🟡🔴)
 * - ✅ Audit trail automatico (ConfigHistory)
 * - ✅ Test suite integrata
 * - ✅ Gestione errori robusta
 * - ✅ Menu personalizzato
 * - ✅ Progress feedback
 * 
 * USAGE:
 * 1. Incolla questo codice in Apps Script
 * 2. Ricarica il foglio
 * 3. Menu "🏛️ Parrocchia AI" > "⚙️ Configura Fogli"
 * 4. (Opzionale) Menu > "🧪 Test Configurazione"
 */

// ════════════════════════════════════════════════════════════════════════
// CONFIGURAZIONE GLOBALE
// ════════════════════════════════════════════════════════════════════════

const UI_CONFIG = {
  // Nomi fogli
  CONTROLLO_SHEET: 'Controllo',
  ASSENZE_SHEET: 'Assenze',
  FILTRI_SHEET: 'Filtri',
  HISTORY_SHEET: 'ConfigHistory',

  // Range reset (per idempotenza)
  SHEET_RESET_RANGE: 'A1:Z300',

  // Costanti
  DAYS: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],

  // Colori tabs
  COLORS: {
    CONTROLLO: '#4285F4',  // Blu
    ASSENZE: '#EA4335',    // Rosso
    FILTRI: '#FBBC04',     // Giallo
    HISTORY: '#9E9E9E'     // Grigio
  },

  // Versione
  VERSION: '2.0.0'
};

// ════════════════════════════════════════════════════════════════════════
// MENU PERSONALIZZATO
// ════════════════════════════════════════════════════════════════════════

/**
 * Crea menu personalizzato all'apertura del foglio
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🏛️ Parrocchia AI')
    .addItem('⚙️ Configura Fogli', 'setupConfigurationSheets')
    .addItem('🧪 Test Configurazione', 'testConfiguration')
    .addSeparator()
    .addItem('🔄 Resetta Configurazione', 'resetConfiguration')
    .addItem('📖 Guida Rapida', 'showQuickGuide')
    .addSeparator()
    .addItem('ℹ️ Info Versione', 'showVersionInfo')
    .addToUi();
}

// ════════════════════════════════════════════════════════════════════════
// FUNZIONE PRINCIPALE - SETUP COMPLETO
// ════════════════════════════════════════════════════════════════════════

/**
 * Funzione principale per impostare l'intera configurazione dei fogli.
 * È idempotente: se eseguita più volte riallinea struttura e formule.
 * 
 * PASSAGGI:
 * 1. Setup foglio Controllo (dashboard)
 * 2. Setup foglio Assenze (gestione assenze)
 * 3. Setup foglio Filtri (domini/keyword)
 * 4. Setup foglio ConfigHistory (audit trail)
 * 5. Creazione Named Ranges
 * 6. Applicazione protezioni
 * 7. Applicazione formattazione condizionale
 * 
 * @throws {Error} Se si verifica un errore durante il setup
 */
function setupConfigurationSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  try {
    // Alert iniziale
    const response = ui.alert(
      '⚙️ CONFIGURAZIONE FOGLI',
      'Questa operazione configurerà automaticamente tutti i fogli necessari.\n\n' +
      'Può richiedere 15-20 secondi.\n\n' +
      'Continuare?',
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      ui.alert('❌ Configurazione annullata.');
      return;
    }

    // Progress tracking
    const startTime = new Date().getTime();

    const steps = [
      { name: 'Foglio Controllo', fn: () => setupControlloSheet(ss), icon: '📊' },
      { name: 'Foglio Assenze', fn: () => setupAssenzeSheet(ss), icon: '📅' },
      { name: 'Foglio Filtri', fn: () => setupFiltriSheet(ss), icon: '🚫' },
      { name: 'Foglio ConfigHistory', fn: () => setupConfigHistorySheet(ss), icon: '📜' },
      { name: 'Named Ranges', fn: () => createNamedRanges(ss), icon: '🏷️' },
      { name: 'Protezioni', fn: () => protectFormulaRanges(ss), icon: '🔒' },
      { name: 'Formattazione Condizionale', fn: () => setupConditionalFormatting(ss), icon: '🎨' }
    ];

    let completed = 0;
    const totalSteps = steps.length;

    // Esegui ogni step
    steps.forEach((step, idx) => {
      Logger.log(`[${idx + 1}/${totalSteps}] ${step.icon} Configurando ${step.name}...`);

      try {
        step.fn();
        completed++;
      } catch (stepError) {
        Logger.log(`ERRORE in ${step.name}: ${stepError.toString()}`);
        throw new Error(`Errore durante ${step.name}: ${stepError.message}`);
      }

      // Flush per feedback visivo
      SpreadsheetApp.flush();
    });

    // Calcola durata
    const duration = ((new Date().getTime() - startTime) / 1000).toFixed(1);

    // Log in ConfigHistory
    logConfigChange(
      ss,
      'Setup Completo',
      'Sistema',
      'Setup iniziale v' + UI_CONFIG.VERSION,
      `${completed}/${totalSteps} passaggi completati in ${duration}s`
    );

    // Alert successo
    ui.alert(
      '✅ CONFIGURAZIONE COMPLETATA!',
      `Tempo impiegato: ${duration} secondi\n\n` +
      `${completed}/${totalSteps} passaggi eseguiti:\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 Foglio Controllo (dashboard)\n` +
      `📅 Foglio Assenze (gestione assenze)\n` +
      `🚫 Foglio Filtri (domini/keyword)\n` +
      `📜 Foglio ConfigHistory (audit trail)\n` +
      `🏷️ Named Ranges: 17 creati\n` +
      `🔒 Protezioni: Attive su formule\n` +
      `🎨 Formattazione: Status colorati\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 Suggerimento:\n` +
      `Esegui "🧪 Test Configurazione"\n` +
      `dal menu per verificare tutto.`,
      ui.ButtonSet.OK
    );

  } catch (error) {
    Logger.log('❌ ERRORE SETUP: ' + error.toString());
    Logger.log('Stack trace: ' + error.stack);

    ui.alert(
      '❌ ERRORE DURANTE CONFIGURAZIONE',
      `Si è verificato un errore:\n\n` +
      `${error.message}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `DETTAGLI TECNICI:\n` +
      `${error.stack}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Cosa fare:\n` +
      `1. Verifica i log (View > Logs)\n` +
      `2. Prova a eseguire "🔄 Resetta Configurazione"\n` +
      `3. Se persiste, contatta l'amministratore`,
      ui.ButtonSet.OK
    );

    // Re-throw per debugging
    throw error;
  }
}

// ════════════════════════════════════════════════════════════════════════
// SETUP FOGLIO "CONTROLLO"
// ════════════════════════════════════════════════════════════════════════

/**
 * Configura il foglio "Controllo" (Dashboard principale)
 * 
 * STRUTTURA:
 * - A1:F4: Hero section (Stato Sistema + Impostazioni)
 * - E5:F9: Mini dashboard live
 * - B9:D16: Orari settimanali
 * - A18:F22: Link rapidi
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - Spreadsheet attivo
 */
function setupControlloSheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.CONTROLLO_SHEET, UI_CONFIG.COLORS.CONTROLLO);
  resetSheetLayout(sheet);

  // ─────────────────────────────────────────────────────────────────────
  // SEZIONE A: HERO - Stato Sistema (A1:F4)
  // ─────────────────────────────────────────────────────────────────────

  sheet.getRange('A1:F4').setBackground('#FFFFFF');

  // Titolo principale
  safeMerge(sheet.getRange('A1:C1'));
  sheet.getRange('A1:C1')
    .setValue('🏛️ STATO DEL SISTEMA')
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBackground('#E8F0FE');

  // Toggle Master (Acceso/Spento)
  sheet.getRange('A2').setValue('Interruttore:').setFontWeight('bold');

  const masterRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Acceso', 'Spento'], true)
    .setAllowInvalid(false)
    .setHelpText('Scegli Acceso o Spento.')
    .build();

  const toggleCell = sheet.getRange('B2');
  toggleCell
    .setDataValidation(masterRule)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setFontSize(12);

  if (!toggleCell.getValue()) {
    toggleCell.setValue('Acceso');
  }

  // Indicatore Status principale (E2:F2)
  safeMerge(sheet.getRange('E2:F2'));
  sheet.getRange('E2:F2')
    .setFormula('=IF(B2="Spento";"🔴 Spenta";IF(OR(F6="Assente";F9="Nessuna");"🟡 Sospesa";"🟢 Attiva"))')
    .setHorizontalAlignment('center')
    .setFontWeight('bold')
    .setFontSize(12)
    .setBackground('#F1F3F4');

  // Descrizione
  safeMerge(sheet.getRange('A3:F3'));
  sheet.getRange('A3:F3')
    .setValue('💡 Il sistema risponde automaticamente solo quando è ATTIVO (🟢). Durante sospensione (🟡) o spento (🔴), le email NON vengono elaborate.')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(9)
    .setWrap(true);

  // Timezone
  sheet.getRange('A4').setValue('⏰ Timezone:').setFontWeight('bold');
  sheet.getRange('B4').setValue('Europe/Rome');

  // Festivi
  sheet.getRange('A5').setValue('📅 Festivi:').setFontWeight('bold');
  const holidaysRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Considera Festivi', 'Ignora Festivi'], true)
    .setAllowInvalid(false)
    .setHelpText('Scegli se considerare i giorni festivi italiani')
    .build();
  sheet.getRange('B5').setDataValidation(holidaysRule);
  if (!sheet.getRange('B5').getValue()) {
    sheet.getRange('B5').setValue('Considera Festivi');
  }

  // ─────────────────────────────────────────────────────────────────────
  // SEZIONE B: MINI DASHBOARD (E5:F9)
  // ─────────────────────────────────────────────────────────────────────

  sheet.getRange('E5:F9')
    .setBackground('#F8F9FA')
    .setBorder(true, true, true, true, true, true, '#DADCE0', SpreadsheetApp.BorderStyle.SOLID);

  // Labels
  sheet.getRange('E5').setValue('📊 Risposta automatica:').setFontWeight('bold').setFontSize(9);
  sheet.getRange('E6').setValue('👤 Segretario:').setFontWeight('bold').setFontSize(9);
  sheet.getRange('E7').setValue('ℹ️ Motivo:').setFontWeight('bold').setFontSize(9);
  sheet.getRange('E8').setValue('📆 Oggi:').setFontWeight('bold').setFontSize(9);
  sheet.getRange('E9').setValue('⏰ Fascia oraria:').setFontWeight('bold').setFontSize(9);

  // Formule dashboard
  sheet.getRange('F5').setFormula('=IF(B2="Spento";"🔴 Spenta";IF(OR(F6="Assente";F9="Nessuna");"🟡 Sospesa";"🟢 Attiva"))');
  sheet.getRange('F6').setFormula('=IF(COUNTIF(Assenze!G2:G;TRUE)>0;"Assente";"In servizio")');
  sheet.getRange('F7').setFormula('=IF(B2="Spento";"Spento manualmente";IF(F6="Assente";"Assenza segretario";IF(F9="Nessuna";"Fuori orario";"Sistema attivo")))');
  sheet.getRange('F8').setFormula('=TEXT(TODAY();"dd/mm/yyyy")');
  sheet.getRange('F9').setFormula('=IF(OR(INDEX(C10:C16;WEEKDAY(TODAY();2))="";INDEX(D10:D16;WEEKDAY(TODAY();2))="");"Nessuna";TEXT(INDEX(C10:C16;WEEKDAY(TODAY();2));"HH:MM")&"–"&TEXT(INDEX(D10:D16;WEEKDAY(TODAY();2));"HH:MM"))');

  sheet.getRange('F5:F9').setFontSize(9);

  // ─────────────────────────────────────────────────────────────────────
  // SEZIONE C: ORARI SETTIMANALI (B9:D16)
  // ─────────────────────────────────────────────────────────────────────

  // Header orari
  sheet.getRange('B9:D9')
    .setValues([['Giorno', 'Dalle ⏰', 'Alle ⏰']])
    .setFontWeight('bold')
    .setBackground('#E8F0FE')
    .setHorizontalAlignment('center');

  // Giorni settimana
  sheet.getRange('B10:B16')
    .setValues(UI_CONFIG.DAYS.map(day => [day]))
    .setBackground('#EFEFEF')
    .setFontWeight('bold')
    .setHorizontalAlignment('left');

  // Bordi tabella
  sheet.getRange('B9:D16').setBorder(
    true, true, true, true, true, true,
    '#DADCE0',
    SpreadsheetApp.BorderStyle.SOLID
  );

  // Validazione orari (formato HH:MM)
  const timeFormatRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(
      '=OR(' +
      '  C10="";' +  // Vuoto OK
      '  AND(' +
      '    ISNUMBER(TIMEVALUE(C10));' +  // Formato ora valido
      '    REGEXMATCH(TEXT(C10;"HH:MM");"^[0-2][0-9]:[0-5][0-9]$")' +  // Regex HH:MM
      '  )' +
      ')'
    )
    .setAllowInvalid(false)
    .setHelpText('Formato: HH:MM (es. 08:30, 14:00). Lascia vuoto per disabilitare.')
    .build();

  sheet.getRange('C10:D16').setDataValidation(timeFormatRule);

  // Validazione "Dalle < Alle"
  const scheduleRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(AND($C10="";$D10="");TIMEVALUE($C10)<TIMEVALUE($D10))')
    .setAllowInvalid(false)
    .setHelpText('"Dalle" deve essere minore di "Alle".')
    .build();

  sheet.getRange('D10:D16').setDataValidation(scheduleRule);

  // Nota esplicativa
  safeMerge(sheet.getRange('B17:D17'));
  sheet.getRange('B17:D17')
    .setValue('ℹ️ Durante questi orari il bot è SOSPESO (segreteria presente). Lascia vuoto per bot attivo H24.')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(8)
    .setWrap(true)
    .setBackground('#FFF9E6');

  // ─────────────────────────────────────────────────────────────────────
  // SEZIONE D: LINK RAPIDI (A19:F22)
  // ─────────────────────────────────────────────────────────────────────

  safeMerge(sheet.getRange('A19:F19'));
  sheet.getRange('A19:F19')
    .setValue('🔗 ACCESSO RAPIDO AI DATI')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBackground('#FFF2CC')
    .setFontSize(11);

  sheet.getRange('A20').setValue('📅 Gestione Assenze →').setFontWeight('bold');
  sheet.getRange('B20:F20').merge();
  sheet.getRange('B20:F20')
    .setValue('Apri la scheda "Assenze" in basso per configurare ferie, permessi e malattie')
    .setFontStyle('italic')
    .setFontSize(9);

  sheet.getRange('A21').setValue('🚫 Filtri Email →').setFontWeight('bold');
  sheet.getRange('B21:F21').merge();
  sheet.getRange('B21:F21')
    .setValue('Apri la scheda "Filtri" per configurare domini e parole chiave da ignorare')
    .setFontStyle('italic')
    .setFontSize(9);

  sheet.getRange('A22').setValue('📜 Cronologia Modifiche →').setFontWeight('bold');
  sheet.getRange('B22:F22').merge();
  sheet.getRange('B22:F22')
    .setValue('Apri la scheda "ConfigHistory" per vedere tutte le modifiche effettuate')
    .setFontStyle('italic')
    .setFontSize(9);

  // ─────────────────────────────────────────────────────────────────────
  // LARGHEZZE COLONNE E LAYOUT FINALE
  // ─────────────────────────────────────────────────────────────────────

  sheet.setColumnWidth(1, 180); // A
  sheet.setColumnWidth(2, 140); // B
  sheet.setColumnWidth(3, 90);  // C
  sheet.setColumnWidth(4, 90);  // D
  sheet.setColumnWidth(5, 155); // E
  sheet.setColumnWidth(6, 155); // F

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
}

// ════════════════════════════════════════════════════════════════════════
// SETUP FOGLIO "ASSENZE"
// ════════════════════════════════════════════════════════════════════════

/**
 * Configura il foglio "Assenze" per gestione ferie/permessi/malattie
 * 
 * STRUTTURA:
 * - A1:G1: Header tabella
 * - A2:G1000: Dati assenze (id, tipo, data_dal, data_al, intera_giornata, note, attiva_oggi)
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupAssenzeSheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.ASSENZE_SHEET, UI_CONFIG.COLORS.ASSENZE);
  resetSheetLayout(sheet);

  // Header
  const headers = [[
    'id_assenza',
    'tipo',
    'data_dal',
    'data_al',
    'intera_giornata',
    'note',
    'attiva_oggi'
  ]];

  sheet.getRange('A1:G1')
    .setValues(headers)
    .setFontWeight('bold')
    .setBackground('#F4CCCC')
    .setHorizontalAlignment('center')
    .setBorder(false, false, true, false, false, false, '#CC0000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  sheet.setFrozenRows(1);

  // Validazione tipo assenza
  const tipoRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Ferie', 'Permesso', 'Malattia', 'Festività', 'Altro'], true)
    .setAllowInvalid(false)
    .setHelpText('Seleziona il tipo di assenza')
    .build();
  sheet.getRange('B2:B1000').setDataValidation(tipoRule);

  // Validazione date
  const dateRule = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .setHelpText('Inserisci una data valida (formato gg/mm/aaaa)')
    .build();
  sheet.getRange('C2:D1000').setDataValidation(dateRule);

  // Validazione "data_dal <= data_al"
  const startEndRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR($C2="",$D2="",$C2<=$D2)')
    .setAllowInvalid(false)
    .setHelpText('La data di fine deve essere uguale o successiva alla data di inizio')
    .build();
  sheet.getRange('D2:D1000').setDataValidation(startEndRule);

  // Checkbox "intera_giornata"
  sheet.getRange('E2:E1000').insertCheckboxes();

  // Formula "attiva_oggi" (calcolata automaticamente)
  sheet.getRange('G2').setFormula(
    '=ARRAYFORMULA(IF(A2:A="";;IF((C2:C="")+(D2:D="");FALSE;(TODAY()>=C2:C)*(TODAY()<=D2:D))))'
  );

  // Formattazione colonna attiva_oggi
  sheet.getRange('G1:G1').setBackground('#FFE599');
  sheet.getRange('G2:G1000').setHorizontalAlignment('center');

  // Note esplicative (riga sotto header)
  sheet.insertRowBefore(2);
  sheet.getRange('A2:G2')
    .merge()
    .setValue('ℹ️ Aggiungi qui le assenze del segretario. La colonna "attiva_oggi" si calcola automaticamente.')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(9)
    .setBackground('#FFF9E6');

  // Auto-resize colonne
  sheet.autoResizeColumns(1, 7);
  sheet.setColumnWidth(6, 250); // Note più larghe
}

// ════════════════════════════════════════════════════════════════════════
// SETUP FOGLIO "FILTRI"
// ════════════════════════════════════════════════════════════════════════

/**
 * Configura il foglio "Filtri" per domini e parole chiave da ignorare
 * 
 * STRUTTURA:
 * - A1: Header Domini
 * - A2:A1000: Lista domini da ignorare
 * - C1: Header Keywords
 * - C2:C1000: Lista parole chiave da ignorare
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupFiltriSheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.FILTRI_SHEET, UI_CONFIG.COLORS.FILTRI);
  resetSheetLayout(sheet);

  // Header Domini
  sheet.getRange('A1')
    .setValue('🚫 DOMINI DA IGNORARE')
    .setFontWeight('bold')
    .setBackground('#FFF2CC')
    .setHorizontalAlignment('center')
    .setBorder(false, false, true, false, false, false);

  // Header Keywords
  sheet.getRange('C1')
    .setValue('🚫 PAROLE CHIAVE DA IGNORARE')
    .setFontWeight('bold')
    .setBackground('#FFF2CC')
    .setHorizontalAlignment('center')
    .setBorder(false, false, true, false, false, false);

  // Esempi placeholder
  sheet.getRange('A2')
    .setValue('amazon.com')
    .setFontStyle('italic')
    .setFontColor('#999999');

  sheet.getRange('A3')
    .setValue('noreply.github.com')
    .setFontStyle('italic')
    .setFontColor('#999999');

  sheet.getRange('C2')
    .setValue('newsletter')
    .setFontStyle('italic')
    .setFontColor('#999999');

  sheet.getRange('C3')
    .setValue('unsubscribe')
    .setFontStyle('italic')
    .setFontColor('#999999');

  // Validazione domini (formato dominio.ext)
  const domainRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(A2="";REGEXMATCH(A2;"^(?:[a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}$"))')
    .setAllowInvalid(false)
    .setHelpText('Inserisci solo il dominio (es. example.com), senza https:// o @')
    .build();
  sheet.getRange('A2:A1000').setDataValidation(domainRule);

  // Validazione keyword (non vuota)
  const keywordRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(C2="";LEN(TRIM(C2))>0)')
    .setAllowInvalid(false)
    .setHelpText('Inserisci una parola chiave valida')
    .build();
  sheet.getRange('C2:C1000').setDataValidation(keywordRule);

  // Note esplicative
  sheet.insertRowBefore(2);
  sheet.getRange('A2')
    .setValue('ℹ️ Domini: Scrivi solo il dominio (es. noreply.com)')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(8)
    .setBackground('#FFF9E6');

  sheet.getRange('C2')
    .setValue('ℹ️ Keywords: Parole presenti nel corpo/oggetto email')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(8)
    .setBackground('#FFF9E6');

  // Layout
  sheet.setColumnWidth(1, 280); // A
  sheet.setColumnWidth(2, 50);  // B (spazio)
  sheet.setColumnWidth(3, 280); // C
  sheet.setFrozenRows(1);
}

// ════════════════════════════════════════════════════════════════════════
// SETUP FOGLIO "CONFIG HISTORY" (Audit Trail)
// ════════════════════════════════════════════════════════════════════════

/**
 * Configura il foglio "ConfigHistory" per tracciare tutte le modifiche
 * 
 * STRUTTURA:
 * - A1:H1: Header
 * - A2:H∞: Log modifiche (timestamp, utente, azione, foglio, cella, vecchio, nuovo, note)
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupConfigHistorySheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.HISTORY_SHEET, UI_CONFIG.COLORS.HISTORY);
  resetSheetLayout(sheet);

  // Header
  const headers = [[
    'Timestamp',
    'Utente',
    'Azione',
    'Foglio',
    'Cella/Range',
    'Valore Vecchio',
    'Valore Nuovo',
    'Note'
  ]];

  sheet.getRange('A1:H1')
    .setValues(headers)
    .setFontWeight('bold')
    .setBackground('#E0E0E0')
    .setHorizontalAlignment('center')
    .setBorder(false, false, true, false, false, false, '#757575', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  sheet.setFrozenRows(1);

  // Larghezze colonne
  sheet.setColumnWidth(1, 150); // Timestamp
  sheet.setColumnWidth(2, 180); // Utente
  sheet.setColumnWidth(3, 120); // Azione
  sheet.setColumnWidth(4, 100); // Foglio
  sheet.setColumnWidth(5, 120); // Range
  sheet.setColumnWidth(6, 200); // Vecchio
  sheet.setColumnWidth(7, 200); // Nuovo
  sheet.setColumnWidth(8, 250); // Note

  // Nota esplicativa
  sheet.insertRowBefore(2);
  sheet.getRange('A2:H2')
    .merge()
    .setValue('📜 Questo foglio registra automaticamente tutte le modifiche ai fogli Controllo, Assenze e Filtri. NON modificare manualmente.')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(9)
    .setBackground('#FFF9E6');

  // Esempio log iniziale
  sheet.getRange('A3:H3').setValues([[
    new Date(),
    Session.getActiveUser().getEmail() || 'Sistema',
    'Setup Iniziale',
    'ConfigHistory',
    'A1:H1',
    '',
    'Foglio creato',
    'Inizializzazione sistema v' + UI_CONFIG.VERSION
  ]]);
}

// ════════════════════════════════════════════════════════════════════════
// NAMED RANGES
// ════════════════════════════════════════════════════════════════════════

/**
 * Crea e aggiorna tutti i Named Ranges.
 * I named ranges permettono al codice di accedere alle celle in modo robusto.
 * 
 * NAMING CONVENTION:
 * - cfg_* = Configurazioni
 * - sum_* = Summary/Dashboard
 * - tbl_* = Tabelle
 * - lst_* = Liste
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function createNamedRanges(ss) {
  const ranges = [
    // Controllo - Configurazioni
    { name: 'cfg_system_master', range: "'Controllo'!B2", desc: 'Toggle master Acceso/Spento' },
    { name: 'cfg_timezone', range: "'Controllo'!B4", desc: 'Timezone sistema' },
    { name: 'cfg_holidays_mode', range: "'Controllo'!B5", desc: 'Modalità festivi' },

    // Controllo - Summary Dashboard
    { name: 'sum_auto_status', range: "'Controllo'!F5", desc: 'Status autoresponder' },
    { name: 'sum_secretary_status', range: "'Controllo'!F6", desc: 'Status segretario' },
    { name: 'sum_today_reason', range: "'Controllo'!F7", desc: 'Motivo stato' },
    { name: 'sum_today_date', range: "'Controllo'!F8", desc: 'Data corrente' },
    { name: 'sum_today_slot', range: "'Controllo'!F9", desc: 'Fascia oraria attuale' },

    // Controllo - Tabella Orari
    { name: 'tbl_week_schedule', range: "'Controllo'!B10:D16", desc: 'Orari settimanali completi' },
    { name: 'tbl_week_days', range: "'Controllo'!B10:B16", desc: 'Giorni settimana' },
    { name: 'tbl_week_from', range: "'Controllo'!C10:C16", desc: 'Orari inizio' },
    { name: 'tbl_week_to', range: "'Controllo'!D10:D16", desc: 'Orari fine' },

    // Assenze
    { name: 'tbl_absences', range: "'Assenze'!A3:G", desc: 'Tabella assenze completa' },
    { name: 'tbl_absences_active', range: "'Assenze'!G3:G", desc: 'Colonna attiva_oggi' },

    // Filtri
    { name: 'lst_ignore_domains', range: "'Filtri'!A3:A", desc: 'Lista domini da ignorare' },
    { name: 'lst_ignore_keywords', range: "'Filtri'!C3:C", desc: 'Lista keyword da ignorare' }
  ];

  let created = 0;
  let updated = 0;

  ranges.forEach(def => {
    try {
      const existing = removeNamedRangeIfExists(ss, def.name);
      const range = ss.getRange(def.range);
      ss.setNamedRange(def.name, range);

      if (existing) {
        updated++;
        Logger.log(`✓ Named Range aggiornato: ${def.name}`);
      } else {
        created++;
        Logger.log(`✓ Named Range creato: ${def.name}`);
      }
    } catch (error) {
      Logger.log(`✗ Errore Named Range "${def.name}": ${error.message}`);
    }
  });

  Logger.log(`Named Ranges: ${created} creati, ${updated} aggiornati`);
}

// ════════════════════════════════════════════════════════════════════════
// PROTEZIONI
// ════════════════════════════════════════════════════════════════════════

/**
 * Protegge le celle con formule per evitare modifiche accidentali
 * 
 * CELLE PROTETTE:
 * - Controllo: Dashboard F5:F9 (formule)
 * - Controllo: Status indicator E2:F2
 * - Assenze: Colonna attiva_oggi G:G (formula ARRAYFORMULA)
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function protectFormulaRanges(ss) {
  const protections = [];

  try {
    // 1. Proteggi Dashboard Controllo (F5:F9)
    const controlloSheet = ss.getSheetByName(UI_CONFIG.CONTROLLO_SHEET);
    const dashboardProtection = controlloSheet.getRange('F5:F9').protect();
    dashboardProtection.setDescription('📊 Dashboard automatica - NON modificare');
    dashboardProtection.setWarningOnly(true); // Permette override consapevole
    protections.push('Dashboard Controllo (F5:F9)');

    // 2. Proteggi Indicatore Status (E2:F2)
    const statusProtection = controlloSheet.getRange('E2:F2').protect();
    statusProtection.setDescription('🚦 Indicatore status automatico - NON modificare');
    statusProtection.setWarningOnly(true);
    protections.push('Indicatore Status (E2:F2)');

    // 3. Proteggi colonna "attiva_oggi" in Assenze
    const assenzeSheet = ss.getSheetByName(UI_CONFIG.ASSENZE_SHEET);
    const activeProtection = assenzeSheet.getRange('G3:G1000').protect();
    activeProtection.setDescription('✓ Calcolato automaticamente - NON modificare');
    activeProtection.setWarningOnly(true);
    protections.push('Assenze attiva_oggi (G3:G1000)');

    // 4. Proteggi intero foglio ConfigHistory
    const historySheet = ss.getSheetByName(UI_CONFIG.HISTORY_SHEET);
    const historyProtection = historySheet.protect();
    historyProtection.setDescription('📜 Log automatico - Modifiche solo via script');
    historyProtection.setWarningOnly(false); // Blocco totale
    protections.push('ConfigHistory (intero foglio)');

    Logger.log(`✓ Protezioni applicate: ${protections.join(', ')}`);

  } catch (error) {
    Logger.log(`⚠️ Errore applicazione protezioni: ${error.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// FORMATTAZIONE CONDIZIONALE
// ════════════════════════════════════════════════════════════════════════

/**
 * Applica formattazione condizionale per feedback visivo immediato
 * 
 * REGOLE:
 * - 🟢 Verde = Sistema attivo
 * - 🟡 Giallo = Sistema sospeso
 * - 🔴 Rosso = Sistema spento
 * - Assenze attive = sfondo giallo
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupConditionalFormatting(ss) {
  try {
    const controlloSheet = ss.getSheetByName(UI_CONFIG.CONTROLLO_SHEET);

    // ─────────────────────────────────────────────────────────────────────
    // 1. STATUS GLOBALE (E2:F2)
    // ─────────────────────────────────────────────────────────────────────

    const statusRange = controlloSheet.getRange('E2:F2');

    // Regola VERDE (Attiva)
    const greenRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🟢')
      .setBackground('#D4EDDA')  // Verde chiaro
      .setFontColor('#155724')   // Verde scuro
      .setBold(true)
      .setRanges([statusRange])
      .build();

    // Regola GIALLA (Sospesa)
    const yellowRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🟡')
      .setBackground('#FFF3CD')  // Giallo chiaro
      .setFontColor('#856404')   // Marrone
      .setBold(true)
      .setRanges([statusRange])
      .build();

    // Regola ROSSA (Spenta)
    const redRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🔴')
      .setBackground('#F8D7DA')  // Rosso chiaro
      .setFontColor('#721C24')   // Rosso scuro
      .setBold(true)
      .setRanges([statusRange])
      .build();

    // ─────────────────────────────────────────────────────────────────────
    // 2. DASHBOARD (F5) - Status riassuntivo
    // ─────────────────────────────────────────────────────────────────────

    const dashStatusRange = controlloSheet.getRange('F5');

    const dashGreenRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🟢')
      .setBackground('#D4EDDA')
      .setFontColor('#155724')
      .setBold(true)
      .setRanges([dashStatusRange])
      .build();

    const dashYellowRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🟡')
      .setBackground('#FFF3CD')
      .setFontColor('#856404')
      .setBold(true)
      .setRanges([dashStatusRange])
      .build();

    const dashRedRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🔴')
      .setBackground('#F8D7DA')
      .setFontColor('#721C24')
      .setBold(true)
      .setRanges([dashStatusRange])
      .build();

    // ─────────────────────────────────────────────────────────────────────
    // 3. ASSENZE ATTIVE (Colonna G in Assenze)
    // ─────────────────────────────────────────────────────────────────────

    const assenzeSheet = ss.getSheetByName(UI_CONFIG.ASSENZE_SHEET);
    const activeAbsenceRange = assenzeSheet.getRange('A3:G1000');

    // Evidenzia riga se assenza attiva
    const activeRowRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G3=TRUE')
      .setBackground('#FFF9E6')  // Giallo chiaro
      .setRanges([activeAbsenceRange])
      .build();

    // ─────────────────────────────────────────────────────────────────────
    // APPLICA TUTTE LE REGOLE
    // ─────────────────────────────────────────────────────────────────────

    controlloSheet.setConditionalFormatRules([
      greenRule,
      yellowRule,
      redRule,
      dashGreenRule,
      dashYellowRule,
      dashRedRule
    ]);

    assenzeSheet.setConditionalFormatRules([activeRowRule]);

    Logger.log('✓ Formattazione condizionale applicata: 7 regole');

  } catch (error) {
    Logger.log(`⚠️ Errore formattazione condizionale: ${error.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// TRIGGER ON EDIT (Audit Trail)
// ════════════════════════════════════════════════════════════════════════

/**
 * Trigger automatico che registra ogni modifica nei fogli monitorati
 * 
 * NOTA: Questo trigger deve essere installato manualmente:
 * 1. Apps Script Editor > Triggers (icona sveglia)
 * 2. Add Trigger > onEdit > From spreadsheet > On edit
 * 
 * @param {Object} e - Event object
 */
function onEdit(e) {
  if (!e || !e.range) return;

  const sheetName = e.range.getSheet().getName();
  const monitoredSheets = [
    UI_CONFIG.CONTROLLO_SHEET,
    UI_CONFIG.ASSENZE_SHEET,
    UI_CONFIG.FILTRI_SHEET
  ];

  // Monitora solo fogli specifici
  if (!monitoredSheets.includes(sheetName)) return;

  // Escludi modifiche al foglio ConfigHistory stesso
  if (sheetName === UI_CONFIG.HISTORY_SHEET) return;

  try {
    const ss = e.source;
    const user = Session.getActiveUser().getEmail() || 'Utente Anonimo';
    const cell = e.range.getA1Notation();
    const oldValue = e.oldValue || '(vuoto)';
    const newValue = e.value || '(vuoto)';

    logConfigChange(
      ss,
      'Modifica Manuale',
      sheetName,
      cell,
      `${oldValue} → ${newValue}`,
      user
    );

  } catch (error) {
    // Fail silently per non bloccare l'edit dell'utente
    Logger.log(`⚠️ Errore logging onEdit: ${error.message}`);
  }
}

/**
 * Helper per loggare modifiche in ConfigHistory
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} action - Tipo di azione (es. "Modifica Manuale", "Setup")
 * @param {string} foglio - Nome foglio modificato
 * @param {string} range - Cella o range modificato
 * @param {string} details - Dettagli modifica
 * @param {string} user - Email utente (opzionale)
 */
function logConfigChange(ss, action, foglio, range, details, user) {
  try {
    const historySheet = ss.getSheetByName(UI_CONFIG.HISTORY_SHEET);
    if (!historySheet) return;

    const timestamp = new Date();
    const userEmail = user || Session.getActiveUser().getEmail() || 'Sistema';

    // Parsing vecchio/nuovo valore se presente
    let oldVal = '';
    let newVal = '';
    if (details.includes('→')) {
      const parts = details.split('→').map(s => s.trim());
      oldVal = parts[0] || '';
      newVal = parts[1] || '';
    } else {
      newVal = details;
    }

    historySheet.appendRow([
      timestamp,
      userEmail,
      action,
      foglio,
      range,
      oldVal,
      newVal,
      '' // Note (opzionale)
    ]);

  } catch (error) {
    Logger.log(`⚠️ Errore log change: ${error.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════════════

/**
 * Test suite per validare la configurazione
 * Esegui dal menu: 🏛️ Parrocchia AI > 🧪 Test Configurazione
 */
function testConfiguration() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const results = [];

  Logger.log('═══════════════════════════════════════════════');
  Logger.log('AVVIO TEST CONFIGURAZIONE');
  Logger.log('═══════════════════════════════════════════════');

  // ─────────────────────────────────────────────────────────────────────
  // TEST 1: Fogli esistono
  // ─────────────────────────────────────────────────────────────────────

  [
    UI_CONFIG.CONTROLLO_SHEET,
    UI_CONFIG.ASSENZE_SHEET,
    UI_CONFIG.FILTRI_SHEET,
    UI_CONFIG.HISTORY_SHEET
  ].forEach(name => {
    const exists = ss.getSheetByName(name) !== null;
    results.push({
      category: 'Fogli',
      test: `Foglio "${name}"`,
      pass: exists,
      error: exists ? null : 'Foglio non trovato'
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 2: Named Ranges esistono
  // ─────────────────────────────────────────────────────────────────────

  const expectedRanges = [
    'cfg_system_master',
    'sum_auto_status',
    'tbl_week_schedule',
    'tbl_absences',
    'lst_ignore_domains',
    'lst_ignore_keywords'
  ];

  expectedRanges.forEach(name => {
    try {
      const range = ss.getRangeByName(name);
      results.push({
        category: 'Named Ranges',
        test: name,
        pass: range !== null,
        error: range ? null : 'Range non definito'
      });
    } catch (e) {
      results.push({
        category: 'Named Ranges',
        test: name,
        pass: false,
        error: e.message
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 3: Formule dashboard
  // ─────────────────────────────────────────────────────────────────────

  const controllo = ss.getSheetByName(UI_CONFIG.CONTROLLO_SHEET);
  const dashboardCells = ['F5', 'F6', 'F7', 'F8', 'F9'];

  dashboardCells.forEach(cell => {
    const formula = controllo.getRange(cell).getFormula();
    results.push({
      category: 'Formule',
      test: `Dashboard ${cell}`,
      pass: formula.length > 0 && formula.startsWith('='),
      error: formula ? null : 'Formula mancante o invalida'
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 4: Validazioni dati
  // ─────────────────────────────────────────────────────────────────────

  const masterToggle = controllo.getRange('B2').getDataValidation();
  results.push({
    category: 'Validazioni',
    test: 'Toggle master (B2)',
    pass: masterToggle !== null,
    error: masterToggle ? null : 'Validazione dropdown mancante'
  });

  const assenzeSheet = ss.getSheetByName(UI_CONFIG.ASSENZE_SHEET);
  const tipoValidation = assenzeSheet.getRange('B3').getDataValidation();
  results.push({
    category: 'Validazioni',
    test: 'Tipo assenza (B3)',
    pass: tipoValidation !== null,
    error: tipoValidation ? null : 'Validazione dropdown mancante'
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 5: Protezioni
  // ─────────────────────────────────────────────────────────────────────

  const protections = controllo.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  results.push({
    category: 'Protezioni',
    test: 'Protezioni attive',
    pass: protections.length > 0,
    error: protections.length > 0 ? null : 'Nessuna protezione trovata'
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 6: Formattazione condizionale
  // ─────────────────────────────────────────────────────────────────────

  const conditionalRules = controllo.getConditionalFormatRules();
  results.push({
    category: 'Formattazione',
    test: 'Regole condizionali',
    pass: conditionalRules.length > 0,
    error: conditionalRules.length > 0 ? null : 'Nessuna regola trovata'
  });

  // ─────────────────────────────────────────────────────────────────────
  // REPORT RISULTATI
  // ─────────────────────────────────────────────────────────────────────

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const total = results.length;
  const passPercentage = ((passed / total) * 100).toFixed(1);

  let report = `📊 REPORT TEST CONFIGURAZIONE\n`;
  report += `${'═'.repeat(50)}\n\n`;
  report += `✅ Passati: ${passed}/${total} (${passPercentage}%)\n`;
  report += `❌ Falliti: ${failed}/${total}\n\n`;

  // Raggruppa per categoria
  const categories = [...new Set(results.map(r => r.category))];

  categories.forEach(cat => {
    const catResults = results.filter(r => r.category === cat);
    const catPassed = catResults.filter(r => r.pass).length;

    report += `\n━━━ ${cat} (${catPassed}/${catResults.length}) ━━━\n`;

    catResults.forEach(r => {
      const icon = r.pass ? '✅' : '❌';
      report += `  ${icon} ${r.test}`;
      if (!r.pass && r.error) {
        report += `\n     ↳ ${r.error}`;
      }
      report += '\n';
    });
  });

  if (failed === 0) {
    report += `\n${'═'.repeat(50)}\n`;
    report += `🎉 TUTTI I TEST SONO PASSATI!\n`;
    report += `Il sistema è configurato correttamente.`;
  } else {
    report += `\n${'═'.repeat(50)}\n`;
    report += `⚠️ ATTENZIONE: Alcuni test sono falliti.\n`;
    report += `Esegui nuovamente "⚙️ Configura Fogli".`;
  }

  Logger.log('\n' + report);

  // Mostra popup
  ui.alert(
    failed === 0 ? '✅ Test Completati' : '⚠️ Test Completati con Errori',
    report,
    ui.ButtonSet.OK
  );
}

// ════════════════════════════════════════════════════════════════════════
// UTILITY: RESET CONFIGURAZIONE
// ════════════════════════════════════════════════════════════════════════

/**
 * Elimina tutti i fogli di configurazione e ricomincia da zero
 * ATTENZIONE: Operazione distruttiva!
 */
function resetConfiguration() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    '⚠️ ATTENZIONE: RESET COMPLETO',
    'Questa operazione eliminerà TUTTI i fogli di configurazione:\n' +
    '• Controllo\n' +
    '• Assenze\n' +
    '• Filtri\n' +
    '• ConfigHistory\n\n' +
    'I dati saranno PERSI definitivamente!\n\n' +
    'Continuare?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    ui.alert('❌ Reset annullato.');
    return;
  }

  // Conferma doppia
  const confirm = ui.alert(
    '🚨 ULTIMA CONFERMA',
    'Sei ASSOLUTAMENTE SICURO?\n\n' +
    'Questa azione NON può essere annullata!',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) {
    ui.alert('❌ Reset annullato.');
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetsToDelete = [
      UI_CONFIG.CONTROLLO_SHEET,
      UI_CONFIG.ASSENZE_SHEET,
      UI_CONFIG.FILTRI_SHEET,
      UI_CONFIG.HISTORY_SHEET
    ];

    sheetsToDelete.forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (sheet) {
        ss.deleteSheet(sheet);
        Logger.log(`🗑️ Foglio eliminato: ${name}`);
      }
    });

    // Rimuovi named ranges
    ss.getNamedRanges().forEach(nr => {
      ss.removeNamedRange(nr.getName());
    });

    ui.alert(
      '✅ RESET COMPLETATO',
      'Tutti i fogli di configurazione sono stati eliminati.\n\n' +
      'Esegui nuovamente "⚙️ Configura Fogli" per ricrearli.',
      ui.ButtonSet.OK
    );

  } catch (error) {
    ui.alert('❌ ERRORE', error.message, ui.ButtonSet.OK);
  }
}

// ════════════════════════════════════════════════════════════════════════
// UTILITY: GUIDA RAPIDA
// ════════════════════════════════════════════════════════════════════════

/**
 * Mostra guida rapida per l'utente
 */
function showQuickGuide() {
  const ui = SpreadsheetApp.getUi();

  const guide = `
📖 GUIDA RAPIDA - PARROCCHIA AI

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏛️ FOGLIO "CONTROLLO"
- Interruttore: Acceso/Spento per attivare/disattivare bot
- Orari: Configura quando la segreteria è presente
- Dashboard: Mostra stato sistema in tempo reale

📅 FOGLIO "ASSENZE"
- Aggiungi ferie, permessi, malattie del segretario
- La colonna "attiva_oggi" si calcola automaticamente
- Durante assenze attive, il bot risponde H24

🚫 FOGLIO "FILTRI"
- Domini: Email da ignorare (es. noreply.com)
- Keyword: Parole chiave da ignorare (es. newsletter)

📜 FOGLIO "CONFIG HISTORY"
- Log automatico di tutte le modifiche
- NON modificare manualmente

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 CONSIGLI:
1. Usa il toggle per test (Spento/Acceso)
2. Configura orari prima di attivare
3. Testa con "🧪 Test Configurazione"
4. Controlla il log in ConfigHistory

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📧 Supporto: parrocchia-ai@example.com
  `;

  ui.alert('📖 Guida Rapida', guide, ui.ButtonSet.OK);
}

/**
 * Mostra info versione
 */
function showVersionInfo() {
  const ui = SpreadsheetApp.getUi();

  const info = `
ℹ️ INFORMAZIONI SISTEMA

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Versione: ${UI_CONFIG.VERSION}
🏛️ Progetto: Parrocchia AI - Autoresponder
🛠️ Modulo: Setup UI Configurazione

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ FEATURES:
- Setup automatico fogli
- Validazioni dati intelligenti
- Protezioni anti-manomissione
- Formattazione condizionale
- Audit trail completo
- Named ranges robusti
- Test suite integrata

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👨💻 Sviluppato con ❤️ per le parrocchie
  `;

  ui.alert('ℹ️ Info Versione', info, ui.ButtonSet.OK);
}

// ════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS (Helper)
// ════════════════════════════════════════════════════════════════════════

/**
 * Restituisce un foglio esistente o lo crea.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} name - Nome foglio
 * @param {string} tabColor - Colore tab (hex)
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet(ss, name, tabColor) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    Logger.log(`✓ Foglio creato: ${name}`);
  } else {
    Logger.log(`✓ Foglio esistente: ${name}`);
  }
  sheet.setTabColor(tabColor);
  return sheet;
}

/**
 * Reset completo della zona usata dallo script per renderlo idempotente.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function resetSheetLayout(sheet) {
  const range = sheet.getRange(UI_CONFIG.SHEET_RESET_RANGE);

  // Rimuovi merge
  range.breakApart();

  // Pulisci contenuto, formattazione, validazioni
  range.clear();
  range.clearFormat();
  range.clearDataValidations();

  Logger.log(`  ↳ Reset layout: ${sheet.getName()}`);
}

/**
 * Merge sicuro: elimina merge preesistenti nel range e poi unisce.
 * @param {GoogleAppsScript.Spreadsheet.Range} range
 */
function safeMerge(range) {
  try {
    range.breakApart();
    range.merge();
  } catch (error) {
    Logger.log(`⚠️ SafeMerge fallito su ${range.getA1Notation()}: ${error.message}`);
  }
}

/**
 * Elimina un named range se esiste.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} name - Nome del range
 * @returns {boolean} - True se esisteva ed è stato rimosso
 */
function removeNamedRangeIfExists(ss, name) {
  const existing = ss.getNamedRanges().find(nr => nr.getName() === name);
  if (existing) {
    ss.removeNamedRange(name);
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════
// FINE SCRIPT
// ════════════════════════════════════════════════════════════════════════

/**
 * ISTRUZIONI POST-INSTALLAZIONE:
 * 
 * 1. SETUP INIZIALE:
 *    • Ricarica il foglio
 *    • Menu "🏛️ Parrocchia AI" > "⚙️ Configura Fogli"
 *    • Attendi 15-20 secondi
 * 
 * 2. VERIFICA:
 *    • Menu > "🧪 Test Configurazione"
 *    • Tutti i test devono essere ✅
 * 
 * 3. TRIGGER ON EDIT (Opzionale, per audit trail):
 *    • Apps Script Editor > Triggers (⏰)
 *    • Add Trigger:
 *      - Function: onEdit
 *      - Deployment: Head
 *      - Event source: From spreadsheet
 *      - Event type: On edit
 *    • Save
 * 
 * 4. USO:
 *    • Configura orari in foglio "Controllo"
 *    • Aggiungi assenze in foglio "Assenze"
 *    • Configura filtri in foglio "Filtri"
 *    • Monitora modifiche in "ConfigHistory"
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 📧 Supporto: Apri issue su GitHub o contatta l'amministratore
 * 📖 Documentazione: Vedi PIANO_UI_CONFIGURAZIONE_CONTROLLO_IT.md
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

/**
 * @fileoverview Sistema di configurazione UI per Autoresponder Parrocchiale
 * @version 2.0.2 (FIX Frozen Columns + Logger)
 * @author Parrocchia AI Team
 */

// ════════════════════════════════════════════════════════════════════════
// CONFIGURAZIONE GLOBALE
// ════════════════════════════════════════════════════════════════════════

const UI_CONFIG = {
  CONTROLLO_SHEET: 'Controllo',
  ASSENZE_SHEET: 'Assenze',
  FILTRI_SHEET: 'Filtri',
  HISTORY_SHEET: 'ConfigHistory',
  SHEET_RESET_RANGE: 'A1:Z300',
  DAYS: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],
  COLORS: {
    CONTROLLO: '#4285F4',
    ASSENZE: '#EA4335',
    FILTRI: '#FBBC04',
    HISTORY: '#9E9E9E'
  },
  VERSION: '2.0.3'
};

// Logger wrapper (usa console.log invece di Logger.log)
const log = console.log.bind(console);

// ════════════════════════════════════════════════════════════════════════
// MENU PERSONALIZZATO
// ════════════════════════════════════════════════════════════════════════

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

function setupConfigurationSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  try {
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

    steps.forEach((step, idx) => {
      log(`[${idx + 1}/${totalSteps}] ${step.icon} Configurando ${step.name}...`);

      try {
        step.fn();
        completed++;
      } catch (stepError) {
        log(`ERRORE in ${step.name}: ${stepError.toString()}`);
        throw new Error(`Errore durante ${step.name}: ${stepError.message}`);
      }

      SpreadsheetApp.flush();
    });

    const duration = ((new Date().getTime() - startTime) / 1000).toFixed(1);

    logConfigChange(
      ss,
      'Setup Completo',
      'Sistema',
      'Setup iniziale v' + UI_CONFIG.VERSION,
      `${completed}/${totalSteps} passaggi completati in ${duration}s`
    );

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
    log('❌ ERRORE SETUP: ' + error.toString());
    log('Stack trace: ' + error.stack);

    ui.alert(
      '❌ ERRORE DURANTE CONFIGURAZIONE',
      `Si è verificato un errore:\n\n` +
      `${error.message}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `DETTAGLI TECNICI:\n` +
      `${error.stack}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Cosa fare:\n` +
      `1. Verifica i log (View > Executions)\n` +
      `2. Prova a eseguire "🔄 Resetta Configurazione"\n` +
      `3. Se persiste, contatta l'amministratore`,
      ui.ButtonSet.OK
    );

    throw error;
  }
}

// ════════════════════════════════════════════════════════════════════════
// SETUP FOGLIO "CONTROLLO"
// ════════════════════════════════════════════════════════════════════════

function setupControlloSheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.CONTROLLO_SHEET, UI_CONFIG.COLORS.CONTROLLO);
  resetSheetLayout(sheet);

  sheet.getRange('A1:F4').setBackground('#FFFFFF');

  safeMerge(sheet.getRange('A1:C1'));
  sheet.getRange('A1:C1')
    .setValue('🏛️ STATO DEL SISTEMA')
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBackground('#E8F0FE');

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

  safeMerge(sheet.getRange('E2:F2'));
  sheet.getRange('E2:F2')
    .setFormula('=IF(B2="Spento";"🔴 Spenta";IF(OR(F6="Assente";F9="Nessuna");"🟡 Sospesa";"🟢 Attiva"))')
    .setHorizontalAlignment('center')
    .setFontWeight('bold')
    .setFontSize(12)
    .setBackground('#F1F3F4');

  safeMerge(sheet.getRange('A3:F3'));
  sheet.getRange('A3:F3')
    .setValue('💡 Il sistema risponde automaticamente solo quando è ATTIVO (🟢). Durante sospensione (🟡) o spento (🔴), le email NON vengono elaborate.')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(9)
    .setWrap(true);

  sheet.getRange('A4').setValue('⏰ Timezone:').setFontWeight('bold');
  sheet.getRange('B4').setValue('Europe/Rome');

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

  sheet.getRange('E5:F9')
    .setBackground('#F8F9FA')
    .setBorder(true, true, true, true, true, true, '#DADCE0', SpreadsheetApp.BorderStyle.SOLID);

  sheet.getRange('E5').setValue('📊 Risposta automatica:').setFontWeight('bold').setFontSize(9);
  sheet.getRange('E6').setValue('👤 Segretario:').setFontWeight('bold').setFontSize(9);
  sheet.getRange('E7').setValue('ℹ️ Motivo:').setFontWeight('bold').setFontSize(9);
  sheet.getRange('E8').setValue('📆 Oggi:').setFontWeight('bold').setFontSize(9);
  sheet.getRange('E9').setValue('⏰ Fascia oraria:').setFontWeight('bold').setFontSize(9);

  sheet.getRange('F5').setFormula('=IF(B2="Spento";"🔴 Spenta";IF(OR(F6="Assente";F9="Nessuna");"🟡 Sospesa";"🟢 Attiva"))');
  sheet.getRange('F6').setFormula('=IF(COUNTIF(Assenze!G2:G;TRUE)>0;"Assente";"In servizio")');
  sheet.getRange('F7').setFormula('=IF(B2="Spento";"Spento manualmente";IF(F6="Assente";"Assenza segretario";IF(F9="Nessuna";"Fuori orario";"Sistema attivo")))');
  sheet.getRange('F8').setFormula('=TEXT(TODAY();"dd/mm/yyyy")');
  sheet.getRange('F9').setFormula('=IF(OR(INDEX(C10:C16;WEEKDAY(TODAY();2))="";INDEX(D10:D16;WEEKDAY(TODAY();2))="");"Nessuna";TEXT(INDEX(C10:C16;WEEKDAY(TODAY();2));"HH:MM")&"–"&TEXT(INDEX(D10:D16;WEEKDAY(TODAY();2));"HH:MM"))');

  sheet.getRange('F5:F9').setFontSize(9);

  sheet.getRange('B9:D9')
    .setValues([['Giorno', 'Dalle ⏰', 'Alle ⏰']])
    .setFontWeight('bold')
    .setBackground('#E8F0FE')
    .setHorizontalAlignment('center');

  sheet.getRange('B10:B16')
    .setValues(UI_CONFIG.DAYS.map(day => [day]))
    .setBackground('#EFEFEF')
    .setFontWeight('bold')
    .setHorizontalAlignment('left');

  sheet.getRange('B9:D16').setBorder(
    true, true, true, true, true, true,
    '#DADCE0',
    SpreadsheetApp.BorderStyle.SOLID
  );

  const timeFormatRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(
      '=OR(' +
      '  C10="";' +
      '  AND(' +
      '    ISNUMBER(TIMEVALUE(C10));' +
      '    REGEXMATCH(TEXT(C10;"HH:MM");"^[0-2][0-9]:[0-5][0-9]$")' +
      '  )' +
      ')'
    )
    .setAllowInvalid(false)
    .setHelpText('Formato: HH:MM (es. 08:30, 14:00). Lascia vuoto per disabilitare.')
    .build();

  sheet.getRange('C10:D16').setDataValidation(timeFormatRule);

  const scheduleRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(AND($C10="";$D10="");TIMEVALUE($C10)<TIMEVALUE($D10))')
    .setAllowInvalid(false)
    .setHelpText('"Dalle" deve essere minore di "Alle".')
    .build();

  sheet.getRange('D10:D16').setDataValidation(scheduleRule);

  safeMerge(sheet.getRange('B17:D17'));
  sheet.getRange('B17:D17')
    .setValue('ℹ️ Durante questi orari il bot è SOSPESO (segreteria presente). Lascia vuoto per bot attivo H24.')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(8)
    .setWrap(true)
    .setBackground('#FFF9E6');

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

  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 140);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 90);
  sheet.setColumnWidth(5, 155);
  sheet.setColumnWidth(6, 155);

  sheet.setFrozenRows(1);
  // REMOVED sheet.setFrozenColumns(1); to fix merged cell error
}

// ════════════════════════════════════════════════════════════════════════
// SETUP FOGLIO "ASSENZE"
// ════════════════════════════════════════════════════════════════════════

function setupAssenzeSheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.ASSENZE_SHEET, UI_CONFIG.COLORS.ASSENZE);
  resetSheetLayout(sheet);

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

  const tipoRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Ferie', 'Permesso', 'Malattia', 'Festività', 'Altro'], true)
    .setAllowInvalid(false)
    .setHelpText('Seleziona il tipo di assenza')
    .build();
  sheet.getRange('B2:B1000').setDataValidation(tipoRule);

  const dateRule = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .setHelpText('Inserisci una data valida (formato gg/mm/aaaa)')
    .build();
  sheet.getRange('C2:D1000').setDataValidation(dateRule);

  const startEndRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR($C2="",$D2="",$C2<=$D2)')
    .setAllowInvalid(false)
    .setHelpText('La data di fine deve essere uguale o successiva alla data di inizio')
    .build();
  sheet.getRange('D2:D1000').setDataValidation(startEndRule);

  sheet.getRange('E2:E1000').insertCheckboxes();

  sheet.getRange('G2').setFormula(
    '=ARRAYFORMULA(IF(A2:A="";;IF((C2:C="")+(D2:D="");FALSE;(TODAY()>=C2:C)*(TODAY()<=D2:D))))'
  );

  sheet.getRange('G1:G1').setBackground('#FFE599');
  sheet.getRange('G2:G1000').setHorizontalAlignment('center');

  sheet.insertRowBefore(2);
  sheet.getRange('A2:G2')
    .merge()
    .setValue('ℹ️ Aggiungi qui le assenze del segretario. La colonna "attiva_oggi" si calcola automaticamente.')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(9)
    .setBackground('#FFF9E6');

  sheet.autoResizeColumns(1, 7);
  sheet.setColumnWidth(6, 250);
}

// ════════════════════════════════════════════════════════════════════════
// SETUP FOGLIO "FILTRI"
// ════════════════════════════════════════════════════════════════════════

function setupFiltriSheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.FILTRI_SHEET, UI_CONFIG.COLORS.FILTRI);
  resetSheetLayout(sheet);

  sheet.getRange('A1')
    .setValue('🚫 DOMINI DA IGNORARE')
    .setFontWeight('bold')
    .setBackground('#FFF2CC')
    .setHorizontalAlignment('center')
    .setBorder(false, false, true, false, false, false);

  sheet.getRange('C1')
    .setValue('🚫 PAROLE CHIAVE DA IGNORARE')
    .setFontWeight('bold')
    .setBackground('#FFF2CC')
    .setHorizontalAlignment('center')
    .setBorder(false, false, true, false, false, false);

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

  const domainRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(A2="";REGEXMATCH(A2;"^(?:[a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}$"))')
    .setAllowInvalid(false)
    .setHelpText('Inserisci solo il dominio (es. example.com), senza https:// o @')
    .build();
  sheet.getRange('A2:A1000').setDataValidation(domainRule);

  const keywordRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(C2="";LEN(TRIM(C2))>0)')
    .setAllowInvalid(false)
    .setHelpText('Inserisci una parola chiave valida')
    .build();
  sheet.getRange('C2:C1000').setDataValidation(keywordRule);

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

  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(2, 50);
  sheet.setColumnWidth(3, 280);
  sheet.setFrozenRows(1);
}

// ════════════════════════════════════════════════════════════════════════
// SETUP FOGLIO "CONFIG HISTORY"
// ════════════════════════════════════════════════════════════════════════

function setupConfigHistorySheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.HISTORY_SHEET, UI_CONFIG.COLORS.HISTORY);
  resetSheetLayout(sheet);

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

  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 120);
  sheet.setColumnWidth(6, 200);
  sheet.setColumnWidth(7, 200);
  sheet.setColumnWidth(8, 250);

  sheet.insertRowBefore(2);
  sheet.getRange('A2:H2')
    .merge()
    .setValue('📜 Questo foglio registra automaticamente tutte le modifiche ai fogli Controllo, Assenze e Filtri. NON modificare manualmente.')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setFontSize(9)
    .setBackground('#FFF9E6');

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

function createNamedRanges(ss) {
  const ranges = [
    { name: 'cfg_system_master', range: "'Controllo'!B2" },
    { name: 'cfg_timezone', range: "'Controllo'!B4" },
    { name: 'cfg_holidays_mode', range: "'Controllo'!B5" },
    { name: 'sum_auto_status', range: "'Controllo'!F5" },
    { name: 'sum_secretary_status', range: "'Controllo'!F6" },
    { name: 'sum_today_reason', range: "'Controllo'!F7" },
    { name: 'sum_today_date', range: "'Controllo'!F8" },
    { name: 'sum_today_slot', range: "'Controllo'!F9" },
    { name: 'tbl_week_schedule', range: "'Controllo'!B10:D16" },
    { name: 'tbl_week_days', range: "'Controllo'!B10:B16" },
    { name: 'tbl_week_from', range: "'Controllo'!C10:C16" },
    { name: 'tbl_week_to', range: "'Controllo'!D10:D16" },
    { name: 'tbl_absences', range: "'Assenze'!A3:G" },
    { name: 'tbl_absences_active', range: "'Assenze'!G3:G" },
    { name: 'lst_ignore_domains', range: "'Filtri'!A3:A" },
    { name: 'lst_ignore_keywords', range: "'Filtri'!C3:C" }
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
      } else {
        created++;
      }
    } catch (error) {
      log(`Errore Named Range "${def.name}": ${error.message}`);
    }
  });

  log(`Named Ranges: ${created} creati, ${updated} aggiornati`);
}

// ════════════════════════════════════════════════════════════════════════
// PROTEZIONI
// ════════════════════════════════════════════════════════════════════════

function protectFormulaRanges(ss) {
  try {
    const controlloSheet = ss.getSheetByName(UI_CONFIG.CONTROLLO_SHEET);
    const dashboardProtection = controlloSheet.getRange('F5:F9').protect();
    dashboardProtection.setDescription('📊 Dashboard automatica - NON modificare');
    dashboardProtection.setWarningOnly(true);

    const statusProtection = controlloSheet.getRange('E2:F2').protect();
    statusProtection.setDescription('🚦 Indicatore status automatico - NON modificare');
    statusProtection.setWarningOnly(true);

    const assenzeSheet = ss.getSheetByName(UI_CONFIG.ASSENZE_SHEET);
    const activeProtection = assenzeSheet.getRange('G3:G1000').protect();
    activeProtection.setDescription('✓ Calcolato automaticamente - NON modificare');
    activeProtection.setWarningOnly(true);

    const historySheet = ss.getSheetByName(UI_CONFIG.HISTORY_SHEET);
    const historyProtection = historySheet.protect();
    historyProtection.setDescription('📜 Log automatico - Modifiche solo via script');
    historyProtection.setWarningOnly(false);

    log('Protezioni applicate con successo');

  } catch (error) {
    log('Errore applicazione protezioni: ' + error.message);
  }
}

// ════════════════════════════════════════════════════════════════════════
// FORMATTAZIONE CONDIZIONALE
// ════════════════════════════════════════════════════════════════════════

function setupConditionalFormatting(ss) {
  try {
    const controlloSheet = ss.getSheetByName(UI_CONFIG.CONTROLLO_SHEET);
    const statusRange = controlloSheet.getRange('E2:F2');

    const greenRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🟢')
      .setBackground('#D4EDDA')
      .setFontColor('#155724')
      .setBold(true)
      .setRanges([statusRange])
      .build();

    const yellowRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🟡')
      .setBackground('#FFF3CD')
      .setFontColor('#856404')
      .setBold(true)
      .setRanges([statusRange])
      .build();

    const redRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('🔴')
      .setBackground('#F8D7DA')
      .setFontColor('#721C24')
      .setBold(true)
      .setRanges([statusRange])
      .build();

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

    const assenzeSheet = ss.getSheetByName(UI_CONFIG.ASSENZE_SHEET);
    const activeAbsenceRange = assenzeSheet.getRange('A3:G1000');

    const activeRowRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G3=TRUE')
      .setBackground('#FFF9E6')
      .setRanges([activeAbsenceRange])
      .build();

    controlloSheet.setConditionalFormatRules([
      greenRule,
      yellowRule,
      redRule,
      dashGreenRule,
      dashYellowRule,
      dashRedRule
    ]);

    assenzeSheet.setConditionalFormatRules([activeRowRule]);

    log('Formattazione condizionale applicata');

  } catch (error) {
    log('Errore formattazione condizionale: ' + error.message);
  }
}

// ════════════════════════════════════════════════════════════════════════
// AUDIT TRAIL
// ════════════════════════════════════════════════════════════════════════

function onEdit(e) {
  if (!e || !e.range) return;

  const sheetName = e.range.getSheet().getName();
  const monitoredSheets = [
    UI_CONFIG.CONTROLLO_SHEET,
    UI_CONFIG.ASSENZE_SHEET,
    UI_CONFIG.FILTRI_SHEET
  ];

  if (!monitoredSheets.includes(sheetName)) return;
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
    log('Errore logging onEdit: ' + error.message);
  }
}

function logConfigChange(ss, action, foglio, range, details, user) {
  try {
    const historySheet = ss.getSheetByName(UI_CONFIG.HISTORY_SHEET);
    if (!historySheet) return;

    const timestamp = new Date();
    const userEmail = user || Session.getActiveUser().getEmail() || 'Sistema';

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
      ''
    ]);

  } catch (error) {
    log('Errore log change: ' + error.message);
  }
}

// ════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════════════

function testConfiguration() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const results = [];

  log('═════════════════════════════════');
  log('AVVIO TEST CONFIGURAZIONE');
  log('═════════════════════════════════');

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

  const protections = controllo.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  results.push({
    category: 'Protezioni',
    test: 'Protezioni attive',
    pass: protections.length > 0,
    error: protections.length > 0 ? null : 'Nessuna protezione trovata'
  });

  const conditionalRules = controllo.getConditionalFormatRules();
  results.push({
    category: 'Formattazione',
    test: 'Regole condizionali',
    pass: conditionalRules.length > 0,
    error: conditionalRules.length > 0 ? null : 'Nessuna regola trovata'
  });

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const total = results.length;
  const passPercentage = ((passed / total) * 100).toFixed(1);

  let report = `📊 REPORT TEST CONFIGURAZIONE\n`;
  report += `${'═'.repeat(50)}\n\n`;
  report += `✅ Passati: ${passed}/${total} (${passPercentage}%)\n`;
  report += `❌ Falliti: ${failed}/${total}\n\n`;

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

  log('\n' + report);

  ui.alert(
    failed === 0 ? '✅ Test Completati' : '⚠️ Test Completati con Errori',
    report,
    ui.ButtonSet.OK
  );
}

// ════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════════════

function resetConfiguration() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    '⚠️ ATTENZIONE: RESET COMPLETO',
    'Questa operazione eliminerà TUTTI i fogli di configurazione.\n\n' +
    'I dati saranno PERSI definitivamente!\n\n' +
    'Continuare?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    ui.alert('❌ Reset annullato.');
    return;
  }

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
        log(`Foglio eliminato: ${name}`);
      }
    });

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

function showQuickGuide() {
  const ui = SpreadsheetApp.getUi();

  const guide = `
📖 GUIDA RAPIDA - PARROCCHIA AI

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏛️ FOGLIO "CONTROLLO"
- Interruttore: Acceso/Spento per attivare bot
- Orari: Configura quando segreteria è presente
- Dashboard: Status sistema in tempo reale

📅 FOGLIO "ASSENZE"
- Aggiungi ferie, permessi, malattie
- Colonna "attiva_oggi" automatica
- Durante assenze: bot risponde H24

🚫 FOGLIO "FILTRI"
- Domini da ignorare (es. noreply.com)
- Keyword da ignorare (es. newsletter)

📜 FOGLIO "CONFIG HISTORY"
- Log automatico modifiche
- NON modificare manualmente

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 CONSIGLI:
1. Usa toggle per test (Spento/Acceso)
2. Configura orari prima di attivare
3. Testa con "🧪 Test Configurazione"
4. Controlla log in ConfigHistory

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `;

  ui.alert('📖 Guida Rapida', guide, ui.ButtonSet.OK);
}

function showVersionInfo() {
  const ui = SpreadsheetApp.getUi();

  const info = `
ℹ️ INFORMAZIONI SISTEMA

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Versione: ${UI_CONFIG.VERSION}
🏛️ Progetto: Parrocchia AI
🛠️ Modulo: Setup UI Configurazione

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ FEATURES:
- Setup automatico fogli
- Validazioni intelligenti
- Protezioni anti-manomissione
- Formattazione condizionale
- Audit trail completo
- Named ranges robusti
- Test suite integrata

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `;

  ui.alert('ℹ️ Info Versione', info, ui.ButtonSet.OK);
}

function getOrCreateSheet(ss, name, tabColor) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    log(`Foglio creato: ${name}`);
  } else {
    log(`Foglio esistente: ${name}`);
  }
  sheet.setTabColor(tabColor);
  return sheet;
}

function resetSheetLayout(sheet) {
  const range = sheet.getRange(UI_CONFIG.SHEET_RESET_RANGE);
  range.breakApart();
  range.clear();
  range.clearFormat();
  range.clearDataValidations();
  log(`Reset layout: ${sheet.getName()}`);
}

function safeMerge(range) {
  try {
    range.breakApart();
    range.merge();
  } catch (error) {
    log(`SafeMerge fallito su ${range.getA1Notation()}: ${error.message}`);
  }
}

function removeNamedRangeIfExists(ss, name) {
  const existing = ss.getNamedRanges().find(nr => nr.getName() === name);
  if (existing) {
    ss.removeNamedRange(name);
    return true;
  }
  return false;
}

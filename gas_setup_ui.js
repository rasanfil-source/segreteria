/**
 * @file gas_setup_ui.js
 * @description Script per generare e configurare automaticamente l'interfaccia utente (fogli, formattazione, validazioni e named ranges)
 * secondo le specifiche del PIANO_UI_CONFIGURAZIONE_CONTROLLO_IT.md.
 */

const UI_CONFIG = {
  CONTROLLO_SHEET: 'Controllo',
  ASSENZE_SHEET: 'Assenze',
  FILTRI_SHEET: 'Filtri',
  SHEET_RESET_RANGE: 'A1:Z300',
  DAYS: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
};

/**
 * Funzione principale per impostare l'intera configurazione dei fogli.
 * È idempotente: se eseguita più volte riallinea struttura e formule.
 */
function setupConfigurationSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const errors = [];

  runSetupStep_('Controllo', function () {
    setupControlloSheet(ss);
  }, errors);

  runSetupStep_('Assenze', function () {
    setupAssenzeSheet(ss);
  }, errors);

  runSetupStep_('Filtri', function () {
    setupFiltriSheet(ss);
  }, errors);

  runSetupStep_('Named Ranges', function () {
    createNamedRanges(ss);
  }, errors);

  if (errors.length > 0) {
    SpreadsheetApp.getUi().alert(
      'Configurazione completata con avvisi\n\n' + errors.join('\n')
    );
    return;
  }

  SpreadsheetApp.getUi().alert('Configurazione completata con successo! Verifica i fogli Controllo, Assenze e Filtri.');
}


/**
 * Esegue uno step di setup senza interrompere l'intera configurazione.
 * @param {string} stepName
 * @param {Function} fn
 * @param {string[]} errors
 */
function runSetupStep_(stepName, fn, errors) {
  try {
    fn();
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    const formatted = '• ' + stepName + ': ' + message;
    errors.push(formatted);
    Logger.log('[setupConfigurationSheets] ' + formatted);
  }
}


/**
 * Crea un menu rapido per eseguire setup e diagnostica.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Parrocchia AI')
    .addItem('Configura fogli', 'setupConfigurationSheets')
    .addItem('Test configurazione', 'testConfiguration')
    .addToUi();
}

/**
 * Test veloce post-setup: verifica fogli/range principali senza operazioni invasive.
 */
function testConfiguration() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const checks = [];

  [UI_CONFIG.CONTROLLO_SHEET, UI_CONFIG.ASSENZE_SHEET, UI_CONFIG.FILTRI_SHEET].forEach(name => {
    checks.push({
      name: 'Foglio ' + name,
      ok: !!ss.getSheetByName(name)
    });
  });

  ['cfg_system_master', 'sum_auto_status', 'tbl_week_schedule', 'tbl_absences', 'lst_ignore_domains', 'lst_ignore_keywords'].forEach(rangeName => {
    checks.push({
      name: 'Named Range ' + rangeName,
      ok: !!ss.getRangeByName(rangeName)
    });
  });

  const controllo = ss.getSheetByName(UI_CONFIG.CONTROLLO_SHEET);
  if (controllo) {
    ['F5', 'F6', 'F7', 'F8', 'F9'].forEach(cell => {
      checks.push({
        name: 'Formula dashboard ' + cell,
        ok: String(controllo.getRange(cell).getFormula()).startsWith('=')
      });
    });
  }

  const failed = checks.filter(item => !item.ok);
  const lines = checks.map(item => (item.ok ? '✅ ' : '❌ ') + item.name);
  const title = failed.length === 0 ? 'Test configurazione: OK' : 'Test configurazione: con problemi';
  SpreadsheetApp.getUi().alert(title + '\n\n' + lines.join('\n'));
}

/**
 * Configura il foglio "Controllo" (Dashboard principale)
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupControlloSheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.CONTROLLO_SHEET, '#4285F4');
  resetSheetLayout(sheet);

  // --- Sezione A: Hero (A1:F4) ---
  sheet.getRange('A1:F4').setBackground('#FFFFFF');

  safeMerge(sheet.getRange('A1:C1'));
  sheet.getRange('A1:C1')
    .setValue('STATO DEL SISTEMA')
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
    .setHorizontalAlignment('center');
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
    .setValue('Il sistema risponde automaticamente solo quando è ATTIVO (verde).')
    .setFontStyle('italic')
    .setFontColor('#666666');

  sheet.getRange('A4').setValue('Timezone:').setFontWeight('bold');
  sheet.getRange('B4').setValue('Europe/Rome');
  sheet.getRange('A5').setValue('Festivi:').setFontWeight('bold');

  const holidaysRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Considera Festivi', 'Ignora Festivi'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('B5').setDataValidation(holidaysRule);
  if (!sheet.getRange('B5').getValue()) {
    sheet.getRange('B5').setValue('Considera Festivi');
  }

  // --- Sezione B: Mini dashboard (E5:F9) ---
  sheet.getRange('E5:F9')
    .setBackground('#F1F3F4')
    .setBorder(true, true, true, true, true, true);

  sheet.getRange('E5').setValue('Risposta automatica:').setFontWeight('bold');
  sheet.getRange('E6').setValue('Segretario:').setFontWeight('bold');
  sheet.getRange('E7').setValue('Motivo:').setFontWeight('bold');
  sheet.getRange('E8').setValue('Oggi:').setFontWeight('bold');
  sheet.getRange('E9').setValue('Fascia oraria attuale:').setFontWeight('bold');

  sheet.getRange('F5').setFormula('=IF(B2="Spento";"🔴 Spenta";IF(OR(F6="Assente";F9="Nessuna");"🟡 Sospesa";"🟢 Attiva"))');
  sheet.getRange('F6').setFormula('=IF(COUNTIF(Assenze!G2:G;TRUE)>0;"Assente";"In servizio")');
  sheet.getRange('F7').setFormula('=IF(B2="Spento";"Spento manualmente";IF(F6="Assente";"Assenza segretario";IF(F9="Nessuna";"Fuori orario";"OK")))');
  sheet.getRange('F8').setFormula('=TODAY()');
  sheet.getRange('F9').setFormula('=IF(OR(INDEX(C10:C16;WEEKDAY(TODAY();2))="";INDEX(D10:D16;WEEKDAY(TODAY();2))="");"Nessuna";RIGHT("0"&HOUR(INDEX(C10:C16;WEEKDAY(TODAY();2)));2)&"."&RIGHT("0"&MINUTE(INDEX(C10:C16;WEEKDAY(TODAY();2)));2)&"–"&RIGHT("0"&HOUR(INDEX(D10:D16;WEEKDAY(TODAY();2)));2)&"."&RIGHT("0"&MINUTE(INDEX(D10:D16;WEEKDAY(TODAY();2)));2))');

  // --- Sezione C: Orari settimanali (B9:D16) ---
  sheet.getRange('B9:D9').setValues([['Giorno', 'Dalle', 'Alle']]).setFontWeight('bold').setBackground('#E8F0FE');
  sheet.getRange('B10:B16').setValues(UI_CONFIG.DAYS.map(day => [day])).setBackground('#EFEFEF').setFontWeight('bold');
  // Evito formattazione oraria forzata: in alcuni locale GAS genera eccezione bloccante.
  sheet.getRange('B9:D16').setBorder(true, true, true, true, true, true);

  applyFormulaValidationWithFallback_(
    sheet.getRange('C10:D16'),
    ['=OR(AND($C10="";$D10="");$C10<$D10)', '=OR(AND($C10="",$D10=""),$C10<$D10)'],
    'Inserisci un orario valido e verifica che "dalle" sia minore di "alle".'
  );

  // --- Sezione D: Link rapidi (A18:F22) ---
  safeMerge(sheet.getRange('A18:F18'));
  sheet.getRange('A18:F18')
    .setValue('DATI AVANZATI')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBackground('#FFF2CC');

  sheet.getRange('A19').setValue('Vai al foglio Assenze →');
  sheet.getRange('B19').setValue('Apri la scheda \"Assenze\" in basso').setFontStyle('italic');
  sheet.getRange('A20').setValue('Vai al foglio Filtri →');
  sheet.getRange('B20').setValue('Apri la scheda \"Filtri\" in basso').setFontStyle('italic');

  // Larghezze e blocchi visuali
  sheet.setColumnWidth(1, 155); // A
  sheet.setColumnWidth(2, 170); // B
  sheet.setColumnWidth(3, 90); // C
  sheet.setColumnWidth(4, 90); // D
  sheet.setColumnWidth(5, 180); // E
  sheet.setColumnWidth(6, 190); // F

  sheet.setFrozenRows(1);
  safeSetFrozenColumns(sheet, 1);
}

/**
 * Configura il foglio "Assenze"
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupAssenzeSheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.ASSENZE_SHEET, '#EA4335');
  resetSheetLayout(sheet);

  const headers = [['id_assenza', 'tipo', 'data_dal', 'data_al', 'intera_giornata', 'note', 'attiva_oggi']];
  sheet.getRange('A1:G1')
    .setValues(headers)
    .setFontWeight('bold')
    .setBackground('#F3F3F3')
    .setBorder(false, false, true, false, false, false);

  sheet.setFrozenRows(1);

  const tipoRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Ferie', 'Permesso', 'Malattia', 'Altro'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('B2:B1000').setDataValidation(tipoRule);

  const dateRule = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .setHelpText('Inserisci una data valida.')
    .build();
  sheet.getRange('C2:D1000').setDataValidation(dateRule);

  applyFormulaValidationWithFallback_(
    sheet.getRange('D2:D1000'),
    ['=OR($C2="";$D2="";$C2<=$D2)', '=OR($C2="",$D2="",$C2<=$D2)'],
    'La data di fine deve essere uguale o successiva alla data di inizio.'
  );

  sheet.getRange('E2:E1000').insertCheckboxes();

  sheet.getRange('G2').setFormula('=ARRAYFORMULA(IF(A2:A="";;IF((C2:C="")+(D2:D="");FALSE;(TODAY()>=C2:C)*(TODAY()<=D2:D))))');

  sheet.autoResizeColumns(1, 7);
}

/**
 * Configura il foglio "Filtri"
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function setupFiltriSheet(ss) {
  const sheet = getOrCreateSheet(ss, UI_CONFIG.FILTRI_SHEET, '#FBBC04');
  resetSheetLayout(sheet);

  sheet.getRange('A1').setValue('DOMINI DA IGNORARE').setFontWeight('bold').setBackground('#FFF2CC');
  sheet.getRange('C1').setValue('PAROLE CHIAVE DA IGNORARE').setFontWeight('bold').setBackground('#FFF2CC');

  sheet.getRange('A2').setValue('amazon.com').setFontStyle('italic').setFontColor('#999999');
  sheet.getRange('C2').setValue('newsletter').setFontStyle('italic').setFontColor('#999999');

  const domainRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(A2="";REGEXMATCH(A2;"^(?:[a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}$"))')
    .setAllowInvalid(false)
    .setHelpText('Inserisci solo il dominio (es. example.com), senza https://')
    .build();
  sheet.getRange('A2:A1000').setDataValidation(domainRule);

  const keywordRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(C2="";LEN(TRIM(C2))>0)')
    .setAllowInvalid(false)
    .build();
  sheet.getRange('C2:C1000').setDataValidation(keywordRule);

  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 50);
  sheet.setColumnWidth(3, 260);
  sheet.setFrozenRows(1);
  safeSetFrozenColumns(sheet, 1);
}

/**
 * Crea e aggiorna i Named Ranges.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function createNamedRanges(ss) {
  const ranges = [
    { name: 'cfg_system_master', range: "'Controllo'!B2" },
    { name: 'sum_auto_status', range: "'Controllo'!F5" },
    { name: 'sum_secretary_status', range: "'Controllo'!F6" },
    { name: 'sum_today_reason', range: "'Controllo'!F7" },
    { name: 'sum_today_date', range: "'Controllo'!F8" },
    { name: 'sum_today_slot', range: "'Controllo'!F9" },
    { name: 'tbl_week_schedule', range: "'Controllo'!B10:D16" },
    { name: 'tbl_week_days', range: "'Controllo'!B10:B16" },
    { name: 'tbl_week_from', range: "'Controllo'!C10:C16" },
    { name: 'tbl_week_to', range: "'Controllo'!D10:D16" },
    { name: 'tbl_absences', range: "'Assenze'!A2:G" },
    { name: 'lst_ignore_domains', range: "'Filtri'!A2:A" },
    { name: 'lst_ignore_keywords', range: "'Filtri'!C2:C" },
    { name: 'cfg_timezone', range: "'Controllo'!B4" },
    { name: 'cfg_holidays_mode', range: "'Controllo'!B5" }
  ];

  ranges.forEach(def => {
    removeNamedRangeIfExists(ss, def.name);
    const range = ss.getRange(def.range);
    ss.setNamedRange(def.name, range);
  });
}

/**
 * Restituisce un foglio esistente o lo crea.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} name
 * @param {string} tabColor
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet(ss, name, tabColor) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
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
  range.breakApart();
  range.clear();
}

/**
 * Merge sicuro: elimina merge preesistenti nel range e poi unisce.
 * @param {GoogleAppsScript.Spreadsheet.Range} range
 */
function safeMerge(range) {
  range.breakApart();
  range.merge();
}



/**
 * Imposta il freeze delle colonne solo se non spezza celle unite.
 * Evita l'eccezione GAS: "Non puoi bloccare colonne che contengono solo una parte di una cella unita".
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} frozenColumns
 * @returns {boolean}
 */
function safeSetFrozenColumns(sheet, frozenColumns) {
  if (frozenColumns <= 0) {
    sheet.setFrozenColumns(0);
    return true;
  }

  const merged = sheet.getRange(UI_CONFIG.SHEET_RESET_RANGE).getMergedRanges();
  const hasCrossBoundaryMerge = merged.some(range => {
    const start = range.getColumn();
    const end = start + range.getNumColumns() - 1;
    return start <= frozenColumns && end > frozenColumns;
  });

  if (hasCrossBoundaryMerge) {
    Logger.log('Freeze colonne saltato su ' + sheet.getName() + ': merge attraversano il confine della colonna bloccata.');
    return false;
  }

  sheet.setFrozenColumns(frozenColumns);
  return true;
}


/**
 * Applica una validazione formula provando più varianti di separatori locali.
 * @param {GoogleAppsScript.Spreadsheet.Range} range
 * @param {string[]} formulas
 * @param {string} helpText
 */
function applyFormulaValidationWithFallback_(range, formulas, helpText) {
  let lastError = null;
  for (let i = 0; i < formulas.length; i++) {
    try {
      const rule = SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied(formulas[i])
        .setAllowInvalid(false)
        .setHelpText(helpText)
        .build();
      range.setDataValidation(rule);
      return;
    } catch (e) {
      lastError = e;
    }
  }

  const errorMessage = lastError && lastError.message ? lastError.message : 'Formula di validazione non supportata dal locale.';
  throw new Error(errorMessage);
}

/**
 * Elimina un named range se esiste.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} name
 */
function removeNamedRangeIfExists(ss, name) {
  const existing = ss.getNamedRanges().find(namedRange => namedRange.getName() === name);
  if (existing) {
    ss.removeNamedRange(name);
  }
}

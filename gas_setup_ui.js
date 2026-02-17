/**
 * @file gas_setup_ui.js
 * @description Script per generare e configurare automaticamente l'interfaccia utente (fogli, formattazione, named ranges)
 * secondo le specifiche del PIANO_UI_CONFIGURAZIONE_CONTROLLO_IT.md.
 */

/**
 * Funzione principale per impostare l'intera configurazione dei fogli.
 * Esegui questa funzione una volta sola (o per aggiornare la struttura).
 */
function setupConfigurationSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Setup foglio Controllo
  setupControlloSheet(ss);
  
  // 2. Setup foglio Assenze
  setupAssenzeSheet(ss);
  
  // 3. Setup foglio Filtri
  setupFiltriSheet(ss);
  
  // 4. Creazione Named Ranges
  createNamedRanges(ss);
  
  SpreadsheetApp.getUi().alert('Configurazione completata con successo! Verifica i fogli Controllo, Assenze e Filtri.');
}

/**
 * Configura il foglio "Controllo" (Dashboard Principale)
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss 
 */
function setupControlloSheet(ss) {
  let sheet = ss.getSheetByName('Controllo');
  if (!sheet) {
    sheet = ss.insertSheet('Controllo');
  } else {
    sheet.activate();
  }
  
  sheet.setTabColor('#4285F4'); // Google Blue

  // --- SEZIONE A: EROE (A1:F4) ---
  sheet.getRange('A1:F4').setBackground('white');
  
  // Titolo Stato
  const titleRange = sheet.getRange('A2:C2');
  try {
    titleRange.merge();
  } catch (e) {} // Ignora se già unito
  titleRange.setValue('STATO DEL SISTEMA');
  titleRange.setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center').setVerticalAlignment('middle');
  titleRange.setBackground('#E8F0FE'); // Light blue
  
  // Master Switch (B3) - Spostato in B3 per non confliggere con merge A2:C2.
  // Nel piano originale era B2 ma A2:C2 era unito. Risolviamo mettendo Toggle sotto il titolo.
  
  const toggleLabel = sheet.getRange('A3');
  toggleLabel.setValue('Interruttore:').setFontWeight('bold');

  const toggleCell = sheet.getRange('B3');
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Acceso', 'Spento'], true)
    .setAllowInvalid(false)
    .build();
  toggleCell.setDataValidation(rule);
  if (toggleCell.getValue() === '') toggleCell.setValue('Acceso');
  toggleCell.setFontWeight('bold').setHorizontalAlignment('center');
  
  // Badge E2:F2
  const badgeRange = sheet.getRange('E2:F2');
  try {
    badgeRange.merge();
  } catch (e) {}
  badgeRange.setFormula(`=IF(B3="Spento"; "🔴 Spenta"; IF(OR(F6="Assente"; F9=""); "🟡 Sospesa"; "🟢 Attiva"))`);
  badgeRange.setHorizontalAlignment('center').setFontWeight('bold').setFontSize(12);
  
  // Descrizione A4:F4
  const descRange = sheet.getRange('A4:F4');
  try {
    descRange.merge();
  } catch (e) {}
  descRange.setValue('Il sistema risponde automaticamente solo quando è ATTIVO (verde).');
  descRange.setFontStyle('italic').setFontColor('#666666');

  // --- SEZIONE B: MINI DASHBOARD (E5:F9) ---
  const dashboardColor = '#F1F3F4'; // Light Grey
  sheet.getRange('E5:F9').setBackground(dashboardColor).setBorder(true, true, true, true, true, true);
  
  sheet.getRange('E5').setValue('Risposta automatica:').setFontWeight('bold');
  sheet.getRange('E6').setValue('Segretario:').setFontWeight('bold');
  sheet.getRange('E7').setValue('Motivo:').setFontWeight('bold');
  sheet.getRange('E8').setValue('Oggi:').setFontWeight('bold');
  sheet.getRange('E9').setValue('Fascia oraria:').setFontWeight('bold');
  
  // Formule Dashboard
  sheet.getRange('F5').setFormula('=E2'); // Copia lo stato dal badge
  // F6 e F7 richiedono dati Assenze non ancora popolati, mettiamo placeholder robusti
  sheet.getRange('F6').setValue('In servizio'); 
  sheet.getRange('F7').setValue('OK');
  sheet.getRange('F8').setValue(new Date()).setNumberFormat('dd/MM/yyyy');
  sheet.getRange('F9').setValue('Calcolato da Script'); 

  // --- SEZIONE C: ORARI SETTIMANALI (B10:D16) ---
  sheet.getRange('B10:D16').setBorder(true, true, true, true, false, false);
  
  // Giorni precompilati
  const days = [['Lunedì'], ['Martedì'], ['Mercoledì'], ['Giovedì'], ['Venerdì'], ['Sabato'], ['Domenica']];
  sheet.getRange('B10:B16').setValues(days).setBackground('#EFEFEF').setFontWeight('bold');
  
  // Intestazioni tabella orari
  sheet.getRange('B9').setValue('Giorno').setFontWeight('bold');
  sheet.getRange('C9').setValue('Dalle').setFontWeight('bold');
  sheet.getRange('D9').setValue('Alle').setFontWeight('bold');
  
  // Formattazione Orari
  sheet.getRange('C10:D16').setNumberFormat('HH:mm');
  
  // --- PULIZIA VISIVA ---
  sheet.setColumnWidth(1, 50); // A
  sheet.setColumnWidth(2, 100); // B
  sheet.setColumnWidth(3, 80); // C
  sheet.setColumnWidth(4, 80); // D
  sheet.setColumnWidth(5, 150); // E
  sheet.setColumnWidth(6, 150); // F
}

/**
 * Configura il foglio "Assenze"
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss 
 */
function setupAssenzeSheet(ss) {
  let sheet = ss.getSheetByName('Assenze');
  if (!sheet) {
    sheet = ss.insertSheet('Assenze');
  }
  
  sheet.setTabColor('#EA4335'); // Google Red
  
  const headers = [['id_assenza', 'tipo', 'data_dal', 'data_al', 'intera_giornata', 'note', 'attiva_oggi']];
  const headerRange = sheet.getRange('A1:G1');
  headerRange.setValues(headers);
  headerRange.setFontWeight('bold').setBackground('#f3f3f3').setBorder(false, false, true, false, false, false);
  
  sheet.setFrozenRows(1);
  
  // Validazione Tipo (Colonna B)
  const ruleTipo = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Ferie', 'Permesso', 'Malattia', 'Chiusura Ufficio', 'Altro'], true)
    .build();
  sheet.getRange('B2:B100').setDataValidation(ruleTipo);
  
  // Validazione Date (C e D)
  const ruleDate = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .setHelpText('Inserisci una data valida.')
    .build();
  sheet.getRange('C2:D100').setDataValidation(ruleDate);
  sheet.getRange('C2:D100').setNumberFormat('dd/MM/yyyy');
  
  // Checkbox Intera Giornata (Colonna E)
  sheet.getRange('E2:E100').insertCheckboxes();
  
  // Esempio formula in G2 (non trascinata per non appesantire, l'utente dovrà copiarla)
  // sheet.getRange('G2').setFormula('=...')... lo lascio vuoto per ora o metto una nota.
  
  sheet.autoResizeColumns(1, 7);
}

/**
 * Configura il foglio "Filtri"
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss 
 */
function setupFiltriSheet(ss) {
  let sheet = ss.getSheetByName('Filtri');
  if (!sheet) {
    sheet = ss.insertSheet('Filtri');
  }
  
  sheet.setTabColor('#FBBC04'); // Google Yellow
  
  sheet.getRange('A1').setValue('DOMINI DA IGNORARE').setFontWeight('bold').setBackground('#FFF2CC');
  sheet.getRange('C1').setValue('PAROLE CHIAVE DA IGNORARE').setFontWeight('bold').setBackground('#FFF2CC');
  
  // Esempi
  sheet.getRange('A2').setValue('amazon.com').setFontStyle('italic').setFontColor('#999');
  sheet.getRange('C2').setValue('newsletter').setFontStyle('italic').setFontColor('#999');
  
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 50); // Spaziatore B
  sheet.setColumnWidth(3, 200);
  
  sheet.setFrozenRows(1);
}

/**
 * Crea e aggiorna i Named Ranges
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss 
 */
function createNamedRanges(ss) {
  // Nota: I nomi dei range devono riferirsi ai fogli creati.
  // Assicuro che se B3 è il toggle, il named range punti a B3.
  const ranges = [
    { name: 'cfg_system_master', range: "'Controllo'!B3" }, // Aggiornato a B3
    { name: 'sum_auto_status', range: "'Controllo'!F5" },
    { name: 'sum_secretary_status', range: "'Controllo'!F6" },
    { name: 'sum_today_reason', range: "'Controllo'!F7" },
    { name: 'sum_today_date', range: "'Controllo'!F8" },
    { name: 'sum_today_slot', range: "'Controllo'!F9" },
    { name: 'tbl_week_schedule', range: "'Controllo'!B10:D16" },
    { name: 'tbl_week_days', range: "'Controllo'!B10:B16" },
    { name: 'tbl_week_from', range: "'Controllo'!C10:C16" },
    { name: 'tbl_week_to', range: "'Controllo'!D10:D16" },
    { name: 'tbl_absences', range: "'Assenze'!A2:G100" }, // Limitato per evitare errori su fogli vuoti infiniti
    { name: 'lst_ignore_domains', range: "'Filtri'!A2:A100" },
    { name: 'lst_ignore_keywords', range: "'Filtri'!C2:C100" },
    { name: 'cfg_timezone', range: "'Controllo'!B4" },
    { name: 'cfg_holidays_mode', range: "'Controllo'!B5" }
  ];

  ranges.forEach(def => {
    try {
      // Prova a cancellare se esiste (non lancia errore se non esiste in GAS moderno solitamente, ma per sicurezza catch)
      ss.removeNamedRange(def.name); 
    } catch(e) {}
    
    try {
      const range = ss.getRange(def.range);
      ss.setNamedRange(def.name, range);
    } catch (e) {
      Logger.log(`Errore creazione range ${def.name}: ${e.message}`);
    }
  });
}

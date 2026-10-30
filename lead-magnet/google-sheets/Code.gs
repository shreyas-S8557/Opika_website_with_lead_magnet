/**
 * Opika · Visibility & Growth Review submissions log (Google Apps Script, bound to your Sheet)
 *
 * The website calls this web app twice per submission:
 *   1. action "create"  when the quiz is submitted        → new row, Status "Received"
 *   2. action "update"  when the review is sent or fails  → same row: Status, Report URL,
 *                                                            Email Status, Review Type, Error
 * Rows are matched by "Submission ID".
 *
 * Setup: see lead-magnet/README.md → "Google Sheets log". In short:
 *   Extensions → Apps Script → paste this file → Project Settings → Script properties →
 *   add OPIKA_TOKEN (any long random string, same value as SHEETS_TOKEN in Vercel) →
 *   Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone →
 *   copy the /exec URL into SHEETS_WEBHOOK_URL in Vercel.
 */

const SHEET_NAME = 'Submissions';

// The first eleven columns are unchanged from the original sheet, so existing rows still line up.
const HEADERS = [
  'Timestamp',
  'Name',
  'Email',
  'Company',
  'Website',
  'Priority',
  'Friction',
  'Status',
  'Report URL',
  'Email Status',
  'Error',
  'Submission ID',
  'Review Type',
];
const COL = HEADERS.reduce((m, h, i) => ((m[h] = i + 1), m), {});

function setupSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (current.join('|') !== HEADERS.join('|')) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    let data = {};
    if (e.postData && e.postData.type && e.postData.type.indexOf('application/json') !== -1) {
      data = JSON.parse(e.postData.contents);
    } else {
      data = e.parameter || {};
    }

    // Only the Opika website (which knows the token) may write to the sheet.
    const token = PropertiesService.getScriptProperties().getProperty('OPIKA_TOKEN');
    if (token && data.token !== token) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

    lock.waitLock(20000); // two submissions at once can't overwrite each other
    const sheet = setupSheet();

    if (data.action === 'update') return updateRow(sheet, data);

    // action "create" (default)
    if (!clean(data.name)) return jsonResponse({ success: false, error: 'Missing required field: name' });
    if (!clean(data.email)) return jsonResponse({ success: false, error: 'Missing required field: email' });
    // The quiz accepts a website OR a business name, so one of the two is enough.
    if (!clean(data.company) && !clean(data.website)) {
      return jsonResponse({ success: false, error: 'Missing required field: company or website' });
    }

    const row = new Array(HEADERS.length).fill('');
    row[COL['Timestamp'] - 1] = new Date();
    row[COL['Name'] - 1] = safe(data.name);
    row[COL['Email'] - 1] = safe(data.email);
    row[COL['Company'] - 1] = safe(data.company);
    row[COL['Website'] - 1] = safe(data.website);
    row[COL['Priority'] - 1] = safe(data.priority);
    row[COL['Friction'] - 1] = safe(data.friction);
    row[COL['Status'] - 1] = 'Received';
    row[COL['Email Status'] - 1] = 'Pending';
    row[COL['Submission ID'] - 1] = safe(data.id);
    sheet.appendRow(row);

    return jsonResponse({ success: true, message: 'Submission received', id: clean(data.id) });
  } catch (error) {
    console.error(error);
    return jsonResponse({ success: false, error: error.message });
  } finally {
    try {
      lock.releaseLock();
    } catch (err) {}
  }
}

function updateRow(sheet, data) {
  const id = clean(data.id);
  if (!id) return jsonResponse({ success: false, error: 'Missing required field: id' });

  const last = sheet.getLastRow();
  if (last < 2) return jsonResponse({ success: false, error: 'Submission not found: ' + id });
  const ids = sheet.getRange(2, COL['Submission ID'], last - 1, 1).getValues();
  let rowNumber = 0;
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === id) {
      rowNumber = i + 2;
      break;
    }
  }
  if (!rowNumber) return jsonResponse({ success: false, error: 'Submission not found: ' + id });

  // Only the fields that were sent are changed.
  const fields = {
    Status: data.status,
    'Report URL': data.reportUrl,
    'Email Status': data.emailStatus,
    Error: data.error,
    'Review Type': data.reviewType,
    Company: data.company, // the real business name, once research has found it
  };
  Object.keys(fields).forEach(function (header) {
    if (fields[header] !== undefined && fields[header] !== null) {
      sheet.getRange(rowNumber, COL[header]).setValue(safe(fields[header]));
    }
  });

  return jsonResponse({ success: true, message: 'Submission updated', row: rowNumber });
}

function doGet() {
  return jsonResponse({ success: true, service: 'Opika Opportunity Brief Automation' });
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

// Form answers are typed by the public: stop text like "=IMPORTXML(...)" running as a formula.
function safe(value) {
  const v = clean(value).slice(0, 2000);
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Odeum — "Summertime in Prague" beta signups
 * Google Apps Script backend (bound to a Google Sheet).
 *
 * What it does:
 *  - GET  -> returns the list of slots already taken (so the page can show Full/Open live)
 *  - POST -> tries to claim one slot for one person. Uses a script lock so two people
 *            submitting at the same instant can't both take the same slot. If the slot
 *            was taken a moment earlier, it politely refuses.
 *
 * A "slot" is one character on one session, identified by slotId = "<session>|<character>".
 * To CANCEL a signup and reopen the slot: in the Sheet, set that row's Status to
 * "Cancelled" (or delete the row). The slot becomes available again immediately.
 *
 * Setup steps are in SETUP.md.
 */

var SHEET_NAME = 'Signups';
var HEADERS = ['Timestamp', 'SlotID', 'Session', 'Character', 'Name', 'Email', 'Phone', 'RecommendedBy', 'Status'];

function doGet(e) {
  return json_({ ok: true, taken: Array.from(takenSet_()) });
}

function doPost(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var slotId = String(p.slotId || '').trim();
  var name = String(p.name || '').trim();
  var email = String(p.email || '').trim();

  if (!slotId) return json_({ ok: false, error: 'missing_slot' });
  if (!name || !email) return json_({ ok: false, error: 'missing_fields' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // wait up to 20s for any other submission to finish
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }

  try {
    if (takenSet_().has(slotId)) {
      return json_({ ok: false, error: 'taken' });
    }
    sheet_().appendRow([
      new Date(),
      slotId,
      String(p.session || ''),
      String(p.character || ''),
      name,
      email,
      String(p.phone || ''),
      String(p.recommendedBy || ''),
      'Confirmed'
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- helpers ---------- */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function takenSet_() {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  var set = {};
  var out = new Set();
  for (var i = 1; i < values.length; i++) {
    var slotId = String(values[i][1] || '').trim();
    var status = String(values[i][8] || '').toLowerCase();
    if (slotId && status !== 'cancelled') out.add(slotId);
  }
  return out;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

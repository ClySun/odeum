/**
 * Odeum — "Summertime in Prague" beta signups
 * Google Apps Script backend (bound to a Google Sheet).
 *
 * Flow: a guest sends a REQUEST for one character on one session.
 *   - GET  -> returns each taken slot and its status, so the page can show Open / Pending / Taken
 *   - POST -> records a request as "Pending" (with a script lock so a slot can't be double-requested)
 *
 * A "slot" is one character on one session: slotId = "<session>|<character>".
 * The slot locks the moment someone requests it (status Pending), so no one else can request it.
 *
 * YOU confirm requests by hand in the sheet:
 *   - set Status to "Confirmed" to mark the spot as officially taken, or
 *   - set Status to "Cancelled" (or "Rejected") to REOPEN the slot for others.
 * Anything that isn't Cancelled/Rejected/Declined/blank keeps the slot closed.
 *
 * Setup steps are in SETUP.md.
 */

var SHEET_NAME = 'Signups';
var HEADERS = ['Timestamp', 'SlotID', 'Session', 'Character', 'Age', 'Name', 'Email', 'Phone', 'RecommendedBy', 'Status'];
var OPEN_STATUSES = { '': 1, 'cancelled': 1, 'canceled': 1, 'rejected': 1, 'declined': 1 };
var NOTIFY_EMAIL = 'sunpuxin@gmail.com'; // a note is emailed here on every new signup

function doGet(e) {
  return json_({ ok: true, slots: takenMap_() });
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
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }

  try {
    if (takenMap_().hasOwnProperty(slotId)) {
      return json_({ ok: false, error: 'taken' });
    }
    sheet_().appendRow([
      new Date(),
      slotId,
      String(p.session || ''),
      String(p.character || ''),
      String(p.age || ''),
      name,
      email,
      String(p.phone || ''),
      String(p.recommendedBy || ''),
      'Pending'
    ]);
    notify_(p, name, email);
    return json_({ ok: true, status: 'Pending' });
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

/** Returns { slotId: "Pending" | "Confirmed" | ... } for every slot that is NOT open. */
function takenMap_() {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var slotId = String(values[i][1] || '').trim();
    var status = String(values[i][9] || '').trim();
    if (!slotId) continue;
    if (OPEN_STATUSES[status.toLowerCase()]) continue; // cancelled/rejected/blank -> open
    map[slotId] = status || 'Pending';
  }
  return map;
}

/** Emails NOTIFY_EMAIL about a new signup. Never blocks the signup if it fails. */
function notify_(p, name, email) {
  try {
    var character = String(p.character || '');
    var session = String(p.session || '');
    var body =
      'New Odeum beta signup (Pending)\n\n' +
      'Character:   ' + character + '\n' +
      'Session:     ' + session + '\n' +
      'Name:        ' + name + '\n' +
      'Age:         ' + String(p.age || '') + '\n' +
      'Email:       ' + email + '\n' +
      'Phone:       ' + String(p.phone || '') + '\n' +
      'Invited by:  ' + String(p.recommendedBy || '') + '\n\n' +
      'Confirm or decline by editing the Status column in the sheet.';
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: 'New signup: ' + character + ' — ' + session,
      replyTo: email,
      body: body
    });
  } catch (err) {
    // Email failed (e.g. quota) — the signup still succeeds.
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

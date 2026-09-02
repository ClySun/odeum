# Beta signups — Google Sheet setup (~5 minutes)

This connects the "Summertime in Prague" beta page to a Google Sheet you own.
You do these steps once; then the page reads live availability and writes signups
into your sheet, and no two people can take the same cast slot.

## 1. Make the sheet
1. Go to https://sheets.google.com and create a **blank** spreadsheet.
2. Name it something like **"Odeum — Prague beta signups."**

## 2. Add the script
1. In that sheet: **Extensions → Apps Script**.
2. Delete whatever code is in the editor, and paste the entire contents of
   [`Code.gs`](Code.gs) from this folder.
3. Click the **Save** icon (💾).

## 2b. Limit permissions to THIS sheet only (important)
By default Google asks for access to *all* your spreadsheets. Narrow it to just this one:
1. Click the **⚙ Project Settings** (gear, left sidebar) → tick
   **"Show 'appsscript.json' manifest file in editor."**
2. Back in the **Editor** (`< >`), open **`appsscript.json`** and add an `oauthScopes` line so it
   matches [`appsscript.json`](appsscript.json) in this folder — the key line is:
   ```json
   "oauthScopes": ["https://www.googleapis.com/auth/spreadsheets.currentonly"],
   ```
   (Keep your existing `timeZone`.) **Save.**
   Now the consent screen will only grant access to *this* spreadsheet.

## 3. Deploy it as a web app
1. Top right: **Deploy → New deployment**.
2. Click the gear next to "Select type" → choose **Web app**.
3. Set:
   - **Description:** Prague signups
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**   ← important (this is what lets the website reach it)
4. Click **Deploy**.
5. Google will ask you to **authorize** — approve it (it's your own script writing to your own sheet).
   If you see "Google hasn't verified this app," click **Advanced → Go to (your project) → Allow**.
6. Copy the **Web app URL** it gives you. It looks like:
   `https://script.google.com/macros/s/AKfyc..../exec`

## 4. Send me that URL
Paste the Web app URL back in the chat. I'll plug it into the page and publish — signups go live.

---

## How requests work
- A guest **requests** a character on a session. The row is logged with **Status = `Pending`**,
  and that slot immediately shows as **Pending** on the site — no one else can request it.
- Each row records: Timestamp, Session, Character, **Age**, Name, Email, Phone, RecommendedBy, Status.

## Managing requests (your side, in the sheet)
- **To approve someone:** change their row's **Status** from `Pending` to **`Confirmed`**.
  The site then shows that slot as **Taken**.
- **To decline / free the slot:** set **Status** to **`Cancelled`** (or `Rejected`), or delete the row.
  The slot returns to **Open** for others within a minute.
- Leaving a row as `Pending` keeps the slot held (shown as Pending) but not yet officially taken.

## Email notifications on every signup
The script emails **sunpuxin@gmail.com** each time someone requests a seat (name, character,
session, age, email, phone, who invited them). To turn this on, you must update the deployed script:

1. **Extensions → Apps Script**, replace the code with the latest [`Code.gs`](Code.gs).
2. Open **`appsscript.json`** and make sure `oauthScopes` matches [`appsscript.json`](appsscript.json)
   here — it now also includes `.../auth/script.send_mail`.
3. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**
4. **Grant the email permission by running a function once** (deploying alone doesn't prompt for it):
   in the editor, pick **`testNotify`** in the function dropdown at the top, click **Run**, and approve
   the prompts — this time you'll see **"Send email as you."** Approve it. A test email arrives at
   NOTIFY_EMAIL, and real signups will email you from then on. (No new deployment needed after this.)

(Change the address by editing `NOTIFY_EMAIL` at the top of `Code.gs`. Gmail's free send limit is
~100 emails/day, which is plenty for a beta.)

## If you change the script later
Redeploy with **Deploy → Manage deployments → Edit (✏️) → Version: New version → Deploy**
so changes take effect. The URL stays the same.

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

## If you change the script later
Redeploy with **Deploy → Manage deployments → Edit (✏️) → Version: New version → Deploy**
so changes take effect. The URL stays the same.

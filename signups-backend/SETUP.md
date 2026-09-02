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

## Managing signups afterwards
- Every confirmed signup appears as a row in the **Signups** tab (name, email, phone, who
  recommended them, which character, which session).
- **To cancel someone and reopen their slot:** change that row's **Status** cell from
  `Confirmed` to `Cancelled` (or delete the row). The slot shows as Open again within a minute.
- **If you change the script later:** redeploy with **Deploy → Manage deployments → Edit (✏️)
  → Version: New version → Deploy** so the changes take effect. (The URL stays the same.)

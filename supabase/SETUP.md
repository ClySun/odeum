# Odeum database (Supabase) setup

The signup flow at `/signup/` and the player portal (`/signup/?portal`) use this Supabase project:
`https://xzeflephpasmmgaanomq.supabase.co`. Until step 1 is done, the site runs in **preview
mode**: everything works, but nothing is saved and no emails are sent.

## 1. Create the database (once)
1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the whole of [`schema.sql`](schema.sql) → **Run**. It's safe to run again after changes.

## 2. Make the login emails send a 6-digit code
**Authentication → Sign In / Providers → Email:** set **Email OTP Length** to **6** and **Email OTP Expiration**
to about **600** seconds. (New projects may default to 8 digits; the site accepts 6–10 either way.)

**Authentication → Emails → Templates.** Edit **both "Magic Link" and "Confirm signup"**. A person's very first
code uses "Confirm signup", so if that one still has a link instead of `{{ .Token }}`, new players get a link
they can't use. (If one address keeps getting the old "Confirm your email address" link email after you've
fixed the template, its account was created before the fix: delete it in Authentication → Users and try again.)
- Subject: `Your Odeum code`
- Body:
  ```html
  <h2>Your Odeum code</h2>
  <p>Enter this code to continue: <strong style="font-size:22px;letter-spacing:4px">{{ .Token }}</strong></p>
  <p>It expires soon. If you didn't ask for it, you can ignore this email.</p>
  ```

## 3. Connect an email sender (required for real players)
*Done 29 Sep 2026: Brevo, sending as Odeum <hello@odeumgames.com>. Spaceship forwards all @odeumgames.com mail
to Gmail. SMTP host `smtp-relay.brevo.com`, port 587, username = the `…@smtp-brevo.com` login on Brevo's
SMTP & API page (not your Brevo sign-in email), password = a Brevo SMTP key.*

Supabase's built-in sender only works for testing (it's heavily rate-limited and won't deliver to
most addresses). In **Authentication → Emails → SMTP Settings**, turn on custom SMTP. You enter
these credentials **yourself** in the dashboard. Never paste them into chat or the website.
- **Resend** (free: 3,000/month, 100/day). Verify `odeumgames.com` in Resend, create an API key,
  then use host `smtp.resend.com`, port `465`, user `resend`, password = the API key,
  sender e.g. `hello@odeumgames.com`.
- **or Gmail**. Turn on 2-Step Verification, create an **App Password**, then use host `smtp.gmail.com`,
  port `465`, user = your Gmail address, password = the app password. (About 500 emails/day.)

Then in **Authentication → Rate Limits**, check the email limit suits you (e.g. 30/hour).

## 4. Lock down your accounts
- Turn on **two-factor authentication** for your Supabase account (and your GitHub account).
- The **publishable key** in `signup/games.js` is meant to be public. The **secret key**
  (`sb_secret_…` / service_role) must never go in the website, the repo, or a chat.
- In **Project Settings → Data API**, leave *Exposed schemas* as `public` only. Never add `private`.

## Day-to-day admin
Everything is in **Table Editor**. Switch the schema dropdown (top left) to **private**.

| Table | What it is |
|---|---|
| `dates` | Game nights. **Add a row** to open a night. Set `status` to `Closed` (or delete it) to hide it. `time_label` is optional (blank = 6:00–11:00 PM). |
| `bookings` | One row per booking. `status`: Draft → Booked; set **Cancelled** to free the seats. |
| `players` | One row per person. Type a character id (`eva`, `vaclav`, `milan`, `vera`, `tomas`, `petra`) into **assigned_character** to seat them. |
| `pairing_comfort` | **Private** romantic-pairing comfort answers. Only you and that person ever see these. |
| `profiles` | Players' saved details (used to pre-fill and in their portal). |

**Seat someone by hand:** SQL Editor →
```sql
select private.admin_add_player('2026-10-24', 'Jane Doe', 'jane@example.com', '26–35', 'woman', 'eva');
```
(The last value, the character, is optional.)

**Someone asks you to delete their data:** SQL Editor →
```sql
select private.admin_forget('jane@example.com');
```
This deletes their login, profile, unfinished drafts, and pairing answers, and blanks their details
everywhere else. Any seat they held stays counted as "(deleted)" until you cancel that booking.

Unverified drafts (people who never confirmed their email) are deleted automatically after 30 days.

## Keeping the free project awake
Free Supabase projects pause after a week without traffic. The GitHub workflow
`.github/workflows/supabase-keepalive.yml` makes one harmless availability check every 3 days so
that doesn't happen. (It only uses the public key.)

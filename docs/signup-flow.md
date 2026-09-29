# Odeum signup flow — design spec

Consolidated from the design conversation with ChatGPT (2026-09). This is the *final* state
after all revisions; superseded ideas are listed at the bottom so they don't creep back in.

## Core model

- **One organizer books for the whole group.** They enter everyone's basic info, pick a
  session, and pay for every seat. Payment *is* the confirmation.
- **Friends complete their own profile afterwards** via **one shared party link** (each friend picks which person they are and can fix typos in their name): confirm their general
  info, take the personality test for this game, and answer their own pairing-comfort question.
  This creates (or connects) their Odeum profile. Their seat is already paid.
- **Nothing interrupts signup** until the end: the email is verified with a 6-digit code right
  before paying or requesting a date (not earlier).
- **Progress saves as they go**, independent of payment. An abandoned checkout still keeps
  profile, group, personality answers and selected/proposed date ("saved interest").
- Admin side tracks separately: questionnaire complete · paid · assigned to a table.

## Steps

### 1. About you (organizer)
- Full name, email, phone
- Age range: `18–21` · `22–25` · `26–35` · `36–40` · `41+`
- Gender: `Male` · `Female` · `Nonbinary` · `Self-describe` (opens a text field). No "prefer not to say".
- Returning players: prefill from their saved Odeum profile.

### 2. Who's coming?
Three choices:
- **Just me**
- **With friends** → for each friend: full name, age range, gender
  (`Male` · `Female` · `Nonbinary` · `Other`, with an optional text field)
- **I'm joining friends who have already booked a table** → shows the booked game nights; they
  pick the date their friends booked. No invitation code. Step 4 then shows that session directly
  (if it has enough seats) and they pay only for the people they're adding.

No "plus-one" field (removed).

### 2b. Connections in your group *(only when there are friends)*
Separate page after all friends are entered.
- Explainer: the game pairs people up to experience romantic relationships, alongside other
  relationships such as family and mentor/mentee. We want to know about any real-life partners
  in your group.
- "Add a real-life couple": two dropdowns generated from the names entered (organizer + friends).
  Repeatable.

### 3. Character fit (organizer only)
1. **Character gender follows the player's gender** (male → male character, female → female
   character; the same for friends when matching). Only **Nonbinary / Self-describe** players are asked
   *"Would you like to portray a female or male character this time?"*
2. **Pause screen:** the following questions are to find the character that best fits *you*
   (the person signing up) in this game.
3. **Personality questions** (3–5, game-specific), then **Your character matches**: a ranked list
   of the characters with a fit %, e.g. Eva 80% · Vera 20% · Petra 10%.
4. *(No separate romantic-pairing question in the quiz any more.)*
5. **"Does anyone in your group want a specific character?"** (optional)
   - *We're open to recommendations* (default)
   - *Yes, we have preferences* → per group member, a selector:
     `No preference` · `Any female character` · `Any male character` · each named character,
     plus **Preferred** vs **Required**.
6. Button: **"Any special partner pairing or seating requests?"** → opens a text box **and** an optional
   multi-select: *"Which genders are you comfortable being paired with in an in-game romance?"*
   `Male` · `Female` · `Nonbinary`, with the privacy note (matching only; never shown to others).
   A stated comfort is a **hard requirement** in matching.

### 4. Choose your game
Matching order:
1. Enough open seats for the whole group.
2. Every **Required** character is available (and comfort boundaries can be honoured).
3. Best character fit for the organizer, **and players of similar ages together** (a table's
   average age vs. the group's, using age-range midpoints); group preferences help rank.
   Tables that have already started rank slightly ahead of empty ones.

Show the **top 3** qualifying sessions (fewer if fewer qualify), e.g.

> **Thursday, October 15 · 6–11 PM**
> 4 seats available · Strong match for you
> ▸ View available characters *(expands: all open characters, organizer's best match highlighted)*

When joining friends' table: show just that table, with no "match for you" label.

Plus **"See all available dates"**, a page in two parts:
- **Tables already started** (someone already holds a seat), as date tiles showing seats left.
- **Start a new table**, the remaining game nights (Fri/Sat) as date tiles below.
- Any booking of **2+ players can start a new table** immediately. A solo player picks a night as a
  **request**, confirmed by Odeum by email.
- Choosing a started table whose average age is **8+ years** from the group's shows a warning
  ("the average age at this table is about X…"); they can still proceed.

No "this date works for everyone" checkbox — paying for everyone is the confirmation.

### 5. Book & pay
- Organizer pays for every seat in the booking. Required characters are reserved with the seat.
- Before payment (or a request): confirm email with a 6-digit code.
- After payment: show **one party link** (Copy / Share) for the organizer to
  send to everyone.

### Friend follow-up questionnaire (via the party link)
- "Which one are you?": pick your name from the party (already-completed friends are greyed out)
- Confirm general info (prefilled by organizer; name editable to fix typos)
- Personality test for this game + their character matches (character gender follows their gender)
- Their own special requests + optional pairing-comfort question. Friends' comfort is never asked
  of the organizer.
- Until complete, that friend's romantic pairing is **provisional**. If the table can't
  accommodate a boundary disclosed later, Odeum resolves it before assigning roles.

- Visual design: dark, like the Prague page (ink background, cream text, gold accent).

- Game nights are managed in the Google Sheet's **Dates** tab (Date · Game · Status · Time · Note),
  not in code. Only Open, upcoming nights are offered.

## Data & privacy (Supabase)
- Data lives in a Supabase Postgres database (`supabase/schema.sql`, setup in `supabase/SETUP.md`).
  All tables are in a `private` schema the website can't reach; the site can only call a few
  database functions that each return just what one screen needs.
- Testing period: **no payment**, and **anyone (even one person) can start a table** on an open night.
- Email is verified with a Supabase Auth 6-digit code right before booking; that same code signs
  players in to their **portal** (`/signup/?portal`): profile (editable), their games, their party's
  quiz progress, the party link (organizer), cancel booking (organizer).
- The browser never keeps pairing-comfort answers, and after booking keeps only what the confirmation
  screen needs. Unverified drafts are deleted after 30 days. `private.admin_forget(email)` erases a person.

## Privacy rules
- Pairing-comfort answers: private, matching-only, never shown to other players or the organizer.
- Framed as comfort with *fictional* pairings — never asks sexual orientation.
- Not answering ≠ "comfortable with anything" and ≠ heterosexual; it's "nothing shared".

## Superseded (don't reintroduce)
- Email verification at step 1 · exact age · plus-one field · invitation/booking codes for joining
  friends · free-form date proposals · "these dates work for us" availability checkboxes ·
  organizer answering friends' pairing preferences · the long "Who would you feel comfortable
  playing a romantic relationship with?" form (replaced by the text box + conditional quiz question).

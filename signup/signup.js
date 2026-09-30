/* =========================================================
   Odeum signup — the booking flow (organizer) and the friend follow-up questionnaire.
   Spec: docs/signup-flow.md.  Game data: games.js.
   ========================================================= */
(function () {
  "use strict";

  var CFG = window.ODEUM;
  var params = new URLSearchParams(location.search);
  var GAME = CFG.GAMES[params.get("game")] || CFG.GAMES.prague;
  var app = document.getElementById("app");

  var AGES = ["18–21", "22–25", "26–35", "36–40", "41+"];
  var GENDERS = [["man", "Male"], ["woman", "Female"], ["nonbinary", "Nonbinary"], ["self", "Self-describe"]];
  var FRIEND_GENDERS = [["man", "Male"], ["woman", "Female"], ["nonbinary", "Nonbinary"], ["self", "Other/Not sure"]];
  var AGE_WARN_YEARS = 10; // the database also uses 10 years as the recommendation cut-off
  var COMFORT = [["man", "Male"], ["woman", "Female"], ["nonbinary", "Nonbinary"]];

  /* ---------------------------------------------------------
     Helpers
     --------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uid(n) {
    var a = new Uint8Array(n || 12), s = "";
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += "abcdefghijkmnpqrstuvwxyz23456789"[a[i] % 32];
    return s;
  }
  function getPath(o, path) {
    return path.split(".").reduce(function (x, k) { return x == null ? undefined : x[k]; }, o);
  }
  function setPath(o, path, v) {
    var ks = path.split("."), last = ks.pop();
    ks.forEach(function (k, i) {
      if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1] || last) ? [] : {};
      o = o[k];
    });
    o[last] = v;
  }
  function first(name) { return String(name || "").trim().split(/\s+/)[0] || ""; }
  function fmtDate(id, withYear) {
    var d = new Date(id + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: withYear ? "numeric" : undefined });
  }
  function charById(id) { return GAME.characters.filter(function (c) { return c.id === id; })[0]; }
  function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim()); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function forget(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------------------------------------------------------
     Backend: Supabase (supabase/schema.sql). The site can only call the database functions defined
     there; each returns just what a screen needs. Table matching happens in the database.
     backend.mode: "loading" | "v2" (live) | "none" (database unreachable)
     --------------------------------------------------------- */
  var sb = CFG.SUPABASE_URL && window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY) : null;
  var backend = { mode: sb ? "loading" : "none" };
  var TABLES = { loaded: false, list: [] }; // public list of open tables: [{ id, date, time, area, seats, seatsLeft, started }]
  var RECS = null;    // this booking's recommendations, from the database
  var BROWSE = null;  // this booking's view of every open table, from the database

  function rpc(fn, args) {
    return sb.rpc(fn, args || {}).then(function (r) {
      if (!r.error) return r.data;
      var m = String(r.error.message || "");
      return { ok: false, error: /not_signed_in|unverified/.test(m) ? "unverified" : /forbidden/.test(m) ? "forbidden" : "server" };
    }, function () { return { ok: false, error: "network" }; });
  }
  function live() { return backend.mode === "v2"; }
  function signedInEmail() {
    if (!sb) return Promise.resolve("");
    return sb.auth.getSession().then(function (r) {
      var ses = r.data && r.data.session;
      return ses ? String(ses.user.email || "").toLowerCase() : "";
    }, function () { return ""; });
  }
  function typedEmail() { return String(P.me.email || "").trim().toLowerCase(); }
  function otpError(e) {
    return { ok: false, error: e.status === 429 || /second|rate|limit/i.test(e.message || "") ? "wait" : "server" };
  }
  function draftArgs(extra) {
    var a = { p_id: P.bookingId, p_secret: P.secret };
    Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k]; });
    return a;
  }

  function api(action, data) {
    if (!live()) return Promise.resolve({ ok: false, error: "offline" });
    if (action === "save") return rpc("save_draft", draftArgs({ p_data: data }));
    if (action === "sendCode") {
      return sb.auth.signInWithOtp({ email: typedEmail(), options: { shouldCreateUser: true } })
        .then(function (r) { return r.error ? otpError(r.error) : { ok: true }; });
    }
    if (action === "verifyCode") {
      return sb.auth.verifyOtp({ email: typedEmail(), token: data.code, type: "email" }).then(function (r) {
        if (r.error) return { ok: false, error: "wrong" };
        return rpc("claim_booking", draftArgs());
      });
    }
    if (action === "book") {
      return rpc("save_draft", draftArgs({ p_data: data })).then(function (res) {
        return res && res.ok === false ? res : rpc("book", { p_id: P.bookingId });
      });
    }
    if (action === "verifyOnly") {
      return sb.auth.verifyOtp({ email: typedEmail(), token: data.code, type: "email" })
        .then(function (r) { return r.error ? { ok: false, error: "wrong" } : { ok: true }; });
    }
    if (action === "friend") return rpc("friend_submit", { p_token: partyToken, p_member_id: data.friendId, p_data: data });
    return Promise.resolve({ ok: false, error: "server" });
  }

  // The game and its cast come from the database (games.js holds the quiz and a fallback cast).
  // Loaded once at page load; the open-tables list refreshes as the player starts the quiz.
  var tablesPending = null;
  function loadGame() {
    if (!sb) return Promise.resolve();
    return rpc("game_info", { p_game: GAME.id }).then(function (g) {
      if (!g || g.ok === false || g.v !== 3) { backend.mode = "none"; return; }
      backend.mode = "v2";
      GAME.title = g.title; GAME.seats = g.seats; GAME.time = g.time; GAME.area = g.area;
      GAME.characters = (g.characters || []).map(function (c) {
        return { id: c.id, name: c.name, gender: c.gender, line: c.line, art: c.art, partner: c.partner, relationship: c.relationship };
      });
      return loadTables();
    });
  }
  function loadTables() {
    if (!live()) return Promise.resolve();
    if (tablesPending) return tablesPending;
    return (tablesPending = rpc("availability", { p_game: GAME.id }).then(function (d) {
      TABLES = { loaded: true, list: (d && d.sessions) || [] };
      tablesPending = null;
      if (P && P.step === "joinDate") render();
    }));
  }
  // Asks the database for this booking's recommended tables (saved there as a snapshot).
  function loadRecs() {
    RECS = null; render();
    rpc("save_draft", draftArgs({ p_data: payload() })).then(function () {
      return rpc("recommend", draftArgs());
    }).then(function (d) {
      RECS = d && d.ok ? d : { ok: false, tables: [], noLongerAvailable: [] };
      if (P.step === "match") render();
    });
  }
  function loadBrowse() {
    BROWSE = null; render();
    rpc("browse_tables", draftArgs()).then(function (d) {
      BROWSE = d && d.ok ? d : { ok: false, sessions: [] };
      if (P.step === "calendar") render();
    });
  }

  /* ---------------------------------------------------------
     State.  Organizer (S) and friend (F) share a shape for the quiz screens:
     { me, charGender, quiz, comfort, requests, step }
     --------------------------------------------------------- */
  var DRAFT_KEY = "odeum.signup." + GAME.id;
  var partyToken = params.get("p");
  function partyKey() { return "odeum.party." + partyToken; }
  var P; // the active state object

  function freshBooking() {
    var s = {
      kind: "booking", bookingId: uid(14), secret: uid(24), partyToken: uid(16), game: GAME.id, step: "about", status: "Draft",
      me: { name: "", email: "", phone: "", birthYear: "", age: "", gender: "", genderText: "" },
      mode: "", joining: false, joinSession: "", friends: [], couples: [],
      charGender: "", quiz: {}, comfort: [], prefsOn: false, prefs: {}, requestsOn: false, requests: "",
      sessionId: "", sessionDate: "", sessionTime: "", pick: null, showCalendar: false
    };
    return s;
  }

  function members() {
    var m = [{ id: "me", name: P.me.name || "You", gender: P.me.gender, isMe: true }];
    if (hasFriends()) P.friends.forEach(function (f, i) { m.push({ id: f.id, name: f.name || "Friend " + (i + 1), gender: f.gender }); });
    return m;
  }
  // "Me and my plus-one" is a group of exactly two.
  function hasFriends() { return P.mode === "group" || P.mode === "plusone"; }
  function groupSize() { return hasFriends() ? 1 + P.friends.length : 1; }
  // Someone with a real-life partner in the party isn't asked the pairing-comfort question.
  function hasPartner() {
    if (P.kind === "friend") return !!P.partnered;
    return P.mode === "plusone" || (P.mode === "group" && (P.couples || []).some(function (c) { return c && c.indexOf("me") >= 0; }));
  }

  // What this browser keeps so people can come back to an unfinished form.  Pairing-comfort answers
  // are never kept here (they go straight to the database), and once a booking or friend quiz is
  // done only what the confirmation screen needs is kept.
  function persist() {
    if (P.kind === "booking" || P.kind === "friend") {
      var keep = JSON.parse(JSON.stringify(P));
      delete keep.comfort; delete keep.code;
      if (P.kind === "booking" && P.status === "Booked") {
        keep = { kind: "booking", status: "Booked", step: "done", game: P.game, sessionId: P.sessionId, sessionDate: P.sessionDate, partyToken: P.partyToken,
                 mode: P.mode, friends: P.friends.map(function (f) { return { id: f.id, name: f.name }; }),
                 me: { name: P.me.name, email: P.me.email } };
      }
      if (P.kind === "friend" && P.step === "fDone") keep = { kind: "friend", step: "fDone", me: { name: P.me.name }, alreadyBooked: P.alreadyBooked, organizer: P.organizer, myCharacter: P.myCharacter };
      store(P.kind === "friend" ? partyKey() : DRAFT_KEY, keep);
    }
  }
  function restore(k) {
    var s = store(k);
    if (s) { s.comfort = s.comfort || []; s.me = s.me || {}; s.friends = s.friends || []; }
    return s;
  }

  function save() {
    persist();
    if (P.kind !== "booking" || !validEmail(P.me.email)) return;
    api("save", payload());
  }

  function payload() {
    var b = JSON.parse(JSON.stringify(P));
    delete b.secret; delete b.code; delete b.codeSentTo; delete b.emailVerified; delete b.step; delete b.party; delete b.pick;
    if (!P.comfortTouched) delete b.comfort; // don't overwrite a saved answer with an empty one after a reload
    delete b.comfortTouched;
    b.plusOne = b.mode === "plusone";
    if (b.mode === "plusone") {
      b.mode = "group";
      b.couples = P.friends[0] ? [["me", P.friends[0].id]] : []; // a plus-one is taken to be a real-life partner
    }
    var r = rankForMe(), done = Object.keys(P.quiz || {}).length > 0;
    return {
      booking: b,
      scores: done ? allScores() : null,
      topMatch: done && r[0] ? r[0].id : null,
      topMatches: done ? r.slice(0, 3).map(function (c) { return c.name + " " + c.pct + "%"; }).join(", ") : null
    };
  }

  /* ---------------------------------------------------------
     Character fit (the quiz is scored here; table matching happens in the database)
     --------------------------------------------------------- */
  // Everyone chooses which gender of character to play at the start of Character fit. Someone who
  // hasn't answered yet (e.g. a friend before their own quiz) is matched as playing their own gender.
  function charGenderFor(g) { return g === "man" ? "male" : g === "woman" ? "female" : ""; }
  function asksCharGender() { return true; }
  function syncCharGender() {}

  // Fit for every character: everyone starts at 50%, and answers that point to a character add to
  // it, up to 100% for someone who picked every answer pointing that way.
  function allScores() {
    var sc = {}, max = {}, out = {};
    GAME.quiz.forEach(function (q) {
      var o = q.options[P.quiz[q.id]], qmax = {};
      if (o) Object.keys(o.s).forEach(function (k) { sc[k] = (sc[k] || 0) + o.s[k]; });
      q.options.forEach(function (x) { Object.keys(x.s).forEach(function (k) { qmax[k] = Math.max(qmax[k] || 0, x.s[k]); }); });
      Object.keys(qmax).forEach(function (k) { max[k] = (max[k] || 0) + qmax[k]; });
    });
    GAME.characters.forEach(function (c) { out[c.id] = max[c.id] ? Math.round(50 + 50 * (sc[c.id] || 0) / max[c.id]) : 50; });
    return out;
  }
  // Characters of the chosen gender, best fit first.
  function rankForMe() {
    var pct = allScores();
    return GAME.characters
      .filter(function (c) { return !P.charGender || c.gender === P.charGender; })
      .map(function (c, i) { return { id: c.id, name: c.name, pct: pct[c.id], i: i }; })
      .sort(function (a, b) { return b.pct - a.pct || a.i - b.i; });
  }
  // A friend's character: fixed already, else their best fit among those still open at the table.
  function friendCharacter(ranked) {
    var o = P.options; if (!o) return null;
    if (o.assigned) return o.assigned;
    var open = ranked.filter(function (m) { return (o.open || []).indexOf(m.id) >= 0; });
    return open.length ? open[0].id : null;
  }
  function matchLabel(t) {
    return t.charFit == null ? "" : t.charFit >= 85 ? "Strong match for you" : t.charFit >= 70 ? "Good match for you" : "";
  }

  /* ---------------------------------------------------------
     UI pieces
     --------------------------------------------------------- */
  function chips(path, opts, cur) {
    return '<div class="chips">' + opts.map(function (o) {
      return '<button type="button" class="chip' + (cur === o[0] ? " is-on" : "") + '" data-set="' + path + '" data-v="' + o[0] + '">' + esc(o[1]) + "</button>";
    }).join("") + "</div>";
  }
  function field(label, path, type, extra) {
    return '<label class="field"><span>' + label + '</span><input type="' + (type || "text") + '" data-k="' + path +
      '" value="' + esc(getPath(P, path)) + '" ' + (extra || "") + " /></label>";
  }
  // Marks a required question with a small asterisk.
  function req(label) { return label + '<span class="req" aria-hidden="true">*</span>'; }
  function yearField(path) {
    return '<label class="field"><span>' + req("What year were you born?") + '</span><input type="text" class="field--year" data-k="' + path +
      '" value="' + esc(getPath(P, path) || "") + '" inputmode="numeric" maxlength="4" autocomplete="bday-year" /></label>';
  }
  function yearError(y) {
    y = String(y || "").trim();
    var now = new Date().getFullYear();
    if (!/^\d{4}$/.test(y) || +y < now - 110 || +y > now) return "Please enter the year you were born.";
    if (now - +y < 18) return "You need to be 18 or older to play.";
    return "";
  }
  function genderBlock(base, opts) {
    var g = getPath(P, base + ".gender"), friend = opts === FRIEND_GENDERS;
    return '<div class="field"><span>' + req("Gender") + '</span>' + chips(base + ".gender", opts, g) +
      (g === "self" ? '<input type="text" class="field__sub" placeholder="' + (friend ? "Describe (optional)" : "") + '" data-k="' + base + '.genderText" value="' + esc(getPath(P, base + ".genderText")) + '" />' : "") +
      "</div>";
  }
  function head(kicker, title, sub) {
    return '<p class="kicker">' + kicker + '</p><h1 class="title">' + title + "</h1>" + (sub ? '<p class="sub">' + sub + "</p>" : "");
  }
  function charThumb(c, note) {
    return '<div class="thumb"><img src="' + c.art + '" alt="" loading="lazy" /><div><strong>' + c.name + "</strong>" +
      (note ? '<em class="thumb__note">' + note + "</em>" : "") + "<span>" + esc(c.line) + "</span></div></div>";
  }

  // A recommended table, as returned by the database.
  function sessionCard(t, joining) {
    var best = t.bestCharacter, label = joining ? "" : matchLabel(t), me = charById(best);
    var open = (t.openCharacters || []).map(charById).filter(Boolean);
    return '<article class="scard">' +
      '<div class="scard__top"><div><h3 class="scard__date">' + fmtDate(t.date) + '</h3>' +
      '<p class="scard__meta">' + esc(t.time) + " · " + (t.started ? t.seatsLeft + " seat" + (t.seatsLeft === 1 ? "" : "s") + " left" : "New table") +
      (label ? ' · <span class="scard__match">' + label + "</span>" : "") +
      (!joining && t.started && t.ageGap != null && t.ageGap <= 5 ? " · Players around your age" : "") + "</p>" +
      (me ? '<p class="scard__you">You’d play <strong>' + esc(me.name) + "</strong>" + (t.charFit != null ? ' <span>· ' + Math.round(t.charFit) + "% match</span>" : "") +
        (t.partnerCharacter && charById(t.partnerCharacter) ? ' <span>· your plus-one plays</span> <strong>' + esc(charById(t.partnerCharacter).name) + "</strong>" : "") + "</p>" : "") +
      "</div>" +
      '<button type="button" class="btn" data-act="pickTable" data-v="' + esc(t.sessionId) + '"' + (busy ? " disabled" : "") + '>Book this date</button></div>' +
      '<details class="scard__more"><summary>View available characters</summary><div class="thumbs">' +
      open.map(function (c) { return charThumb(c, c.id === best ? "Your character" : ""); }).join("") +
      "</div></details></article>";
  }

  // Tables as a compact row of date tiles (SAT / 24 / OCT).
  // pick(t) -> false (shown as full) | true | a short note under the date, e.g. "2 left".
  function dateTiles(list, selected, pick) {
    var seen = {};
    return '<div class="dates__row">' + list.map(function (t) {
      var ok = pick(t), d = new Date(t.date + "T12:00:00"), id = t.sessionId || t.id;
      var sameNight = list.filter(function (x) { return x.date === t.date; }).length > 1;
      seen[t.date] = (seen[t.date] || 0) + 1;
      if (sameNight && ok) ok = "Table " + seen[t.date] + (typeof ok === "string" ? " · " + ok : "");
      var inner = '<span class="date__dow">' + d.toLocaleDateString("en-US", { weekday: "short" }) + '</span><span class="date__num">' + d.getDate() +
        '</span><span class="date__mon">' + d.toLocaleDateString("en-US", { month: "short" }) + "</span>";
      return ok
        ? '<button type="button" class="date' + (id === selected ? " is-on" : "") + '" data-act="date" data-v="' + esc(id) + '">' + inner +
          '<span class="date__note">' + (typeof ok === "string" ? ok : "&nbsp;") + "</span></button>"
        : '<span class="date is-off">' + inner + '<span class="date__note">Full</span></span>';
    }).join("") + "</div>";
  }
  function ageWarning(t) {
    if (!t || !t.started || t.ageGap == null || Number(t.ageGap) <= AGE_WARN_YEARS) return "";
    return '<p class="warn">Heads up: the average age at this table is about <strong>' + esc(t.tableAge) + "</strong>" +
      ", " + Math.round(Number(t.ageGap)) + " years from " + (groupSize() > 1 ? "your group’s" : "yours") +
      ". You’re welcome to join; we just want you to know before you book.</p>";
  }

  /* ---------------------------------------------------------
     Screens.  Each: { stage, render(), valid() -> error string | "", noNext? }
     --------------------------------------------------------- */
  var STAGES = ["About you", "Who’s coming", "Character fit", "Your game", "Book"];
  var FRIEND_STAGES = ["About you", "Character fit", "Done"];
  var busy = false, flash = "";

  var SCREENS = {
    about: {
      stage: 0,
      render: function () {
        var back = P.prefilled && P.me.name ? "Welcome back, " + esc(first(P.me.name)) + "." :
          'Been here before? <a class="inline" href="?portal">Sign in</a> to fill this in.';
        return head("Step 1 · About you", "Let’s start with the basics.", back) +
          field(req("Full name"), "me.name", "text", 'autocomplete="name"') +
          field(req("Email"), "me.email", "email", 'autocomplete="email"') +
          field(req("Phone"), "me.phone", "tel", 'autocomplete="tel"') +
          yearField("me.birthYear") +
          genderBlock("me", GENDERS) + privacyNote();
      },
      valid: function () {
        var m = P.me;
        if (!m.name.trim()) return "Please add your name.";
        if (!validEmail(m.email)) return "Please add a valid email.";
        if (!m.phone.trim()) return "Please add a phone number.";
        var ye = yearError(m.birthYear); if (ye) return ye;
        if (!m.gender || (m.gender === "self" && !m.genderText.trim())) return "Please share your gender with us.";
        return "";
      }
    },

    who: {
      stage: 1,
      render: function () {
        return head("Step 2 · Who’s coming", req("Who’s coming with you?"), "") +
          '<div class="choices choices--three">' +
          choice("mode", "solo", "Just me", "") +
          choice("mode", "plusone", "Me and my plus-one", "") +
          choice("mode", "group", "Me and friends", "Up to " + (GAME.seats - 1) + " others.") +
          "</div>" +
          '<button type="button" class="toggle' + (P.joining ? " is-on" : "") + '" data-act="joining"><span class="toggle__box"></span>' +
          "I’m joining friends who have already booked a table</button>";
      },
      valid: function () { return P.mode ? "" : "Choose one to continue."; }
    },

    friends: {
      stage: 1,
      render: function () {
        if (!P.friends.length) addFriend();
        var one = P.mode === "plusone";
        return head("Step 2 · Who’s coming", one ? "Tell us about your plus-one." : "Tell us about your friends.", "") +
          P.friends.map(function (f, i) {
            var b = "friends." + i;
            return '<fieldset class="friend"><legend>' + (one ? "Your plus-one" : "Friend " + (i + 1)) + "</legend>" +
              (P.friends.length > 1 ? '<button type="button" class="friend__x" data-act="rmFriend" data-v="' + i + '" aria-label="Remove">Remove</button>' : "") +
              field(req("Full name"), b + ".name") +
              field("Email (optional)", b + ".email", "email", 'autocomplete="off"') +
              '<div class="field"><span>' + req("Age") + '</span>' + chips(b + ".age", AGES.map(function (a) { return [a, a]; }), f.age) + "</div>" +
              genderBlock(b, FRIEND_GENDERS) + "</fieldset>";
          }).join("") +
          (!one && P.friends.length < GAME.seats - 1 ? '<button type="button" class="btn btn--ghost" data-act="addFriend">+ Add another friend</button>' : "");
      },
      valid: function () {
        for (var i = 0; i < P.friends.length; i++) {
          var f = P.friends[i];
          if (!f.name.trim() || !f.age || !f.gender) return "Please complete Friend " + (i + 1) + ".";
          if (f.email && !validEmail(f.email)) return "Please check Friend " + (i + 1) + "’s email, or leave it blank.";
        }
        return "";
      }
    },

    connections: {
      stage: 1,
      render: function () {
        var opts = members();
        function sel(i, j) {
          var cur = (P.couples[i] || [])[j];
          return '<select data-k="couples.' + i + "." + j + '"><option value="">Choose…</option>' +
            opts.map(function (m) { return '<option value="' + m.id + '"' + (cur === m.id ? " selected" : "") + ">" + esc(m.name) + "</option>"; }).join("") + "</select>";
        }
        return head("Step 2 · Connections in your group", "Any real-life partners?",
          "This game pairs people up to experience romantic relationships, alongside others like family and mentor and mentee. We’d like to know about any real-life partners in your group.") +
          '<p class="note">This information is completely private. It will only be used by our team to make thoughtful character and seating matches.</p>' +
          P.couples.map(function (c, i) {
            return '<div class="couple">' + sel(i, 0) + '<span class="couple__amp">&amp;</span>' + sel(i, 1) +
              '<button type="button" class="friend__x" data-act="rmCouple" data-v="' + i + '">Remove</button></div>';
          }).join("") +
          '<button type="button" class="btn btn--ghost" data-act="addCouple">+ Add a couple</button>' +
          '<p class="note">None in your group? Just continue.</p>';
      },
      valid: function () {
        P.couples = P.couples.filter(function (c) { return c && (c[0] || c[1]); });
        for (var i = 0; i < P.couples.length; i++) {
          if (!P.couples[i][0] || !P.couples[i][1] || P.couples[i][0] === P.couples[i][1]) return "Please complete the couple pairings.";
        }
        return "";
      }
    },

    joinDate: {
      stage: 1,
      render: function () {
        var list = TABLES.list.filter(function (t) { return t.started; });
        var picked = TABLES.list.filter(function (t) { return t.id === P.joinSession; })[0];
        return head("Step 2 · Joining friends", req("Which night did your friends book?"), "Pick their date and we’ll seat you at the same table.") +
          (!live() ? offline() : TABLES.loaded ? (list.length ? dateTiles(list, P.joinSession, function (t) { return t.seatsLeft > 0 && t.seatsLeft + " left"; })
            : '<p class="warn">No tables have been started yet.</p>') : loading()) +
          (picked ? '<p class="picked">' + fmtDate(picked.date, true) + " · " + esc(picked.time) + "</p>" : "");
      },
      valid: function () { return P.joinSession ? "" : "Choose your friends’ date."; }
    },

    charGender: {
      stage: 2,
      render: function () {
        var can = (P.kind === "friend" && P.options && P.options.canPlay) || { female: true, male: true };
        function opt(val, label) {
          if (can[val] !== false) return choice("charGender", val, label, "", true);
          return '<span class="choice is-done"><strong>' + label + "</strong><span>None left at your table</span></span>";
        }
        return head("Step 3 · Character fit", "Would you like to portray a female or male character this time?", "") +
          '<div class="choices">' + opt("female", "A female character") + opt("male", "A male character") + "</div>";
      },
      valid: function () { return P.charGender ? "" : "Choose one to continue."; }
    },

    quizIntro: {
      stage: 2,
      next: "Begin",
      render: function () {
        return '<div class="pause">' + head("Step 3 · Character fit", "Let’s find a character for you.",
          "Every character in <em>" + esc(GAME.title) + "</em> has a distinct personality and perspective. " +
          "The following questions help us understand which characters may be the best fit for you.") + "</div>";
      },
      valid: function () { return ""; }
    },

    result: {
      stage: 2, next: function () { return P.kind === "friend" ? "Continue" : "Find my game"; },
      render: function () {
        var r = rankForMe(), o = P.kind === "friend" && P.options, mine = friendCharacter(r);
        return head("Step 3 · Your matches", "Your character matches",
          o && mine ? "At your table, you’ll play <strong>" + esc(charById(mine).name) + "</strong>." : "") +
          '<ol class="matches">' + r.map(function (m, i) {
            var c = charById(m.id), taken = o && !o.assigned && (o.open || []).indexOf(m.id) < 0 && m.id !== mine;
            var top = o ? m.id === mine : i === 0;
            return '<li class="mrow' + (top ? " is-top" : "") + (taken ? " is-taken" : "") + '"><img src="' + c.art + '" alt="" />' +
              '<div class="mrow__body"><div class="mrow__head"><strong>' + c.name +
              (top && o ? ' <em class="mrow__tag">Your character</em>' : "") + (taken ? ' <em class="mrow__tag">Taken</em>' : "") +
              '</strong><span class="mrow__pct">' + m.pct + "%</span></div>" +
              '<div class="mrow__bar"><span style="width:' + m.pct + '%"></span></div><p>' + esc(c.line) + "</p></div></li>";
          }).join("") + "</ol>";
      },
      valid: function () { return ""; }
    },

    prefs: {
      stage: 2,
      render: function () {
        var solo = groupSize() === 1;
        return head("Step 3 · Characters", solo ? "Do you want to experience a specific character?" : "Does anyone in your group want a specific character?", "") +
          '<div class="choices choices--small">' +
          choice("prefsOn", false, solo ? "I’m open to recommendations based on my quiz results" : "We’re open to recommendations based on quiz results", "") +
          choice("prefsOn", true, solo ? "Yes, I have a particular role in mind" : "Yes, we have particular roles in mind", "") +
          "</div>" +
          (P.prefsOn ? members().map(prefRow).join("") : "") +
          requestsBlock();
      },
      valid: function () { return ""; }
    },

    match: {
      stage: 3, noNext: true,
      render: function () {
        if (!live()) return head("Step 4 · Your game", "Your tables", "") + offline();
        if (!RECS) return head("Step 4 · Your game", "Finding your table…", "") + loading();
        var size = groupSize(), top = RECS.tables || [], gone = RECS.noLongerAvailable || [];
        var note = gone.length ? '<p class="warn">Since you last looked, ' + gone.map(function (d) { return fmtDate(d); }).join(" and ") +
          (gone.length > 1 ? " are" : " is") + " no longer available.</p>" : "";
        if (P.joining) {
          return head("Step 4 · Your game", "Your friends’ table", "") + note +
            (top.length ? sessionCard(top[0], true) : '<p class="warn">Your friends’ table is already full. Would you like to explore other available dates?</p>') +
            proposeLink("See all available dates");
        }
        return head("Step 4 · Your game", top.length ? "Your best tables" : "No table fits yet",
          top.length ? (size > 1 ? "Matched on seats for your group, players of similar ages, your preferences and your character fit."
                                 : "Matched on open seats, players of similar ages, your preferences and your character fit.")
                     : "See every available night below.") + note +
          top.map(function (t) { return sessionCard(t); }).join("") + proposeLink("See all available dates");
      },
      valid: function () { return P.sessionId ? "" : "Choose a date."; }
    },

    calendar: {
      stage: 3, next: "Book this date",
      render: function () {
        var h = head("Step 4 · All available dates", "All available dates", "");
        if (!live()) return h + offline();
        if (!BROWSE) return h + loading();
        var all = BROWSE.sessions || [];
        var act = all.filter(function (t) { return t.started; }), fresh = all.filter(function (t) { return !t.started; });
        var sel = all.filter(function (t) { return t.sessionId === P.pick; })[0];
        return h +
          '<h2 class="h3">Tables already started</h2>' +
          (act.length ? '<p class="note note--tight">Join players who have already booked.</p>' +
            dateTiles(act, P.pick, function (t) { return t.bookable && t.seatsLeft + " left"; })
            : '<p class="note note--tight">None yet. Be the first!</p>') +
          '<h2 class="h3">Start a new table</h2>' +
          '<p class="note note--tight">Be the first at the table on any of these nights.</p>' +
          dateTiles(fresh, P.pick, function (t) { return t.bookable; }) +
          (sel ? '<p class="picked">' + fmtDate(sel.date, true) + " · " + esc(sel.time) + "</p>" + ageWarning(sel) : "");
      },
      valid: function () { return P.pick ? "" : "Choose a date."; }
    },

    verifyEmail: {
      stage: 2, next: "Confirm",
      render: function () {
        return head(P.kind === "friend" ? "Character fit" : "Step 3 · Character fit", "Confirm your email to save your quiz results.",
          "We sent a sign-in code to <strong>" + esc(P.me.email) + "</strong>. " +
          "It can take a minute to arrive; check spam if you don’t see it.") +
          '<label class="field"><span>Code</span><input class="code" data-k="code" value="' + esc(P.code || "") +
          '" inputmode="numeric" autocomplete="one-time-code" maxlength="10" /></label>' +
          '<p class="note"><button type="button" class="linkbtn" data-act="resend">Send a new code</button> &nbsp;·&nbsp; ' +
          '<button type="button" class="linkbtn" data-act="changeEmail">Wrong email?</button></p>';
      },
      valid: function () { return /^\d{6,10}$/.test(String(P.code || "").trim()) ? "" : "Enter the code from the email."; }
    },

    review: {
      stage: 4, noNext: true,
      render: function () {
        var size = groupSize();
        return head("Step 5 · Book", "Review your booking.", "") +
          '<dl class="summary">' +
          "<dt>Game</dt><dd>" + GAME.title + "</dd>" +
          "<dt>Date</dt><dd>" + fmtDate(P.sessionDate, true) + " · " + esc(P.sessionTime || GAME.time) + "</dd>" +
          "<dt>Where</dt><dd>" + esc(GAME.area || GAME.place) + " (address sent before the game)</dd>" +
          (P.myCharacter && charById(P.myCharacter) ? "<dt>You play</dt><dd>" + esc(charById(P.myCharacter).name) + "</dd>" : "") +
          (P.partnerCharacter && charById(P.partnerCharacter) ? "<dt>Your plus-one plays</dt><dd>" + esc(charById(P.partnerCharacter).name) + "</dd>" : "") +
          "<dt>Players</dt><dd>" + members().map(function (m) { return esc(m.name); }).join(", ") + "</dd>" +
          "<dt>Seats</dt><dd>" + size + " · free during the testing period</dd>" +
          "</dl>" +
          (size > 1 ? '<p class="note">After you book, you’ll get one link to send your friends so each can take their own character quiz.</p>' : "") +
          '<button type="button" class="btn btn--wide" data-act="book"' + (busy ? " disabled" : "") + ">" + (busy ? "One moment…" : "Confirm booking") + "</button>" +
          '<p class="note">Your seats are held for 30 minutes while you confirm.</p>';
      },
      valid: function () { return ""; }
    },

    done: {
      stage: 4, noNext: true, noBack: true,
      render: function () {
        var html = head("You’re booked", "See you on " + fmtDate(P.sessionDate) + ".", "You can see your booking any time in your Odeum portal.");
        if (hasFriends() && P.friends.length) {
          html += '<h2 class="h2">Send this link to your friends</h2><p class="sub">One link for everyone. Each friend picks their name, fixes any typos, and takes their own character quiz. Their seats are already reserved.</p>' +
            '<div class="flink"><input readonly value="' + esc(partyLink()) + '" />' +
            '<button type="button" class="btn btn--ghost" data-act="copy">Copy</button>' +
            (navigator.share ? '<button type="button" class="btn btn--ghost" data-act="share">Share</button>' : "") + "</div>";
        }
        return html + '<a class="linkbtn linkbtn--big" href="?portal">Go to your portal →</a>';
      }
    },

    /* ---- friend follow-up ---- */
    fWelcome: {
      stage: 0, noNext: true,
      render: function () {
        return head(GAME.title, "You have a seat.",
          (P.organizer ? esc(first(P.organizer)) : "Your friend") + " booked a table for your party" +
          (P.sessionLabel ? " on <strong>" + esc(P.sessionLabel) + "</strong>" : "") +
          ". Confirm a few details and take a short quiz so we can find your character. It takes about three minutes.") +
          '<h2 class="h2">Which one are you?</h2><div class="choices choices--list">' +
          P.party.map(function (m) {
            return m.done
              ? '<span class="choice is-done"><strong>' + esc(m.name) + "</strong><span>Already done ✓</span></span>"
              : '<button type="button" class="choice' + (P.friendId === m.id ? " is-on" : "") + '" data-act="pickFriend" data-v="' + esc(m.id) + '"><strong>' + esc(m.name) + "</strong></button>";
          }).join("") + "</div>";
      },
      valid: function () { return P.friendId ? "" : "Choose your name."; }
    },
    fAbout: {
      stage: 0,
      render: function () {
        return head("About you", "Confirm your details.", "Fix any typos in your name. This also sets up your Odeum profile for next time.") +
          field(req("Full name"), "me.name") + field(req("Email"), "me.email", "email", 'autocomplete="email"') + field(req("Phone"), "me.phone", "tel", 'autocomplete="tel"') +
          yearField("me.birthYear") +
          genderBlock("me", GENDERS) + privacyNote();
      },
      valid: function () { return SCREENS.about.valid(); }
    },
    fRequests: {
      stage: 1,
      render: function () { return head("Almost done", "Anything else we should know?", "") + requestsBlock(); },
      valid: function () { return ""; }
    },
    fDone: {
      stage: 2, noNext: true, noBack: true,
      render: function () {
        var mc = P.myCharacter && charById(P.myCharacter);
        return head("All set", "Thank you, " + esc(first(P.me.name)) + ".",
          (mc ? "You’ll play <strong>" + esc(mc.name) + "</strong>. " : "") + "We’ll send you everything you need before the game.") +
          (P.alreadyBooked ? '<p class="warn">It looks like you already have a seat that night in another booking. We’ll sort it out with you and ' +
            (P.organizer ? esc(first(P.organizer)) : "the person who booked") + ".</p>" : "") +
          '<p class="note">See your booking any time in <a class="inline" href="./?portal">your Odeum portal</a>.</p>' +
          '<button type="button" class="linkbtn linkbtn--big" data-act="someoneElse">Filling this in for someone else in your party? →</button>';
      }
    },
    message: {
      stage: 0, noNext: true, noBack: true,
      render: function () { return head("Odeum", P.title, P.text); }
    },

    /* ---- player portal (?portal) ---- */
    pEmail: {
      stage: 0, next: "Send code",
      render: function () {
        return head("Your Odeum", "Sign in", "Enter the email you booked with. We’ll send you a sign-in code.") +
          field("Email", "email", "email", 'autocomplete="email"');
      },
      valid: function () { return validEmail(P.email) ? "" : "Please add a valid email."; }
    },
    pCode: {
      stage: 0, next: "Sign in",
      render: function () {
        return head("Your Odeum", "Check your email.", "If there’s an Odeum account for <strong>" + esc(P.email) + "</strong>, we’ve sent it a sign-in code.") +
          '<label class="field"><span>Code</span><input class="code" data-k="code" value="' + esc(P.code || "") +
          '" inputmode="numeric" autocomplete="one-time-code" maxlength="10" /></label>';
      },
      valid: function () { return /^\d{6,10}$/.test(String(P.code || "").trim()) ? "" : "Enter the code from the email."; }
    },
    pHome: {
      stage: 0, noNext: true, noBack: true,
      render: function () {
        var d = PORTAL || {}, prof = d.profile || {};
        var html = head("Your Odeum", "Hi" + (prof.name ? " " + esc(first(prof.name)) : "") + ".", esc(d.email || ""));
        html += '<h2 class="h3">Your games</h2>' +
          ((d.bookings || []).length ? d.bookings.map(portalBooking).join("") : '<p class="note note--tight">No games booked yet.</p>') +
          '<a class="linkbtn linkbtn--big" href="./">Book a game →</a>';
        html += '<h2 class="h3">Your details</h2>';
        if (P.editing) {
          html += field("Full name", "edit.name") + field("Phone", "edit.phone", "tel") + yearField("edit.birthYear") +
            genderBlock("edit", GENDERS) +
            '<button type="button" class="btn" data-act="saveProfile">Save</button> &nbsp; <button type="button" class="linkbtn" data-act="cancelEdit">Cancel</button>';
        } else {
          var gl = (GENDERS.filter(function (g) { return g[0] === prof.gender; })[0] || [])[1];
          html += '<dl class="summary">' +
            "<dt>Name</dt><dd>" + esc(prof.name || "—") + "</dd><dt>Email</dt><dd>" + esc(d.email || "") + "</dd>" +
            "<dt>Phone</dt><dd>" + esc(prof.phone || "—") + "</dd><dt>Age</dt><dd>" + esc(prof.age || "—") + "</dd>" +
            "<dt>Gender</dt><dd>" + esc(prof.gender === "self" ? prof.genderText : (gl || "—")) + "</dd></dl>" +
            '<button type="button" class="btn btn--ghost" data-act="editProfile">Edit details</button>';
        }
        return html + privacyNote() + '<p class="note"><button type="button" class="linkbtn" data-act="signOut">Sign out</button></p>';
      }
    }
  };

  var PORTAL = null;
  function portalBooking(b) {
    var g = CFG.GAMES[b.game] || GAME, cancelled = b.status === "Cancelled";
    var comfort = (b.comfort || []).map(function (c) { return (COMFORT.filter(function (o) { return o[0] === c; })[0] || [])[1]; }).filter(Boolean);
    var link = b.partyToken ? location.origin + location.pathname + "?p=" + b.partyToken + (b.game !== "prague" ? "&game=" + b.game : "") : "";
    return '<article class="scard' + (cancelled ? " is-cancelled" : "") + '">' +
      '<h3 class="scard__date">' + esc(b.label || b.date) + "</h3>" +
      '<p class="scard__meta">' + esc(g.title) + (cancelled ? " · <strong>Cancelled</strong>" : "") + (b.isOrganizer ? " · You booked this table" : "") + "</p>" +
      '<dl class="summary summary--tight">' +
      (b.character ? "<dt>Your character</dt><dd>" + esc((charById(b.character) || {}).name || b.character) + "</dd>" : "") +
      (b.topMatches ? "<dt>Your matches</dt><dd>" + esc(b.topMatches) + "</dd>" : "") +
      (b.requests ? "<dt>Your requests</dt><dd>" + esc(b.requests) + "</dd>" : "") +
      (comfort.length ? "<dt>Pairing comfort</dt><dd>" + comfort.join(", ") + ' <span class="note">(only you can see this)</span></dd>' : "") +
      "<dt>Your party</dt><dd>" + (b.party || []).map(function (m) {
        return esc(m.name) + (m.you ? " (you)" : "") + ' <span class="' + (m.done ? "ok" : "wait") + '">' + (m.done ? "✓" : "quiz pending") + "</span>" +
          (b.isOrganizer && !cancelled && b.upcoming && !m.organizer ? ' <button type="button" class="linkbtn linkbtn--small" data-act="removePerson" data-b="' + esc(b.id) + '" data-v="' + esc(m.member) + '">Remove</button>' : "");
      }).join(" · ") + "</dd></dl>" +
      (b.isOrganizer && !cancelled && b.upcoming ? addPersonBlock(b) : "") +
      (link && !cancelled && (b.party || []).length > 1 ? '<div class="flink"><input readonly value="' + esc(link) + '" /><button type="button" class="btn btn--ghost" data-act="copyLink" data-v="' + esc(link) + '">Copy link</button></div>' : "") +
      (b.isOrganizer && !cancelled ? '<p class="note"><button type="button" class="linkbtn" data-act="cancelBooking" data-v="' + esc(b.id) + '">Cancel this booking</button></p>' : "") +
      "</article>";
  }
  // Organizer adds someone to a booked table (if a seat is free).
  function addPersonBlock(b) {
    if (P.addFor !== b.id) {
      return b.seatsLeft > 0 ? '<p class="note"><button type="button" class="linkbtn" data-act="addPersonOpen" data-v="' + esc(b.id) + '">+ Add a person</button> · ' +
        b.seatsLeft + " seat" + (b.seatsLeft === 1 ? "" : "s") + " left at this table</p>" : '<p class="note">This table is full.</p>';
    }
    return '<div class="addperson"><h4 class="h3">Add a person</h4>' +
      field(req("Full name"), "add.name") + field("Email (optional)", "add.email", "email") +
      '<div class="field"><span>' + req("Age") + "</span>" + chips("add.age", AGES.map(function (a) { return [a, a]; }), P.add.age) + "</div>" +
      genderBlock("add", FRIEND_GENDERS) +
      '<button type="button" class="btn" data-act="addPersonSave" data-v="' + esc(b.id) + '">Add to table</button> &nbsp; ' +
      '<button type="button" class="linkbtn" data-act="addPersonCancel">Cancel</button>' +
      '<p class="note">They’ll use your party link to take their own character quiz.</p></div>';
  }
  function privacyNote() {
    return '<p class="private"><span aria-hidden="true">🔒</span> We use your details only to match you to the game table that’s best for you.</p>';
  }

  // Quiz questions are generated screens q0..qN
  GAME.quiz.forEach(function (q, i) {
    SCREENS["q" + i] = {
      stage: 2, noNext: true, quiz: true,
      render: function () {
        return '<p class="kicker">Question ' + (i + 1) + " of " + GAME.quiz.length + '</p><h1 class="title">' + q.q + "</h1>" +
          '<div class="answers">' + q.options.map(function (o, j) {
            return '<button type="button" class="answer' + (P.quiz[q.id] === j ? " is-on" : "") + '" data-act="answer" data-q="' + q.id + '" data-v="' + j + '">' + esc(o.t) + "</button>";
          }).join("") + "</div>";
      },
      valid: function () { return P.quiz[q.id] != null ? "" : "Choose an answer."; }
    };
  });

  function choice(key, val, title, sub, advance) {
    var on = P[key] === val;
    return '<button type="button" class="choice' + (on ? " is-on" : "") + '" data-act="choice" data-k="' + key + '" data-v=\'' + JSON.stringify(val) + "'" +
      (advance ? ' data-advance="1"' : "") + "><strong>" + title + "</strong>" + (sub ? "<span>" + sub + "</span>" : "") + "</button>";
  }
  function prefRow(m) {
    var pr = P.prefs[m.id] || { choice: "none" };
    var takenByOthers = Object.keys(P.prefs || {}).filter(function (k) {
      return k !== m.id && members().some(function (x) { return x.id === k; });
    }).map(function (k) { return P.prefs[k] && P.prefs[k].choice; });
    var cg = m.isMe ? P.charGender : charGenderFor(m.gender);
    var chars = GAME.characters.filter(function (c) { return !cg || c.gender === cg; });
    var opts = [["none", "Open to any character"]];
    if (!cg) opts.push(["anyF", "Any female character"], ["anyM", "Any male character"]);
    opts = opts.concat(chars.map(function (c) { return [c.id, c.name]; }));
    return '<div class="pref"><strong>' + esc(m.name) + (m.isMe ? " (you)" : "") + "</strong>" +
      '<select data-k="prefs.' + m.id + '.choice">' + opts.map(function (o) {
        var taken = charById(o[0]) && takenByOthers.indexOf(o[0]) >= 0;
        return '<option value="' + o[0] + '"' + (pr.choice === o[0] ? " selected" : "") + (taken ? " disabled" : "") + ">" +
          o[1] + (taken ? " (picked by someone else)" : "") + "</option>";
      }).join("") + "</select></div>";
  }
  // Pairing comfort: optional, private, asked of everyone for themselves.
  function requestsBlock() {
    if (hasPartner()) return "";
    return '<div class="requests comfort"><h2 class="comfort__q">Which genders are you comfortable being paired with in an in-game romance?</h2>' +
      '<div class="chips chips--big">' + COMFORT.map(function (o) {
        return '<button type="button" class="chip' + (P.comfort.indexOf(o[0]) >= 0 ? " is-on" : "") + '" data-toggle="comfort" data-v="' + o[0] + '">' + o[1] + "</button>";
      }).join("") + "</div>" +
      '<p class="private"><span aria-hidden="true">🔒</span> Optional, choose all that apply. Your answer here will only be used for matching and will never be displayed or shared with other players.</p></div>';
  }
  function proposeLink(label) { return '<button type="button" class="linkbtn linkbtn--big" data-act="propose">' + label + " →</button>"; }
  function loading() { return '<div class="loading"><span></span></div>'; }
  function offline() { return '<p class="warn">We can’t reach our booking system right now. Please try again in a few minutes.</p>'; }
  function addFriend() { P.friends.push({ id: uid(8), name: "", email: "", age: "", gender: "", genderText: "" }); }
  function partyLink() {
    return location.origin + location.pathname + "?p=" + P.partyToken + (GAME.id !== "prague" ? "&game=" + GAME.id : "");
  }

  /* ---------------------------------------------------------
     Flow
     --------------------------------------------------------- */
  function quizSteps() {
    var fixed = P.kind === "friend" && P.options && P.options.assigned;
    var f = fixed ? ["quizIntro"] : ["quizIntro", "charGender"]; // intro, then which gender of character, then the questions
    GAME.quiz.forEach(function (q, i) { f.push("q" + i); });
    if (!emailVerified()) f.push("verifyEmail"); // confirm the email before showing matches
    f.push("result");
    return f;
  }
  function flow() {
    if (P.kind === "message") return ["message"];
    if (P.kind === "portal") return ["pEmail", "pCode", "pHome"];
    syncCharGender();
    if (P.kind === "friend") return ["fWelcome", "fAbout"].concat(quizSteps(), P.partnered ? [] : ["fRequests"], ["fDone"]);
    var f = ["about", "who"];
    if (hasFriends()) f.push("friends");
    if (P.mode === "group") f.push("connections");
    if (P.joining) f.push("joinDate");
    f = f.concat(quizSteps(), ["prefs", "match"]);
    if (P.showCalendar) f.push("calendar");
    f.push("review");
    if (P.status === "Booked") f.push("done");
    return f;
  }

  // After the code: on to the matches, or straight to review if a table is already held.
  function afterVerify() { return P.sessionId && P.status !== "Booked" && P.step !== "result" && P.heldAt ? "review" : "result"; }
  function emailVerified() { return !!P.emailVerified && P.emailVerified === String(P.me.email).trim().toLowerCase(); }

  function sendCode() {
    P.codeSentTo = typedEmail(); P.code = "";
    save();
    return api("sendCode", payload()).then(function (res) {
      if (!res.ok) { P.codeSentTo = ""; flash = res.error === "wait" ? "Please wait a minute before asking for another code." : "We couldn’t send a code. Please try again."; render(); }
      return res;
    });
  }
  // Already signed in (e.g. booked before on this device) with this same email? Skip the code.
  function verifyOrSkip() {
    signedInEmail().then(function (e) {
      if (live() && e && e === typedEmail() && P.kind === "friend") { P.emailVerified = e; go("result"); return; }
      if (live() && e && e === typedEmail()) {
        rpc("claim_booking", draftArgs()).then(function (res) {
          if (res && res.ok) { P.emailVerified = e; go(afterVerify()); } else if (P.codeSentTo !== typedEmail()) sendCode();
        });
      } else if (P.codeSentTo !== typedEmail()) sendCode();
    });
  }

  function go(step) {
    if (step === "quizIntro" && P.step !== "quizIntro") loadTables();
    if (step === "match" && live()) setTimeout(loadRecs, 0);
    if (step === "calendar" && live()) setTimeout(loadBrowse, 0);
    if (step === "verifyEmail" && P.step !== "verifyEmail") verifyOrSkip();
    P.step = step; flash = ""; persist();
    render();
    window.scrollTo(0, 0);
  }

  function next() {
    var scr = SCREENS[P.step], err = scr.valid ? scr.valid() : "";
    if (err) { flash = err; render(); return; }
    var f = flow(), i = f.indexOf(P.step), to = f[i + 1];
    if (P.step === "verifyEmail") { checkCode(); return; }
    if (P.step === "pEmail") { portalSend(); return; }
    if (P.step === "pCode") { portalVerify(); return; }
    if (P.kind === "friend" && to === "fDone") { submitFriend(); return; }
    if (P.step === "calendar") { holdTable(P.pick); return; }
    save();
    if (to) go(to);
  }
  function back() {
    var f = flow(), i = f.indexOf(P.step);
    if (i > 0) go(f[i - 1]);
  }

  function render() {
    var f = flow();
    if (f.indexOf(P.step) < 0) P.step = f[0];
    var scr = SCREENS[P.step];
    var stages = P.kind === "friend" ? FRIEND_STAGES : STAGES;
    var stage = P.kind === "friend" ? (P.step === "verifyEmail" ? 1 : scr.quiz || P.step === "charGender" || P.step === "quizIntro" || P.step === "result" ? 1 : scr.stage) : scr.stage;
    var showBack = !scr.noBack && f.indexOf(P.step) > 0;

    app.classList.add("fresh");
    app.innerHTML =
      (P.kind === "message" || P.kind === "portal" ? "" : '<ol class="progress">' + stages.map(function (s, i) {
        return '<li class="' + (i < stage ? "is-done" : i === stage ? "is-on" : "") + '"><span>' + s + "</span></li>";
      }).join("") + "</ol>") +
      '<section class="screen">' + scr.render() + "</section>" +
      '<p class="error" role="alert">' + esc(flash) + "</p>" +
      '<div class="snav">' +
      (showBack ? '<button type="button" class="linkbtn" data-act="back">← Back</button>' : "<span></span>") +
      (scr.noNext ? "" : '<button type="button" class="btn" data-act="next">' + ((typeof scr.next === "function" ? scr.next() : scr.next) || "Continue") + "</button>") +
      "</div>";

    var restart = document.getElementById("restart");
    if (restart) { restart.hidden = !(P.kind === "booking" && P.step !== "about"); restart.textContent = P.status === "Booked" ? "New booking" : "Start over"; }
  }

  /* ---------------------------------------------------------
     Actions
     --------------------------------------------------------- */
  var ACTS = {
    next: next,
    back: back,
    choice: function (el) {
      P[el.dataset.k] = JSON.parse(el.dataset.v);
      if (el.dataset.k === "mode" && P.mode === "solo") P.couples = [];
      if (el.dataset.k === "mode" && P.mode === "plusone" && P.friends.length > 1) {
        var keep = P.friends[0].id;
        P.friends = P.friends.slice(0, 1);
        P.couples = P.couples.filter(function (c) { return c.every(function (id) { return !id || id === "me" || id === keep; }); });
      }
      if (el.dataset.advance) { persist(); render(); setTimeout(next, 180); } else render();
    },
    joining: function () { P.joining = !P.joining; if (!P.joining) P.joinSession = ""; render(); },
    addFriend: function () { addFriend(); render(); },
    rmFriend: function (el) {
      var f = P.friends.splice(+el.dataset.v, 1)[0];
      P.couples = P.couples.filter(function (c) { return c.indexOf(f.id) < 0; });
      delete P.prefs[f.id];
      render();
    },
    addCouple: function () { P.couples.push(["", ""]); render(); },
    rmCouple: function (el) { P.couples.splice(+el.dataset.v, 1); render(); },
    answer: function (el) {
      P.quiz[el.dataset.q] = +el.dataset.v;
      persist(); render();
      setTimeout(next, 220);
    },
    requestsOn: function () { P.requestsOn = true; render(); var t = app.querySelector("textarea"); if (t) t.focus(); },
    date: function (el) {
      if (P.step === "joinDate") P.joinSession = el.dataset.v; else P.pick = el.dataset.v;
      render();
    },
    pickTable: function (el) { P.showCalendar = false; holdTable(el.dataset.v); },
    propose: function () { P.showCalendar = true; P.pick = null; go("calendar"); },
    resend: function () { sendCode().then(function (r) { if (r.ok) { flash = "A new code is on its way."; render(); } }); },
    changeEmail: function () { P.codeSentTo = ""; go(P.kind === "friend" ? "fAbout" : "about"); },
    book: book,
    copy: function (el) {
      (navigator.clipboard ? navigator.clipboard.writeText(partyLink()) : Promise.reject()).then(function () {
        el.textContent = "Copied";
        setTimeout(function () { el.textContent = "Copy"; }, 1600);
      }, function () { app.querySelector(".flink input").select(); });
    },
    editProfile: function () {
      var pr = (PORTAL && PORTAL.profile) || {};
      P.edit = { name: pr.name || "", phone: pr.phone || "", birthYear: pr.birthYear ? String(pr.birthYear) : "", gender: pr.gender || "", genderText: pr.genderText || "" };
      P.editing = true; render();
    },
    cancelEdit: function () { P.editing = false; render(); },
    addPersonOpen: function (el) { P.addFor = el.dataset.v; P.add = { name: "", email: "", age: "", gender: "", genderText: "" }; render(); },
    addPersonCancel: function () { P.addFor = null; render(); },
    addPersonSave: function (el) {
      var a = P.add;
      if (!a.name.trim() || !a.age || !a.gender) { flash = "Please add their name, age and gender."; render(); return; }
      if (a.email && !validEmail(a.email)) { flash = "Please check their email, or leave it blank."; render(); return; }
      rpc("portal_add_person", { p_id: el.dataset.v, p: a }).then(function (res) {
        if (!res || !res.ok) { flash = res && res.error === "full" ? "Sorry, this table is now full." : "Couldn’t add them. Please try again."; render(); return; }
        P.addFor = null; loadPortal();
      });
    },
    removePerson: function (el) {
      if (!confirm("Remove this person from your booking? Their seat will be released.")) return;
      rpc("portal_remove_person", { p_id: el.dataset.b, p_member: el.dataset.v }).then(function (res) {
        if (!res || !res.ok) { flash = "Couldn’t remove them. Please try again."; render(); return; }
        loadPortal();
      });
    },
    saveProfile: function () {
      if (!P.edit.name.trim()) { flash = "Please add your name."; render(); return; }
      if (P.edit.birthYear && yearError(P.edit.birthYear)) { flash = yearError(P.edit.birthYear); render(); return; }
      rpc("update_profile", { p: P.edit }).then(function (res) {
        if (!res || !res.ok) { flash = "Couldn’t save. Please try again."; render(); return; }
        P.editing = false; loadPortal();
      });
    },
    cancelBooking: function (el) {
      if (!confirm("Cancel this booking for everyone in your party? This frees all your seats.")) return;
      rpc("cancel_booking", { p_id: el.dataset.v }).then(function () { loadPortal(); });
    },
    copyLink: function (el) {
      (navigator.clipboard ? navigator.clipboard.writeText(el.dataset.v) : Promise.reject()).then(function () {
        el.textContent = "Copied"; setTimeout(function () { el.textContent = "Copy link"; }, 1600);
      }, function () {});
    },
    signOut: function () {
      (sb ? sb.auth.signOut() : Promise.resolve()).then(function () { PORTAL = null; P = { kind: "portal", step: "pEmail", email: "" }; render(); });
    },
    share: function () {
      navigator.share({ title: GAME.title, text: first(P.me.name) + " booked us seats at " + GAME.title + ". Pick your name and take the character quiz:", url: partyLink() }).catch(function () {});
    },
    pickFriend: function (el) {
      var m = P.party.filter(function (x) { return x.id === el.dataset.v; })[0];
      P.friendId = m.id; P.partnered = !!m.partnered;
      loadFriendOptions();
      P.me.name = m.name || ""; P.me.age = m.age || "";
      P.me.gender = m.gender === "unsure" ? "" : (m.gender || ""); P.me.genderText = "";
      render(); setTimeout(next, 180);
    },
    someoneElse: function () { forget(partyKey()); boot(); }
  };

  app.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act],[data-set],[data-toggle]");
    if (!el || el.disabled) return;
    if (el.dataset.set) {
      setPath(P, el.dataset.set, el.dataset.v);
      flash = "";
      render(); return;
    }
    if (el.dataset.toggle) {
      if (el.dataset.toggle === "comfort") P.comfortTouched = true;
      var arr = getPath(P, el.dataset.toggle), i = arr.indexOf(el.dataset.v);
      if (i >= 0) arr.splice(i, 1); else arr.push(el.dataset.v);
      render(); return;
    }
    if (ACTS[el.dataset.act]) ACTS[el.dataset.act](el);
  });
  app.addEventListener("mousemove", function () { app.classList.remove("fresh"); });
  app.addEventListener("input", function (e) {
    var k = e.target.dataset.k;
    if (!k) return;
    setPath(P, k, e.target.value);
    persist();
    if (e.target.tagName === "SELECT") render(); // e.g. a character choice reveals Preferred / Required
  });
  app.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && !SCREENS[P.step].noNext) { e.preventDefault(); next(); }
  });

  // Holds the table's seats for 30 minutes (in the database) while the organizer verifies and confirms.
  function holdTable(sessionId) {
    if (!sessionId || busy) return;
    var t = [].concat((RECS && RECS.tables) || [], (BROWSE && BROWSE.sessions) || [])
      .filter(function (x) { return x.sessionId === sessionId; })[0];
    busy = true; render();
    rpc("save_draft", draftArgs({ p_data: payload() })).then(function () {
      return rpc("hold_table", draftArgs({ p_session: sessionId }));
    }).then(function (res) {
      busy = false;
      if (!res || !res.ok) {
        flash = "Sorry, that table just filled up or closed. Here’s what’s available now.";
        if (P.step === "calendar") loadBrowse(); else loadRecs();
        render(); return;
      }
      P.heldAt = Date.now();
      P.sessionId = sessionId; P.sessionDate = t ? t.date : ""; P.sessionTime = t ? t.time : ""; P.myCharacter = res.character || "";
      P.partnerCharacter = res.partnerCharacter || "";
      persist();
      go(emailVerified() ? "review" : "verifyEmail");
    });
  }

  // Testing period: no payment. Confirming books the held seats.
  function book() {
    busy = true; render();
    api("book", payload()).then(function (res) {
      busy = false;
      if (!res.ok) {
        if (res.error === "unverified") { P.emailVerified = ""; P.codeSentTo = ""; go("verifyEmail"); return; }
        if (res.error === "full" || res.error === "no_table") {
          P.sessionId = ""; go("match"); flash = "Sorry, that table filled up or closed while you were confirming. Please choose another."; render(); return;
        }
        flash = "Something went wrong. Please try again."; render(); return;
      }
      P.status = "Booked";
      persist();
      go("done");
    });
  }

  function checkCode() {
    busy = true;
    if (P.kind === "friend") {
      api("verifyOnly", { code: String(P.code).trim() }).then(function (res) {
        busy = false;
        if (!res.ok) { flash = "That code didn’t match or has expired. Check it, or tap “Send a new code”."; render(); return; }
        P.emailVerified = typedEmail();
        go("result");
      });
      return;
    }
    api("verifyCode", { bookingId: P.bookingId, email: P.me.email, code: String(P.code).trim() }).then(function (res) {
      busy = false;
      if (!res.ok) {
        flash = res.error === "wrong" ? "That code didn’t match or has expired. Check it, or tap “Send a new code”." : "Something went wrong. Please try again.";
        render(); return;
      }
      if (res.error === "email_mismatch") { flash = "Please use the email you entered at the start."; render(); return; }
      P.emailVerified = String(P.me.email).trim().toLowerCase();
      go(afterVerify());
    });
  }

  function portalSend() {
    P.email = String(P.email).trim().toLowerCase(); P.code = "";
    if (!live()) { flash = "We can’t reach our booking system right now. Please try again shortly."; render(); return; }
    // Same message whether or not the email has an account, so the page can't be used to check who's booked.
    sb.auth.signInWithOtp({ email: P.email, options: { shouldCreateUser: false } }).then(function (r) {
      if (r.error && (r.error.status === 429 || /second|rate|limit/i.test(r.error.message || ""))) {
        flash = "Please wait a minute before asking for another code."; render(); return;
      }
      go("pCode");
    });
  }
  function portalVerify() {
    if (!live()) return;
    sb.auth.verifyOtp({ email: P.email, token: String(P.code).trim(), type: "email" }).then(function (r) {
      if (r.error) { flash = "That code didn’t match or has expired."; render(); return; }
      loadPortal();
    });
  }
  function loadPortal() {
    rpc("my_portal").then(function (d) {
      if (!d || d.ok === false) { P = { kind: "portal", step: "pEmail", email: "" }; render(); return; }
      PORTAL = d; P = { kind: "portal", step: "pHome", editing: false }; render(); window.scrollTo(0, 0);
    });
  }
  // A signed-in returning player gets their saved details filled in on step 1.
  function prefillFromProfile() {
    if (!(P.kind === "booking" && P.step === "about" && !P.me.name)) return;
    signedInEmail().then(function (e) {
      if (!e) return;
      rpc("my_portal").then(function (d) {
        var pr = d && d.profile;
        if (!pr || P.me.name) return;
        P.me.name = pr.name || ""; P.me.email = e; P.me.phone = pr.phone || ""; P.me.birthYear = pr.birthYear ? String(pr.birthYear) : "";
        P.me.gender = pr.gender || ""; P.me.genderText = pr.genderText || ""; P.prefilled = true;
        if (P.step === "about") render();
      });
    });
  }

  function loadFriendOptions() {
    if (!live() || !P.friendId) return Promise.resolve();
    return rpc("friend_options", { p_token: partyToken, p_member: P.friendId }).then(function (o) {
      if (!o || o.ok === false) return;
      P.options = o;
      var fixed = o.assigned && charById(o.assigned);
      if (fixed) P.charGender = fixed.gender; // their character is set, so rank within its gender
      persist(); render();
    });
  }

  function submitFriend() {
    var r = rankForMe();
    api("friend", { friendId: P.friendId, me: P.me, charGender: P.charGender, quiz: P.quiz, comfort: P.comfort, requests: P.requests,
      scores: allScores(), topMatch: r[0] && r[0].id, topMatches: r.slice(0, 3).map(function (c) { return c.name + " " + c.pct + "%"; }).join(", ") })
      .then(function (res) {
        if (!res.ok) {
          if (res.error === "unverified" || res.error === "email_mismatch") { P.emailVerified = ""; P.codeSentTo = ""; go("verifyEmail"); return; }
          flash = res.error === "not_found" ? "This seat has already been filled in, or the link has changed. Please check with the person who booked." : "Something went wrong. Please try again.";
          render(); return;
        }
        P.alreadyBooked = res.warning === "already_booked";
        P.myCharacter = res.character || "";
        persist();
        go("fDone");
      });
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  document.getElementById("gameName").textContent = GAME.title;
  var restartBtn = document.getElementById("restart");
  if (restartBtn) restartBtn.addEventListener("click", function () {
    if (P.status === "Draft" && !confirm("Start over? Your answers on this device will be cleared.")) return;
    forget(DRAFT_KEY); P = freshBooking(); render();
  });

  function message(title, text) { P = { kind: "message", step: "message", title: title, text: text }; render(); }

  var avReady = loadGame();

  // Friend follow-up: one link per party (?p=<partyToken>); each friend picks who they are.
  function boot() {
    P = restore(partyKey());
    if (P && P.step === "fDone") { render(); return; }
    message("One moment…", "");
    avReady.then(function () {
      if (!live()) return { ok: false };
      return rpc("party_info", { p_token: partyToken });
    }).then(function (d) {
      if (!d || !d.ok) { message("That link didn’t work.", "Please ask the person who booked to send it again."); return; }
      P = restore(partyKey()) || {
        kind: "friend", step: "fWelcome", friendId: "",
        me: { name: "", email: "", phone: "", birthYear: "", age: "", gender: "", genderText: "" },
        charGender: "", quiz: {}, comfort: [], requestsOn: false, requests: ""
      };
      P.organizer = d.organizer || ""; P.sessionLabel = d.sessionLabel || ""; P.party = d.members || [];
      render();
      if (P.friendId && P.step !== "fDone") loadFriendOptions();
    }).catch(function () { message("That link didn’t work.", "Please try again in a moment."); });
  }

  if (params.has("portal")) {
    P = { kind: "portal", step: "pEmail", email: "" };
    message("One moment…", "");
    avReady.then(function () { return signedInEmail(); }).then(function (e) {
      if (e && live()) loadPortal(); else { P = { kind: "portal", step: "pEmail", email: "" }; render(); }
    });
  } else if (partyToken) {
    boot();
  } else {
    P = restore(DRAFT_KEY) || freshBooking();
    if (!P.partyToken) P.partyToken = uid(16);
    if (!P.secret) P.secret = uid(24);
    render();
    avReady.then(prefillFromProfile);
  }
})();

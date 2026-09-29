/* =========================================================
   Odeum — signed-in account panel (MOCKUP, sample data only)
   ========================================================= */
(function () {
  "use strict";

  var IMG = "../../images/";
  var TODAY = new Date("2026-09-28T12:00:00");

  var MEMBER = {
    name: "Pat Alvarez", initials: "PA", email: "pat@example.com", phone: "(212) 555-0142",
    age: "26–35", gender: "Female", comfort: "Male, Nonbinary",
    upcoming: [{
      game: "Summertime in Prague", era: "Czechoslovakia, 1968", img: IMG + "mirror.webp",
      date: "2026-10-24", time: "6:00–11:00 PM", place: "Upper West Side",
      organizer: true, matches: "Eva 92% · Vera 71% · Petra 40%",
      party: [
        { n: "Pat", done: true, you: true }, { n: "Jordan", done: true },
        { n: "Robin", done: false }, { n: "Sam", done: false }
      ]
    }],
    interested: [{ game: "The Republic of Wills", era: "Rome, 100 BCE", img: IMG + "dinner.jpg" }],
    past: [{
      game: "Summertime in Prague", note: "Beta playtest", date: "2026-09-26",
      img: "../../images/prague/cast/vera.jpg", played: "Vera", table: 6
    }]
  };
  var NEWBIE = { name: "Sam Rivera", initials: "SR", email: "sam@example.com", phone: "(917) 555-0199",
    age: "22–25", gender: "Male", comfort: "", upcoming: [], interested: [], past: [] };

  var state = "member", tab = "upcoming", user = MEMBER, lastFocus = null;
  var acct = document.getElementById("acct");
  var body = document.getElementById("acctBody");

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function d(id) { return new Date(id + "T12:00:00"); }
  function longDate(id) { return d(id).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); }
  function shortDate(id) { return d(id).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
  function daysUntil(id) { return Math.round((d(id) - TODAY) / 864e5); }
  function greeting() { var h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
  function pending(g) { return g.party.filter(function (p) { return !p.done; }); }

  function toast(msg) {
    var t = document.querySelector(".acct-toast");
    if (!t) { t = document.createElement("div"); t.className = "acct-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("is-on");
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("is-on"); }, 1800);
  }

  /* ---------- tabs ---------- */
  function renderUpcoming() {
    if (!user.upcoming.length) {
      return '<div class="empty"><h3>Your first story<br /><em>is waiting.</em></h3>' +
        "<p>Book a table for yourself or your friends. It takes about five minutes, and we’ll match you with a character.</p>" +
        '<a class="acct__cta" href="../../signup/">Book a game</a></div>';
    }
    var g = user.upcoming[0], n = daysUntil(g.date), wait = pending(g);
    var html = '<p class="acct__label">Next game</p>' +
      '<article class="ticket">' +
      '<div class="ticket__media"><img src="' + g.img + '" alt="" />' +
      '<span class="ticket__count">' + (n === 0 ? "Tonight" : n === 1 ? "Tomorrow" : "In " + n + " days") + "</span>" +
      '<div class="ticket__title"><p class="ticket__era">' + g.era + '</p><h3 class="ticket__name">' + g.game + "</h3></div></div>" +
      '<div class="ticket__body">' +
      '<p class="ticket__when">' + longDate(g.date) + "</p>" +
      '<p class="ticket__where">' + g.time + " · " + g.place + "</p>" +
      '<dl class="facts">' +
      '<dt>Character</dt><dd><span class="locked">Revealed one week before the game</span></dd>' +
      "<dt>Your matches</dt><dd>" + g.matches + "</dd>" +
      "<dt>Address</dt><dd>Sent to you three days before</dd>" +
      "<dt>Your party</dt><dd><div class=\"party\">" + g.party.map(function (p) {
        return '<span class="party__p ' + (p.done ? "is-done" : "is-wait") + '" title="' + (p.done ? "Quiz done" : "Quiz not taken yet") + '">' +
          '<span class="party__i">' + (p.done ? "✓" : p.n[0]) + "</span>" + esc(p.n) + (p.you ? " (you)" : "") + "</span>";
      }).join("") + "</div></dd>" +
      "</dl>" +
      '<div class="ticket__actions">' +
      (g.organizer ? '<button class="chipbtn" data-act="copy">Copy party link</button>' : "") +
      '<button class="chipbtn" data-act="calendar">Add to calendar</button>' +
      '<button class="chipbtn" data-act="details">Game details</button>' +
      "</div></div></article>";
    if (g.organizer && wait.length) {
      html += '<div class="nudge"><div>' + wait.map(function (p) { return esc(p.n); }).join(" and ") +
        (wait.length > 1 ? " haven’t" : " hasn’t") + " taken the character quiz yet. We need it to cast them.<br />" +
        '<button data-act="copy">Copy the party link to send again</button></div></div>';
    }
    if (user.interested.length) {
      html += '<p class="acct__label">On your list</p>' + user.interested.map(function (x) {
        return '<div class="gamerow"><img src="' + x.img + '" alt="" /><div class="gamerow__t"><div class="gamerow__name">' + x.game + "</div>" +
          '<div class="gamerow__meta">' + x.era + " · We’ll email you when tables open</div></div></div>";
      }).join("");
    }
    return html;
  }

  function renderPast() {
    if (!user.past.length) {
      return '<div class="empty"><h3>No past games yet.</h3><p>After each game, the character you played and your table’s story will live here.</p></div>';
    }
    return '<p class="acct__label">Games you’ve played</p>' + user.past.map(function (g) {
      return '<div class="gamerow"><img src="' + g.img + '" alt="Portrait of ' + g.played + '" /><div class="gamerow__t">' +
        '<div class="gamerow__name">' + g.game + "</div>" +
        '<div class="gamerow__meta">' + shortDate(g.date) + " · " + g.note + "</div>" +
        '<div class="gamerow__meta">You played <b>' + g.played + "</b> · Table of " + g.table + "</div></div>" +
        '<button class="gamerow__go" data-act="feedback">Share feedback</button></div>';
    }).join("") +
      '<p class="acct__label">Coming later</p><div class="private">Photos from your night, the ending your table reached, and the people you played with (if they opt in).</div>';
  }

  function renderAccount() {
    return '<p class="acct__label">Your details</p>' +
      '<dl class="kv">' +
      "<dt>Name</dt><dd>" + esc(user.name) + "</dd>" +
      "<dt>Email</dt><dd>" + esc(user.email) + "</dd>" +
      "<dt>Phone</dt><dd>" + esc(user.phone) + "</dd>" +
      "<dt>Age</dt><dd>" + esc(user.age) + "</dd>" +
      "<dt>Gender</dt><dd>" + esc(user.gender) + "</dd>" +
      "</dl>" +
      '<div class="textlinks"><button data-act="edit">Edit details</button></div>' +
      '<p class="acct__label">Pairing comfort</p>' +
      '<div class="private">🔒 <strong>' + (user.comfort || "Nothing shared") + "</strong><br />" +
      "Only you can see this. It’s used for matching and never shown to anyone in your party or at your table.</div>" +
      '<div class="textlinks"><button data-act="edit">Change</button></div>' +
      '<p class="acct__label">Notifications</p>' +
      '<div class="toggle-row">Game reminders by email<button class="switch is-on" data-act="switch" aria-label="Game reminders"></button></div>' +
      '<div class="toggle-row">Tell me when new games open<button class="switch" data-act="switch" aria-label="New games"></button></div>' +
      '<p class="acct__label">Privacy</p>' +
      '<div class="textlinks"><button data-act="download">Download my data</button><button class="danger" data-act="delete">Delete my account</button></div>';
  }

  function renderPanel() {
    document.getElementById("acctHello").textContent = greeting() + ", " + user.name.split(" ")[0] + ".";
    document.querySelectorAll(".acct__tab").forEach(function (t) { t.classList.toggle("is-on", t.dataset.tab === tab); });
    body.innerHTML = tab === "upcoming" ? renderUpcoming() : tab === "past" ? renderPast() : renderAccount();
    body.scrollTop = 0;
  }

  /* ---------- page state ---------- */
  function setState(s) {
    state = s; user = s === "new" ? NEWBIE : MEMBER;
    document.body.classList.toggle("is-guest", s === "guest");
    document.querySelectorAll(".demo button").forEach(function (b) { b.classList.toggle("is-on", b.dataset.state === s); });
    document.getElementById("avatarInitials").textContent = user.initials;
    var needs = user.upcoming.length && pending(user.upcoming[0]).length;
    document.getElementById("avatarDot").hidden = !needs;
    document.getElementById("rowBooked").style.display = user.upcoming.length ? "" : "none";
    var title = document.getElementById("welcomeTitle"), lede = document.getElementById("welcomeLede");
    if (user.upcoming.length) {
      var g = user.upcoming[0], w = pending(g).length;
      title.innerHTML = "Your next story<br /><em>begins</em> " + d(g.date).toLocaleDateString("en-US", { weekday: "long" }) + ".";
      lede.textContent = g.game + ", " + longDate(g.date) + "." + (w ? " " + (w === 1 ? "One friend still needs" : w + " of your friends still need") + " to take their character quiz." : "");
    } else {
      title.innerHTML = "Welcome to Odeum,<br /><em>" + esc(user.name.split(" ")[0]) + ".</em>";
      lede.textContent = "Your account is ready. Choose a night, bring your friends, and we’ll find the character that fits you.";
    }
    if (s === "guest") close();
    tab = "upcoming";
  }

  function open(which) {
    if (state === "guest") return;
    if (which) tab = which;
    lastFocus = document.activeElement;
    renderPanel();
    acct.classList.add("is-open"); acct.setAttribute("aria-hidden", "false");
    document.body.classList.add("acct-open");
    setTimeout(function () { acct.querySelector(".acct__close").focus(); }, 50);
  }
  function close() {
    if (!acct.classList.contains("is-open")) return;
    acct.classList.remove("is-open"); acct.setAttribute("aria-hidden", "true");
    document.body.classList.remove("acct-open");
    if (lastFocus) lastFocus.focus();
  }

  /* ---------- events ---------- */
  document.getElementById("avatarBtn").addEventListener("click", function () { open(); });
  document.querySelectorAll("[data-open-acct]").forEach(function (b) { b.addEventListener("click", function () { open(); }); });
  acct.addEventListener("click", function (e) {
    if (e.target.closest("[data-close]")) { close(); return; }
    var t = e.target.closest(".acct__tab");
    if (t) { tab = t.dataset.tab; renderPanel(); return; }
    var a = e.target.closest("[data-act]");
    if (!a) return;
    var msgs = {
      copy: "Party link copied", calendar: "Calendar invite downloaded (mockup)", details: "Opens the game page (mockup)",
      feedback: "Opens a short feedback form (mockup)", edit: "Editing opens here (mockup)",
      download: "Your data would download as a file (mockup)", delete: "Asks you to confirm, then erases everything (mockup)"
    };
    if (a.dataset.act === "switch") { a.classList.toggle("is-on"); return; }
    toast(msgs[a.dataset.act] || "Mockup");
  });
  document.querySelector("[data-demo-signout]").addEventListener("click", function () { setState("guest"); toast("Signed out"); });
  document.querySelector("[data-demo-signin]").addEventListener("click", function (e) { e.preventDefault(); setState("member"); toast("Signed in (mockup)"); });
  document.querySelectorAll(".demo button").forEach(function (b) { b.addEventListener("click", function () { setState(b.dataset.state); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  setState("member");
})();

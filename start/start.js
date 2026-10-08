/* =========================================================
   Odeum — "Join a game" hub (temporary standalone entry page)

   Section 03 reads live availability from the same Google Sheet
   (via the Apps Script web app) the beta page uses, and lists the
   upcoming evenings with their open seats. Reserving still happens
   on the beta page (../SIPbeta/), which handles the slot locking.
   ========================================================= */
(function () {
  "use strict";

  // Same Apps Script web app as the beta signup page.
  var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyR83a0vBQlhoPWsqm3IjfMQJZsTU-p0B9q7x8SYYPAZ-6oMvO_UjB0qnxVjfTlwMgm/exec";

  // Six player characters — ids must match the beta page (used to count seats).
  var CHARACTER_IDS = ["eva", "vaclav", "milan", "vera", "tomas", "petra"];
  var SEATS = CHARACTER_IDS.length;

  // Upcoming sessions — keep in sync with ../SIPbeta/prague.js.
  // `id` is the stable date key used in the sheet's SlotID ("<id>|<charId>").
  var SESSIONS = [
    { id: "2026-09-26", date: "Saturday 26 September 2026", time: "6:00–11:00 PM", place: "Upper West Side", full: true },
    { id: "2026-10-01", date: "Thursday 1 October 2026",   time: "6:00–11:00 PM", place: "Upper West Side", full: true },
    { id: "2026-10-17", date: "Saturday 17 October 2026",   time: "6:00–11:00 PM", place: "Upper West Side", full: true },
    { id: "2026-11-20", date: "Friday 20 November 2026",    time: "6:00–11:00 PM", place: "Upper West Side" },
    { id: "2026-11-21", date: "Saturday 21 November 2026",  time: "6:00–11:00 PM", place: "Upper West Side" }
  ];

  var RESERVE_URL = "../SIPbeta/#reserve";

  var statusMap = {};
  var listEl = document.getElementById("times-list");

  function slotId(s, cid) { return s.id + "|" + cid; }
  // A seat is open only when the sheet has no row for it; any status
  // (Pending or Confirmed) means it's held or taken.
  function isOpen(id) { return !statusMap[id]; }
  function openSeats(s) {
    if (s.full) return 0;
    return CHARACTER_IDS.filter(function (cid) { return isOpen(slotId(s, cid)); }).length;
  }

  // Only show today and future evenings (ISO date ids sort lexicographically).
  function upcoming() {
    var today = new Date();
    var iso = today.getFullYear() + "-" +
      String(today.getMonth() + 1).padStart(2, "0") + "-" +
      String(today.getDate()).padStart(2, "0");
    return SESSIONS.filter(function (s) { return s.id >= iso; });
  }

  function render(state) {
    listEl.innerHTML = "";

    if (state === "loading") {
      var bar = document.createElement("div");
      bar.className = "times__bar";
      bar.innerHTML = '<span>Checking live availability…</span><span class="times__track"><span></span></span>';
      listEl.appendChild(bar);
      return;
    }
    if (state === "error") {
      var err = document.createElement("p");
      err.className = "times__msg";
      err.textContent = "Couldn’t load live availability just now — please refresh the page.";
      listEl.appendChild(err);
      return;
    }

    var sessions = upcoming();
    if (!sessions.length) {
      var none = document.createElement("p");
      none.className = "times__msg";
      none.textContent = "No upcoming games listed right now — check back soon.";
      listEl.appendChild(none);
      return;
    }

    sessions.forEach(function (s) {
      var count = openSeats(s);
      var full = count === 0;
      var row = document.createElement(full ? "div" : "a");
      row.className = "trow" + (full ? " trow--full" : "");
      if (!full) { row.href = RESERVE_URL; }

      row.innerHTML =
        '<div class="trow__when">' +
          '<div class="trow__date">' + s.date + "</div>" +
          '<div class="trow__meta">' + s.time + " · " + s.place + "</div>" +
        "</div>" +
        '<div class="trow__status">' +
          (full
            ? '<span class="trow__full">Fully booked</span>'
            : '<span class="trow__open">' + count + " of " + SEATS + " seats open</span>" +
              '<span class="trow__go">Reserve →</span>') +
        "</div>";
      listEl.appendChild(row);
    });
  }

  function fetchAvailability(attempt) {
    var url = SCRIPT_URL + (SCRIPT_URL.indexOf("?") === -1 ? "?" : "&") + "nocache=" + Date.now();
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error("bad payload");
        statusMap = d.slots || {};
        render("ready");
      })
      .catch(function () {
        if (attempt < 3) {
          return new Promise(function (res) { setTimeout(res, 700 * attempt); })
            .then(function () { return fetchAvailability(attempt + 1); });
        }
        render("error");
      });
  }

  function init() {
    var allFull = SESSIONS.every(function (s) { return s.full; });
    if (!SCRIPT_URL || allFull) { render("ready"); return; }
    render("loading");
    fetchAvailability(1);
  }

  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  init();
})();

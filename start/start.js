/* =========================================================
   Odeum — "Join a game" hub (temporary standalone entry page)

   Section 03 is the SAME availability + request flow as the beta page
   (../SIPbeta/), ported here so guests can request a seat inline — no
   redirect. Requests POST to the same Google Sheet (Signups tab).

   NOTE: SESSIONS + CHARACTERS are duplicated from ../SIPbeta/prague.js.
   If dates / full flags change there, update them here too.
   ========================================================= */
(function () {
  "use strict";

  var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyR83a0vBQlhoPWsqm3IjfMQJZsTU-p0B9q7x8SYYPAZ-6oMvO_UjB0qnxVjfTlwMgm/exec";

  // Six player characters (id + name is all the slot grid needs).
  var CHARACTERS = [
    { id: "eva",    name: "Eva" },
    { id: "vaclav", name: "Vaclav" },
    { id: "milan",  name: "Milan" },
    { id: "vera",   name: "Vera" },
    { id: "tomas",  name: "Tomas" },
    { id: "petra",  name: "Petra" }
  ];

  // Upcoming sessions — keep in sync with ../SIPbeta/prague.js.
  var SESSIONS = [
    { id: "2026-09-26", date: "Saturday 26 September 2026", time: "6:00–11:00 PM", place: "Upper West Side", full: true },
    { id: "2026-10-01", date: "Thursday 1 October 2026",   time: "6:00–11:00 PM", place: "Upper West Side", full: true },
    { id: "2026-10-17", date: "Saturday 17 October 2026",   time: "6:00–11:00 PM", place: "Upper West Side", full: true },
    { id: "2026-11-03", date: "Tuesday 3 November 2026",    time: "6:00–11:00 PM", place: "Upper West Side" },
    { id: "2026-11-20", date: "Friday 20 November 2026",    time: "6:00–11:00 PM", place: "Upper West Side" },
    { id: "2026-11-21", date: "Saturday 21 November 2026",  time: "6:00–11:00 PM", place: "Upper West Side" }
  ];

  /* ---------- state + elements ---------- */
  var statusMap = {};
  var loadError = false;
  var expanded = {};
  var selected = null;

  var sessionsEl = document.getElementById("sessions");
  var modal = document.getElementById("modal");
  var modalTitle = document.getElementById("modalTitle");
  var modalSlot = document.getElementById("modalSlot");
  var modalStatus = document.getElementById("modalStatus");
  var modalForm = document.getElementById("modalForm");
  var modalDone = document.getElementById("modalDone");
  var form = document.getElementById("signupForm");
  var submitBtn = document.getElementById("submitBtn");

  var slotId = function (s, c) { return s.id + "|" + c.id; };
  var stateOf = function (id) {
    var st = statusMap[id];
    if (!st) return "open";
    return (String(st).toLowerCase() === "confirmed") ? "taken" : "pending";
  };

  /* ---------- render sessions + slots ---------- */
  function render(loading) {
    sessionsEl.innerHTML = "";

    if (loadError && !loading) {
      var err = document.createElement("div");
      err.className = "avail-error";
      err.textContent = "Couldn't load live availability just now — please refresh the page.";
      sessionsEl.appendChild(err);
    }

    if (loading) {
      var bar = document.createElement("div");
      bar.className = "avail-bar";
      bar.innerHTML =
        '<span class="avail-bar__label">Checking live availability…</span>' +
        '<span class="avail-bar__track"><span></span></span>';
      sessionsEl.appendChild(bar);
    }

    function openSeats(s) {
      return s.full ? 0 : CHARACTERS.filter(function (c) { return stateOf(slotId(s, c)) === "open"; }).length;
    }
    var ordered = loading ? SESSIONS.filter(function (s) { return !s.full; }) : SESSIONS;

    ordered.forEach(function (s) {
      var card = document.createElement("div");
      var openCount = openSeats(s);
      var full = !loading && openCount === 0;
      card.className = "session" + (full ? " session--full" + (expanded[s.id] ? " is-open" : "") : "");

      var count = loading
        ? "Checking…"
        : (full ? "Fully booked" : openCount + " of " + CHARACTERS.length + " seats open");

      var head = document.createElement(full ? "button" : "div");
      head.className = "session__head";
      if (full) {
        head.type = "button";
        head.setAttribute("aria-expanded", expanded[s.id] ? "true" : "false");
        head.addEventListener("click", function () {
          expanded[s.id] = !expanded[s.id];
          card.classList.toggle("is-open", expanded[s.id]);
          head.setAttribute("aria-expanded", expanded[s.id] ? "true" : "false");
        });
      }
      head.innerHTML =
        '<div><div class="session__date">' + s.date + "</div>" +
        '<div class="session__meta">' + s.time + " · " + s.place + "</div></div>" +
        '<div class="session__count">' + count + (full ? '<span class="session__chev" aria-hidden="true"></span>' : "") + "</div>";
      card.appendChild(head);

      var slots = document.createElement("div");
      slots.className = "slots";
      CHARACTERS.forEach(function (c) {
        var slot = document.createElement("div");
        if (loading) {
          slot.className = "slot slot--loading";
          slot.innerHTML =
            '<div class="slot__name">' + c.name + "</div>" +
            '<div class="slot__row"><span class="slot__state">Checking…</span></div>';
          slots.appendChild(slot);
          return;
        }
        var st = s.full ? "taken" : stateOf(slotId(s, c));
        slot.className = "slot slot--" + st;
        var label = st === "open" ? "Open" : (st === "pending" ? "Pending" : "Taken");
        var btn = st === "open"
          ? '<button class="slot__btn" type="button">Request →</button>'
          : '<button class="slot__btn" disabled>' + label + "</button>";
        slot.innerHTML =
          '<div class="slot__name">' + c.name + "</div>" +
          '<div class="slot__row"><span class="slot__state">' + label + "</span>" + btn + "</div>";
        if (st === "open") {
          slot.querySelector(".slot__btn").addEventListener("click", function () { openModal(s, c); });
        }
        slots.appendChild(slot);
      });
      card.appendChild(slots);
      sessionsEl.appendChild(card);
    });
  }

  /* ---------- availability fetch (cache-bust + retry) ---------- */
  function fetchAvailability(attempt) {
    var url = SCRIPT_URL + (SCRIPT_URL.indexOf("?") === -1 ? "?" : "&") + "nocache=" + Date.now();
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error("bad payload");
        statusMap = d.slots || {};
        loadError = false;
        render(false);
      })
      .catch(function () {
        if (attempt < 3) {
          return new Promise(function (res) { setTimeout(res, 700 * attempt); }).then(function () {
            return fetchAvailability(attempt + 1);
          });
        }
        loadError = true;
        render(false);
      });
  }

  function loadAvailability() {
    var allFull = SESSIONS.every(function (s) { return s.full; });
    if (!SCRIPT_URL || allFull) { render(false); return; }
    render(true);
    fetchAvailability(1);
  }

  /* ---------- modal ---------- */
  function openModal(session, character) {
    selected = { session: session, character: character };
    modalTitle.textContent = character.name;
    modalSlot.textContent = session.date + " · " + session.time;
    modalStatus.textContent = "";
    modalForm.hidden = false;
    modalDone.hidden = true;
    form.reset();
    submitBtn.disabled = false;
    submitBtn.textContent = "Send my request";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    var first = document.getElementById("f-name");
    if (first) first.focus();
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    selected = null;
  }

  modal.addEventListener("click", function (e) { if (e.target.hasAttribute("data-close")) closeModal(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
  });

  /* ---------- submit request ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selected) return;

    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var age = form.age.value.trim();
    var phone = form.phone.value.trim();
    var rec = form.recommendedBy.value.trim();

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone) {
      modalStatus.textContent = "Please add your name, a valid email, and a phone number.";
      return;
    }
    if (!age || isNaN(age) || Number(age) < 16) {
      modalStatus.textContent = "Please add your age (16+).";
      return;
    }
    if (!rec) {
      modalStatus.textContent = "Please tell us who invited you.";
      return;
    }

    var s = selected.session, c = selected.character;
    if (!SCRIPT_URL) { showDone(name, true); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    modalStatus.textContent = "";

    var body = new URLSearchParams({
      slotId: slotId(s, c),
      session: s.date + " · " + s.time,
      character: c.name,
      age: age, name: name, email: email, phone: phone, recommendedBy: rec
    });

    fetch(SCRIPT_URL, { method: "POST", body: body })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          statusMap[slotId(s, c)] = "Pending";
          showDone(name, false);
          loadAvailability();
        } else if (res && res.error === "taken") {
          modalStatus.textContent = "Ah — that seat was just requested by someone else. Please choose another.";
          submitBtn.disabled = false;
          submitBtn.textContent = "Send my request";
          statusMap[slotId(s, c)] = "Pending";
          render(false);
        } else {
          throw new Error("server");
        }
      })
      .catch(function () {
        modalStatus.textContent = "Something went wrong — please try again, or email sunpuxin@gmail.com.";
        submitBtn.disabled = false;
        submitBtn.textContent = "Send my request";
      });
  });

  function showDone(name, preview) {
    modalForm.hidden = true;
    modalDone.hidden = false;
    var msg = document.getElementById("doneMsg");
    var first = name.split(" ")[0];
    if (preview) {
      msg.textContent = "Thanks, " + first + " — this is a preview, so nothing was recorded yet.";
    } else {
      msg.textContent = "Thanks, " + first + ". Your seat is being held pending confirmation. " +
        "We'll confirm by email and send more details soon.";
    }
  }

  /* ---------- init ---------- */
  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  loadAvailability();
})();

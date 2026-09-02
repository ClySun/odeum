/* =========================================================
   Summertime in Prague — beta signups (front-end)
   ========================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     CONFIG
     --------------------------------------------------------- */

  // Google Apps Script Web-app URL (writes to the Prague signups Google Sheet).
  var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyR83a0vBQlhoPWsqm3IjfMQJZsTU-p0B9q7x8SYYPAZ-6oMvO_UjB0qnxVjfTlwMgm/exec";

  // The six PLAYER characters, ordered so couples sit together.
  // (Jana & Pavel are DM characters, not player-filled.)
  var CHARACTERS = [
    { id: "eva",    name: "Eva",    art: "../images/prague/cast/eva.jpg",    tagline: "Writes art and culture critiques. Speaks three languages. An exemplary human being." },
    { id: "vaclav", name: "Vaclav", art: "../images/prague/cast/vaclav.jpg", tagline: "Writes poetry. Full of charm. The world is a bit dreamier in his eyes." },
    { id: "milan",  name: "Milan",  art: "../images/prague/cast/milan.jpg",  tagline: "Writes absurdist stories. Loves wandering around cemeteries at the outskirts of the city." },
    { id: "vera",   name: "Vera",   art: "../images/prague/cast/vera.jpg",   tagline: "Writes about Prague’s rock music scene. A drummer. Might seem hard to approach at first." },
    { id: "tomas",  name: "Tomas",  art: "../images/prague/cast/tomas.jpg",  tagline: "Manages the academic analysis section. A literature teacher who inspires his students by sneaking them copies of banned books." },
    { id: "petra",  name: "Petra",  art: "../images/prague/cast/petra.jpg",  tagline: "Manages the theatre section. Director of her own theatre. Lovingly described by her troupe as “small but mighty.”" }
  ];

  // Romantic pairings — couples sit together in the strip, joined by a labelled line.
  var PAIRS = [
    { ids: ["eva", "vaclav"], status: "Married" },
    { ids: ["milan", "vera"],  status: "Dating" },
    { ids: ["tomas", "petra"], status: "Married with kids" }
  ];

  // Upcoming sessions.  TODO: confirm final location wording.
  // NOTE: `id` is a STABLE date key (used in the sheet's SlotID). Never reuse or renumber it —
  // when a date passes, just delete that entry; add new ones with their own date id.
  var SESSIONS = [
    { id: "2026-09-26", date: "Saturday 26 September 2026", time: "6:00–11:00 PM", place: "Upper West Side" },
    { id: "2026-09-27", date: "Sunday 27 September 2026",   time: "6:00–11:00 PM", place: "Upper West Side" },
    { id: "2026-10-17", date: "Saturday 17 October 2026",   time: "6:00–11:00 PM", place: "Upper West Side" }
  ];

  /* ---------------------------------------------------------
     STATE + ELEMENTS
     --------------------------------------------------------- */
  var statusMap = {}; // slotId -> "Pending" | "Confirmed" | ...
  var selected = null;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var castGrid = document.getElementById("castGrid");
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

  /* ---------------------------------------------------------
     RENDER: cast gallery
     --------------------------------------------------------- */
  function charById(id) {
    for (var i = 0; i < CHARACTERS.length; i++) { if (CHARACTERS[i].id === id) return CHARACTERS[i]; }
    return null;
  }

  function renderCast() {
    if (!castGrid) return;
    castGrid.innerHTML = "";
    PAIRS.forEach(function (p) {
      var pair = document.createElement("div");
      pair.className = "castpair";
      var row = document.createElement("div");
      row.className = "castpair__row";
      p.ids.forEach(function (id) {
        var c = charById(id); if (!c) return;
        var card = document.createElement("article");
        card.className = "castcard";
        card.innerHTML =
          '<div class="castcard__art"><img src="' + c.art + '" alt="Character portrait of ' + c.name + '" loading="lazy" /></div>' +
          '<h3 class="castcard__name">' + c.name + "</h3>" +
          '<p class="castcard__line">' + c.tagline + "</p>";
        row.appendChild(card);
      });
      pair.appendChild(row);
      var bond = document.createElement("div");
      bond.className = "castpair__bond";
      bond.innerHTML = '<span class="castpair__label"><span class="castpair__heart">♥</span> ' + p.status + "</span>";
      pair.appendChild(bond);
      castGrid.appendChild(pair);
    });
  }

  function setupCastStrip() {
    var grid = castGrid;
    var prev = document.getElementById("castPrev");
    var next = document.getElementById("castNext");
    if (!grid || !prev || !next) return;
    var step = function () {
      var pair = grid.querySelector(".castpair");
      var w = pair ? pair.getBoundingClientRect().width : 400;
      return Math.round(w + 40);
    };
    var update = function () {
      prev.disabled = grid.scrollLeft <= 2;
      next.disabled = grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 2;
    };
    prev.addEventListener("click", function () { grid.scrollBy({ left: -step(), behavior: "smooth" }); });
    next.addEventListener("click", function () { grid.scrollBy({ left: step(), behavior: "smooth" }); });
    grid.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ---------------------------------------------------------
     RENDER: sessions + slots
     --------------------------------------------------------- */
  function render() {
    sessionsEl.innerHTML = "";
    SESSIONS.forEach(function (s) {
      var openCount = CHARACTERS.filter(function (c) { return stateOf(slotId(s, c)) === "open"; }).length;

      var card = document.createElement("div");
      card.className = "session";

      var head = document.createElement("div");
      head.className = "session__head";
      head.innerHTML =
        '<div><div class="session__date">' + s.date + "</div>" +
        '<div class="session__meta">' + s.time + " · " + s.place + "</div></div>" +
        '<div class="session__count">' + openCount + " of " + CHARACTERS.length + " seats open</div>";
      card.appendChild(head);

      var slots = document.createElement("div");
      slots.className = "slots";
      CHARACTERS.forEach(function (c) {
        var st = stateOf(slotId(s, c)); // open | pending | taken
        var slot = document.createElement("div");
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

  /* ---------------------------------------------------------
     AVAILABILITY
     --------------------------------------------------------- */
  function loadAvailability() {
    if (!SCRIPT_URL) { render(); return; } // preview mode
    fetch(SCRIPT_URL)
      .then(function (r) { return r.json(); })
      .then(function (d) { statusMap = (d && d.slots) || {}; render(); })
      .catch(function () { render(); });
  }

  /* ---------------------------------------------------------
     MODAL
     --------------------------------------------------------- */
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

  /* ---------------------------------------------------------
     SUBMIT (request)
     --------------------------------------------------------- */
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

    if (!SCRIPT_URL) { showDone(name, true); return; } // preview mode

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
          render();
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
      msg.textContent = "Thanks, " + first + " — this is a preview, so nothing was recorded yet. " +
        "Once the sheet is connected, this sends your request for real.";
    } else {
      msg.textContent = "Thanks, " + first + ". Your seat is being held pending confirmation. " +
        "We'll confirm by email and send more details soon.";
    }
  }

  /* ---------------------------------------------------------
     REVEALS + INIT
     --------------------------------------------------------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  renderCast();
  setupCastStrip();
  loadAvailability();
})();

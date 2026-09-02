/* =========================================================
   Summertime in Prague — beta signups (front-end)
   ========================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     CONFIG
     --------------------------------------------------------- */

  // Paste the Google Apps Script Web-app URL here once deployed (see signups-backend/SETUP.md).
  // While empty, the page runs in PREVIEW mode: nothing is recorded.
  var SCRIPT_URL = "";

  // The six PLAYER characters. (Jana & Pavel are DM characters, not player-filled.)
  // TODO: taglines are placeholders — replace with the real one-liners.
  var CHARACTERS = [
    { id: "vera",   name: "Vera",   art: "../images/prague/cast/vera.jpg",   tagline: "The drummer — her band keeps landing on the wrong lists." },
    { id: "milan",  name: "Milan",  art: "../images/prague/cast/milan.jpg",  tagline: "The firebrand writer: long on conviction, short on caution." },
    { id: "vaclav", name: "Vaclav", art: "../images/prague/cast/vaclav.jpg", tagline: "The steady hand who has seen which way these things go." },
    { id: "eva",    name: "Eva",    art: "../images/prague/cast/eva.jpg",    tagline: "She knows everyone — and what they'd rather keep hidden." },
    { id: "petra",  name: "Petra",  art: "../images/prague/cast/petra.jpg",  tagline: "New to the magazine, and watching everything." },
    { id: "tomas",  name: "Tomas",  art: "../images/prague/cast/tomas.jpg",  tagline: "Loyal to the work — but to whom, exactly?" }
  ];

  // Upcoming sessions.  TODO: confirm final location wording.
  var SESSIONS = [
    { id: "s1", date: "Saturday 26 September 2026", time: "6:00–11:00 PM", place: "Location shared on confirmation" },
    { id: "s2", date: "Sunday 27 September 2026",   time: "6:00–11:00 PM", place: "Location shared on confirmation" },
    { id: "s3", date: "Saturday 17 October 2026",   time: "6:00–11:00 PM", place: "Location shared on confirmation" }
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
  function renderCast() {
    if (!castGrid) return;
    castGrid.innerHTML = "";
    CHARACTERS.forEach(function (c) {
      var card = document.createElement("article");
      card.className = "castcard reveal is-in";
      card.innerHTML =
        '<div class="castcard__art"><img src="' + c.art + '" alt="Character portrait of ' + c.name + '" loading="lazy" /></div>' +
        '<h3 class="castcard__name">' + c.name + "</h3>" +
        '<p class="castcard__line">' + c.tagline + "</p>";
      castGrid.appendChild(card);
    });
  }

  function setupCastStrip() {
    var grid = castGrid;
    var prev = document.getElementById("castPrev");
    var next = document.getElementById("castNext");
    if (!grid || !prev || !next) return;
    var step = function () {
      var card = grid.querySelector(".castcard");
      var w = card ? card.getBoundingClientRect().width : 240;
      return Math.round((w + 20) * 1.5);
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
        modalStatus.textContent = "Something went wrong — please try again, or email hello@odeum.theatre.";
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
      msg.textContent = "Thanks, " + first + " — your seat is held as pending. We'll confirm by email, " +
        "then send your character dossier and the address.";
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

/* =========================================================
   Summertime in Prague — beta signups (front-end)
   ========================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     CONFIG
     --------------------------------------------------------- */

  // Paste the Google Apps Script Web-app URL here once deployed (see signups-backend/SETUP.md).
  // While this is empty, the page runs in PREVIEW mode: nothing is recorded.
  var SCRIPT_URL = "";

  // The six characters. (Surnames for Tomáš / Jana / Petra to be confirmed.)
  var CHARACTERS = [
    { id: "milan", name: "Milan Novak" },
    { id: "vera",  name: "Vera Veselá" },
    { id: "eva",   name: "Eva Maršová" },
    { id: "tomas", name: "Tomáš" },
    { id: "jana",  name: "Jana" },
    { id: "petra", name: "Petra" }
  ];

  // Upcoming sessions. PLACEHOLDER DATES — replace with the real schedule.
  var SESSIONS = [
    { id: "s1", date: "Friday 25 September 2026",   time: "7:00 PM", place: "Downtown loft · address on confirmation" },
    { id: "s2", date: "Saturday 26 September 2026", time: "7:00 PM", place: "Downtown loft · address on confirmation" }
  ];

  /* ---------------------------------------------------------
     STATE + ELEMENTS
     --------------------------------------------------------- */
  var taken = new Set();
  var selected = null; // { session, character }
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  /* ---------------------------------------------------------
     RENDER
     --------------------------------------------------------- */
  function render() {
    sessionsEl.innerHTML = "";
    SESSIONS.forEach(function (s) {
      var openCount = CHARACTERS.filter(function (c) { return !taken.has(slotId(s, c)); }).length;

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
        var isTaken = taken.has(slotId(s, c));
        var slot = document.createElement("div");
        slot.className = "slot " + (isTaken ? "slot--taken" : "slot--open");
        slot.innerHTML =
          '<div class="slot__name">' + c.name + "</div>" +
          '<div class="slot__row">' +
            '<span class="slot__state">' + (isTaken ? "Taken" : "Open") + "</span>" +
            (isTaken
              ? '<button class="slot__btn" disabled>Taken</button>'
              : '<button class="slot__btn" type="button">Choose →</button>') +
          "</div>";
        if (!isTaken) {
          slot.querySelector(".slot__btn").addEventListener("click", function () {
            openModal(s, c);
          });
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
      .then(function (d) {
        taken = new Set((d && d.taken) || []);
        render();
      })
      .catch(function () {
        // If we can't reach the sheet, still show the slots (fail open, but warn on submit).
        render();
      });
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
    submitBtn.textContent = "Confirm my seat";
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

  modal.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-close")) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
  });

  /* ---------------------------------------------------------
     SUBMIT
     --------------------------------------------------------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selected) return;

    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var phone = form.phone.value.trim();
    var rec = form.recommendedBy.value.trim();

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone) {
      modalStatus.textContent = "Please add your name, a valid email, and a phone number.";
      return;
    }

    var s = selected.session, c = selected.character;

    // Preview mode (no backend connected yet)
    if (!SCRIPT_URL) {
      showDone(name, true);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Reserving…";
    modalStatus.textContent = "";

    var body = new URLSearchParams({
      slotId: slotId(s, c),
      session: s.date + " · " + s.time,
      character: c.name,
      name: name, email: email, phone: phone, recommendedBy: rec
    });

    fetch(SCRIPT_URL, { method: "POST", body: body })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          taken.add(slotId(s, c));
          showDone(name, false);
          loadAvailability();
        } else if (res && res.error === "taken") {
          modalStatus.textContent = "Ah — that seat was just taken. Please choose another.";
          submitBtn.disabled = false;
          submitBtn.textContent = "Confirm my seat";
          taken.add(slotId(s, c));
          render();
        } else {
          throw new Error("server");
        }
      })
      .catch(function () {
        modalStatus.textContent = "Something went wrong — please try again, or email hello@odeum.theatre.";
        submitBtn.disabled = false;
        submitBtn.textContent = "Confirm my seat";
      });
  });

  function showDone(name, preview) {
    modalForm.hidden = true;
    modalDone.hidden = false;
    var msg = document.getElementById("doneMsg");
    var first = name.split(" ")[0];
    if (preview) {
      msg.textContent = "Thanks, " + first + " — this is a preview, so nothing was recorded yet. " +
        "Once the sheet is connected, this reserves your seat for real.";
    } else {
      msg.textContent = "Your seat is reserved, " + first + ". We'll email you your character dossier " +
        "and the address before the night.";
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

  loadAvailability();
})();

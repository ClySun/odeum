/* =========================================================
   Summertime in Prague — character-fit quiz (front-end)

   Five questions → a fit score for each of the six player
   characters → the player's strongest matches, filtered by
   their character preference.

   Scoring (per the design):
     - Everyone starts at 50% with every character.
     - Q1–Q4 each measure a Big-Five-ish trait and are worth a
       fixed number of points. We compare the player's level
       (High=2 / Medium=1 / Low=0) with the character's target
       level and multiply the weight:
          exact match      ×  1.0
          one level apart   ×  0.4
          opposite ends     × -0.3
     - Q5 (writer instinct) gives bonus points from a per-character
       table (+10 ideal, +6 / +3 secondary; anything else 0).
     - Fit = 50 + Q1 + Q2 + Q3 + Q4 + Q5, rounded, then the DISPLAY
       score is clamped to 40–100.
   Character preference is kept completely separate from scoring:
   we score all six, then only show the ones that match the
   preference.
   ========================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     CONFIG — same Apps Script web app as the signup page.
     --------------------------------------------------------- */
  var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyR83a0vBQlhoPWsqm3IjfMQJZsTU-p0B9q7x8SYYPAZ-6oMvO_UjB0qnxVjfTlwMgm/exec";

  /* ---------------------------------------------------------
     DATA
     Trait keys: C = Conscientiousness, E = Extraversion,
     A = Agreeableness, S = Emotional Stability.
     q5 = Question-5 bonus table for this character.
     --------------------------------------------------------- */
  var CHARACTERS = [
    { id: "eva",    name: "Eva",    gender: "F", art: "../images/prague/cast/eva.jpg",
      tagline: "Writes art and culture critiques. Speaks three languages. Is there anything she can’t do?",
      traits: { C: 2, E: 0, A: 2, S: 0 }, q5: { E: 10, C: 6, A: 3 } },
    { id: "vaclav", name: "Vaclav", gender: "M", art: "../images/prague/cast/vaclav.jpg",
      tagline: "Writes poetry. Full of charm. The world is a bit dreamier in his eyes.",
      traits: { C: 1, E: 2, A: 2, S: 2 }, q5: { A: 10, F: 6, B: 3 } },
    { id: "tomas",  name: "Tomas",  gender: "M", art: "../images/prague/cast/tomas.jpg",
      tagline: "Manages the academic analysis section. A literature teacher who inspires his students by sneaking them copies of banned books.",
      traits: { C: 2, E: 1, A: 1, S: 2 }, q5: { C: 10, E: 6, A: 3 } },
    { id: "petra",  name: "Petra",  gender: "F", art: "../images/prague/cast/petra.jpg",
      tagline: "Manages the theatre section. Director of her own theatre. Lovingly described by her troupe as “small but mighty.”",
      traits: { C: 1, E: 2, A: 2, S: 1 }, q5: { F: 10, A: 6, C: 3 } },
    { id: "milan",  name: "Milan",  gender: "M", art: "../images/prague/cast/milan.jpg",
      tagline: "Writes absurdist stories. Loves wandering around cemeteries at the outskirts of the city.",
      traits: { C: 0, E: 0, A: 0, S: 2 }, q5: { D: 10, E: 6, B: 3 } },
    { id: "vera",   name: "Vera",   gender: "F", art: "../images/prague/cast/vera.jpg",
      tagline: "Writes about Prague’s rock music scene. A drummer. Might seem hard to approach at first.",
      traits: { C: 0, E: 1, A: 0, S: 1 }, q5: { B: 10, D: 6, F: 3 } }
  ];

  // Q1–Q4 options carry a `level` (High 2 / Medium 1 / Low 0).
  // Q5 options are letters only; scoring uses each character's q5 table.
  var QUESTIONS = [
    { trait: "C", weight: 5,
      prompt: "The deadline for your article is tomorrow. What are you most likely doing tonight?",
      options: [
        { k: "A", level: 2, text: "The article is already finished. I’m probably still revising and polishing it until I’m satisfied." },
        { k: "B", level: 1, text: "I’m wrapping up the last few details. I know I’ll have it finished on time." },
        { k: "C", level: 0, text: "I’m still deep in the writing. I tend to work closer to the deadline, and the pressure helps me focus." }
      ] },
    { trait: "E", weight: 12,
      prompt: "A heated discussion breaks out in the editorial office about what the next issue should say. You’re most likely to…",
      options: [
        { k: "A", level: 2, text: "Jump in and help guide the conversation, keeping track of everyone’s ideas and the mood in the room." },
        { k: "B", level: 1, text: "Listen for a while, then speak when I have something I really want to add." },
        { k: "C", level: 0, text: "Mostly watch the room and see where the conversation is going before deciding whether to contribute." }
      ] },
    { trait: "A", weight: 13,
      prompt: "A colleague shows you an article you think is badly argued, but they clearly care about it. What do you do?",
      options: [
        { k: "A", level: 2, text: "Start with what works. I want them to feel that I appreciate the effort they put into it before I gently suggest changes." },
        { k: "B", level: 1, text: "Give constructive feedback to help make the article stronger, while paying attention to how they’re reacting and adjusting how much I say." },
        { k: "C", level: 0, text: "Tell them clearly where I think the argument fails. If something isn’t working, I think an honest opinion is the most helpful." }
      ] },
    { trait: "S", weight: 10,
      prompt: "Something you published has upset someone powerful. That evening, you…",
      options: [
        { k: "A", level: 2, text: "Carry on with your evening. There’s nothing useful to do unless something actually happens." },
        { k: "B", level: 1, text: "Feel nervous or unsettled, but try to distract yourself with whatever needs your attention." },
        { k: "C", level: 0, text: "Keep replaying the article and imagining every possible consequence." }
      ] },
    { trait: "Q5", weight: 10,
      prompt: "The chief editor asks everyone to propose a piece for the next issue. What feels most natural?",
      options: [
        { k: "A", text: "Pitch something hopeful or uplifting that could give people a sense of possibility." },
        { k: "B", text: "Make a strong argument about something you care about and push people to engage with it." },
        { k: "C", text: "Develop an idea you’ve already been thinking about and work out how to make it stronger." },
        { k: "D", text: "Write about the subject everyone else seems reluctant to touch." },
        { k: "E", text: "Work quietly on something personal and only bring it forward once it feels ready." },
        { k: "F", text: "Chase a new idea that feels fresh, exciting, and full of possibilities." }
      ] }
  ];

  /* ---------------------------------------------------------
     SCORING
     --------------------------------------------------------- */
  function multiplier(diff) {
    if (diff === 0) return 1.0;   // exact match
    if (diff === 1) return 0.4;   // one level apart
    return -0.3;                  // opposite ends
  }

  // answers: array of the chosen option objects, in question order.
  function scoreAll(answers) {
    return CHARACTERS.map(function (c) {
      var fit = 50;
      for (var i = 0; i < 4; i++) {
        var q = QUESTIONS[i];
        var diff = Math.abs(answers[i].level - c.traits[q.trait]);
        fit += q.weight * multiplier(diff);
      }
      var q5key = answers[4].k;
      fit += (c.q5[q5key] || 0);
      var raw = Math.round(fit);
      return { char: c, raw: raw, display: Math.min(100, Math.max(40, raw)) };
    });
  }

  function computeResults(answers, pref) {
    var all = scoreAll(answers);
    var shown = all.filter(function (r) {
      if (pref === "any") return true;
      return r.char.gender === (pref === "female" ? "F" : "M");
    });
    shown.sort(function (a, b) {
      return (b.display - a.display) || a.char.name.localeCompare(b.char.name);
    });
    return { all: all, shown: shown.slice(0, 3) };
  }

  /* ---------------------------------------------------------
     STATE + ELEMENTS
     --------------------------------------------------------- */
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var player = { name: "", email: "", pref: "" };
  var answers = [];      // chosen option object per question
  var current = 0;       // index into QUESTIONS
  var submitted = false; // guard against double-posting

  var el = function (id) { return document.getElementById(id); };
  var stepIntro = el("stepIntro"), stepPref = el("stepPref"), stepQuiz = el("stepQuiz"), stepResult = el("stepResult");
  var introForm = el("introForm"), introStatus = el("introStatus");
  var prefOptions = el("prefOptions"), prefBack = el("prefBack"), prefNext = el("prefNext");
  var qCount = el("qCount"), qBarFill = el("qBarFill"), qPrompt = el("qPrompt"),
      qOptions = el("qOptions"), qBack = el("qBack"), qNext = el("qNext");

  function show(step) {
    [stepIntro, stepPref, stepQuiz, stepResult].forEach(function (s) { s.hidden = (s !== step); });
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* ---------------------------------------------------------
     INTRO
     --------------------------------------------------------- */
  introForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = introForm.name.value.trim();
    var email = introForm.email.value.trim();
    if (!name) { introStatus.textContent = "Please add your name."; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      introStatus.textContent = "Please add a valid email."; return;
    }
    introStatus.textContent = "";
    player.name = name;
    player.email = email;
    show(stepPref);
  });

  /* ---------------------------------------------------------
     PREFERENCE (its own screen — kept separate from scoring)
     --------------------------------------------------------- */
  Array.prototype.forEach.call(prefOptions.querySelectorAll(".qpref"), function (btn) {
    btn.addEventListener("click", function () {
      player.pref = btn.getAttribute("data-pref");
      Array.prototype.forEach.call(prefOptions.querySelectorAll(".qpref"), function (b) {
        var on = (b === btn);
        b.classList.toggle("is-picked", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      prefNext.disabled = false;
    });
  });

  prefBack.addEventListener("click", function () { show(stepIntro); });

  prefNext.addEventListener("click", function () {
    if (!player.pref) return;
    answers = [];
    current = 0;
    submitted = false;
    show(stepQuiz);
    renderQuestion();
  });

  /* ---------------------------------------------------------
     QUESTIONS
     --------------------------------------------------------- */
  function renderQuestion() {
    var q = QUESTIONS[current];
    qCount.textContent = pad(current + 1) + " — " + pad(QUESTIONS.length);
    qBarFill.style.width = ((current) / QUESTIONS.length * 100) + "%";
    qPrompt.textContent = q.prompt;

    qOptions.innerHTML = "";
    var chosen = answers[current];
    q.options.forEach(function (opt) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "qopt" + (chosen && chosen.k === opt.k ? " is-picked" : "");
      b.innerHTML =
        '<span class="qopt__key">' + opt.k + '</span>' +
        '<span class="qopt__text">' + opt.text + '</span>';
      b.addEventListener("click", function () {
        answers[current] = opt;
        Array.prototype.forEach.call(qOptions.children, function (c) { c.classList.remove("is-picked"); });
        b.classList.add("is-picked");
        qNext.disabled = false;
      });
      qOptions.appendChild(b);
    });

    qBack.style.visibility = current === 0 ? "hidden" : "visible";
    qNext.disabled = !answers[current];
    qNext.textContent = (current === QUESTIONS.length - 1) ? "See my matches" : "Continue";
  }

  qNext.addEventListener("click", function () {
    if (!answers[current]) return;
    if (current < QUESTIONS.length - 1) {
      current++;
      renderQuestion();
    } else {
      finish();
    }
  });

  qBack.addEventListener("click", function () {
    if (current > 0) { current--; renderQuestion(); }
    else { show(stepPref); }
  });

  /* ---------------------------------------------------------
     RESULT
     --------------------------------------------------------- */
  function finish() {
    var res = computeResults(answers, player.pref);
    renderResult(res);
    show(stepResult);
    submitResult(res);
  }

  function renderResult(res) {
    var first = player.name.split(" ")[0];
    el("resultTitle").textContent = first + ", here are your strongest matches";

    var wrap = el("qMatches");
    wrap.innerHTML = "";
    res.shown.forEach(function (r, i) {
      var card = document.createElement("article");
      card.className = "qmatch" + (i === 0 ? " qmatch--top" : "");
      card.innerHTML =
        '<div class="qmatch__art"><img src="' + r.char.art + '" alt="Portrait of ' + r.char.name + '" loading="lazy" /></div>' +
        '<div class="qmatch__body">' +
          '<div class="qmatch__head">' +
            '<h3 class="qmatch__name">' + r.char.name + '</h3>' +
            '<span class="qmatch__pct">' + r.display + '%</span>' +
          '</div>' +
          '<div class="qmatch__meter"><span style="width:' + r.display + '%"></span></div>' +
          '<p class="qmatch__line">' + r.char.tagline + '</p>' +
        '</div>';
      wrap.appendChild(card);
    });

    el("resultNote").textContent =
      "Please take a screenshot of your results to remember them!";
  }

  /* ---------------------------------------------------------
     SAVE TO SHEET (Apps Script, action=quiz)
     Never blocks the player from seeing their matches.
     --------------------------------------------------------- */
  function submitResult(res) {
    if (!SCRIPT_URL || submitted) return;
    submitted = true;

    var shown = res.shown;
    var byId = {};
    res.all.forEach(function (r) { byId[r.char.id] = r.display; });
    var answerStr = answers.map(function (a, i) { return (i + 1) + a.k; }).join(" "); // e.g. "1A 2C 3A 4C 5E"

    var body = new URLSearchParams({
      action: "quiz",
      name: player.name,
      email: player.email,
      preference: player.pref,
      top1: shown[0] ? shown[0].char.name : "",
      top1pct: shown[0] ? String(shown[0].display) : "",
      top2: shown[1] ? shown[1].char.name : "",
      top2pct: shown[1] ? String(shown[1].display) : "",
      top3: shown[2] ? shown[2].char.name : "",
      top3pct: shown[2] ? String(shown[2].display) : "",
      scoreEva: String(byId.eva), scoreVaclav: String(byId.vaclav),
      scoreTomas: String(byId.tomas), scorePetra: String(byId.petra),
      scoreMilan: String(byId.milan), scoreVera: String(byId.vera),
      answers: answerStr
    });

    fetch(SCRIPT_URL, { method: "POST", body: body }).catch(function () { /* silent — results already shown */ });
  }

  // Retake: keep the same name / email / preference and go straight back to
  // question one. The new result overwrites this person's row in the sheet
  // (matched by email) rather than adding a second row.
  el("qRetake").addEventListener("click", function () {
    answers = [];
    current = 0;
    submitted = false;
    show(stepQuiz);
    renderQuestion();
  });

})();

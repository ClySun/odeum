/* =========================================================
   Odeum homepage — rotating testimonials.
   One full quote at a time. Longer quotes get a smaller text size so
   nothing clips (band height is fixed). Auto-rotates, pauses on hover,
   and can be stepped with the prev/next arrows or the dots.
   ========================================================= */
(function () {
  "use strict";
  var viewport = document.getElementById("quotesViewport");
  if (!viewport) return;
  var items = Array.prototype.slice.call(viewport.querySelectorAll(".quotes__item"));
  var n = items.length;
  if (!n) return;

  var prevBtn = document.getElementById("quotesPrev");
  var nextBtn = document.getElementById("quotesNext");
  var dotsWrap = document.getElementById("quotesDots");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var INTERVAL = 5500;
  var OFFSET = 45; // px slide distance
  var cur = 0;
  var timer = null;

  // Size each quote by length so long ones shrink to fit the fixed band.
  items.forEach(function (item) {
    var len = (item.querySelector(".quotes__text").textContent || "").length;
    if (len > 85) item.classList.add("q-sm");
    else if (len > 45) item.classList.add("q-md");
  });

  // Dots
  var dots = [];
  if (dotsWrap) {
    for (var i = 0; i < n; i++) {
      var d = document.createElement("button");
      d.className = "quotes__dot";
      d.type = "button";
      d.setAttribute("aria-label", "Show quote " + (i + 1));
      (function (idx) { d.addEventListener("click", function () { goTo(idx, true); }); })(i);
      dotsWrap.appendChild(d);
      dots.push(d);
    }
  }

  function place(item, x, o) {
    item.style.transform = reduce ? "none" : ("translateX(" + x + "px)");
    item.style.opacity = String(o);
  }

  function setDots() {
    dots.forEach(function (d, i) { d.classList.toggle("is-on", i === cur); });
  }

  // init
  items.forEach(function (item, i) {
    if (i === cur) { place(item, 0, 1); }
    else { place(item, OFFSET, 0); }
  });
  setDots();

  function goTo(target, manual) {
    target = (target % n + n) % n;
    if (target === cur) return;
    var dir = target > cur ? 1 : -1;
    var outgoing = items[cur];
    var incoming = items[target];
    var fromX = dir > 0 ? OFFSET : -OFFSET;   // next enters from right, prev from left
    var toX = dir > 0 ? -OFFSET : OFFSET;      // outgoing exits the opposite side

    // park incoming at its start side without animating
    incoming.style.transition = "none";
    place(incoming, fromX, 0);
    void incoming.offsetWidth;
    incoming.style.transition = "";

    place(outgoing, toX, 0);
    place(incoming, 0, 1);
    cur = target;
    setDots();
    if (manual) restart();
  }

  function next(manual) { goTo(cur + 1, manual); }
  function prev(manual) { goTo(cur - 1, manual); }

  function start() { stop(); timer = setInterval(function () { next(false); }, INTERVAL); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function restart() { start(); }

  if (nextBtn) nextBtn.addEventListener("click", function () { next(true); });
  if (prevBtn) prevBtn.addEventListener("click", function () { prev(true); });
  viewport.addEventListener("mouseenter", stop);
  viewport.addEventListener("mouseleave", start);
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });

  start();
})();

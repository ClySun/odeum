/* =========================================================
   Odeum homepage — "How the game works" pinned scroll.
   The .flow__sticky panel holds in the viewport while the page scrolls
   through .flow__scroller. Photos cross-fade CONTINUOUSLY with scroll,
   and a vertical timeline line fills down to the active dot.
   ========================================================= */
(function () {
  "use strict";
  var scroller = document.getElementById("flowScroller");
  if (!scroller) return;

  var photos = scroller.querySelectorAll(".flow__photo");
  var ticks = scroller.querySelectorAll(".flow__tick");
  var caps = scroller.querySelectorAll(".flow__cap");
  var dots = scroller.querySelectorAll(".flow__dot");
  var timeline = document.getElementById("flowTimeline");
  var spine = timeline ? timeline.querySelector(".flow__spine") : null;
  var fill = document.getElementById("flowFill");
  var n = caps.length;
  if (!n) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var lastActive = -1;
  var firstC = 0, span = 0;
  var offsets = [];   // each dot's centre, measured from the fill origin (first dot)

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // Measure the dot centres so the spine runs exactly dot-to-dot.
  function measure() {
    if (!spine || !dots.length) return;
    var tlTop = timeline.getBoundingClientRect().top;
    var d0 = dots[0].getBoundingClientRect();
    var dN = dots[dots.length - 1].getBoundingClientRect();
    firstC = (d0.top - tlTop) + d0.height / 2;
    var lastC = (dN.top - tlTop) + dN.height / 2;
    span = lastC - firstC;
    spine.style.top = firstC + "px";
    spine.style.height = span + "px";
    offsets = [];
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i].getBoundingClientRect();
      offsets.push((d.top - tlTop) + d.height / 2 - firstC);
    }
  }

  function render() {
    var rect = scroller.getBoundingClientRect();
    var total = scroller.offsetHeight - window.innerHeight;
    var p = total > 0 ? clamp(-rect.top / total, 0, 1) : 0;
    var sf = p * (n - 1);
    var fillH = p * span;

    // continuous photo cross-fade
    for (var k = 0; k < n; k++) {
      photos[k].style.opacity = reduce ? (k === Math.round(sf) ? "1" : "0")
                                       : (1 - Math.min(1, Math.abs(sf - k))).toFixed(3);
    }

    // timeline line fills down; each dot lights the moment the line reaches it
    if (fill) fill.style.height = fillH + "px";
    var active = Math.round(sf);
    for (var i = 0; i < n; i++) {
      var reached = offsets.length ? (fillH >= offsets[i] - 1) : (i <= active);
      ticks[i].classList.toggle("is-filled", reached);
    }
    if (active !== lastActive) {
      lastActive = active;
      for (var j = 0; j < n; j++) {
        ticks[j].classList.toggle("is-active", j === active);
        caps[j].classList.toggle("is-active", j === active);
      }
    }
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () { render(); ticking = false; });
  }
  function onResize() { measure(); onScroll(); }

  // init
  for (var k = 0; k < n; k++) photos[k].style.opacity = (k === 0 ? "1" : "0");
  ticks[0].classList.add("is-active");
  caps[0].classList.add("is-active");
  measure();
  render();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  // re-measure once images/fonts settle
  window.addEventListener("load", onResize);
  setTimeout(onResize, 600);
})();

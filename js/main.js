/* =========================================================
   ODEUM — interactions (editorial, restrained)
   ========================================================= */
(function () {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Nav: blend over hero, solid after ---- */
  const nav = document.getElementById("nav");
  const hero = document.getElementById("hero");
  const setNav = () => {
    const past = window.scrollY > (hero ? hero.offsetHeight - 90 : 200);
    if (nav) nav.classList.toggle("is-solid", past);
  };
  setNav();
  window.addEventListener("scroll", setNav, { passive: true });

  /* ---- Overlay menu ---- */
  const menuBtn = document.getElementById("menuBtn");
  const overlay = document.getElementById("overlay");
  const toggleMenu = (open) => {
    const willOpen = open ?? !document.body.classList.contains("menu-open");
    document.body.classList.toggle("menu-open", willOpen);
    document.body.classList.toggle("no-scroll", willOpen);
    if (menuBtn) menuBtn.setAttribute("aria-expanded", String(willOpen));
    if (overlay) overlay.setAttribute("aria-hidden", String(!willOpen));
  };
  if (menuBtn) menuBtn.addEventListener("click", () => toggleMenu());
  if (overlay) overlay.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => toggleMenu(false)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleMenu(false); });

  /* ---- Reveal on scroll ---- */
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add("is-in"); io.unobserve(entry.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-in"));
  }

  /* ---- Feature video: always muted, loads only when near the viewport ---- */
  const video = document.querySelector("video.feature__img");
  if (video) {
    video.muted = true;
    const load = () => {
      if (!video.src) video.src = video.dataset.src;
      if (!reduce) video.play().catch(() => {});
    };
    if ("IntersectionObserver" in window) {
      const vio = new IntersectionObserver((entries) => {
        entries.forEach((e) => (e.isIntersecting ? load() : video.pause()));
      }, { rootMargin: "300px 0px" });
      vio.observe(video);
    } else {
      load();
    }
  }

  /* ---- Subtle parallax on the full-bleed feature image ---- */
  const feature = document.querySelector(".feature__img");
  if (feature && !reduce) {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const rect = feature.getBoundingClientRect();
        const vh = window.innerHeight;
        if (rect.bottom > 0 && rect.top < vh) {
          const progress = (rect.top + rect.height / 2 - vh / 2) / vh; // -0.5..0.5-ish
          feature.style.transform = `translateY(${(-progress * 40).toFixed(1)}px)`;
        }
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Elegant exit to a game page where cross-page view transitions aren't supported ---- */
  if (!("onpagereveal" in window) && !reduce) {
    document.querySelectorAll("a.row--link").forEach((a) => {
      a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        document.body.classList.add("is-leaving");
        setTimeout(() => { location.href = a.href; }, 480);
      });
    });
    // Coming back via the browser's back button restores the cached page — undo the fade.
    window.addEventListener("pageshow", () => document.body.classList.remove("is-leaving"));
  }

  /* ---- Invitation form (front-end only, no backend wired yet) ---- */
  const form = document.getElementById("inviteForm");
  const status = document.getElementById("inviteStatus");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      const email = form.email.value.trim();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        status.textContent = "Please add your name and a valid email.";
        return;
      }
      status.textContent = "Thank you, " + name.split(" ")[0] + " — your questions are on their way.";
      form.reset();
    });
  }

  /* ---- Footer year ---- */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();

/*!
 * landing-forge runtime: smooth scroll, reveals, pinned manifesto, widgets, ribbon background.
 * Needs gsap + ScrollTrigger + Lenis (loaded before) and Ribbon (ribbon.js).
 * Degrades gracefully: without GSAP the CSS failsafe shows everything; without WebGL a gradient replaces the ribbon.
 */
(function () {
  "use strict";

  var root = document.body;
  var dataEl = document.getElementById("lf-data");
  var DATA = dataEl ? JSON.parse(dataEl.textContent) : { scenes: {}, colors: [], bg: [0, 0, 0] };
  var FX = DATA.effects || {};
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var still = reduced || FX.reveal === false;
  var mobile = window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  /* ── nav state ── */
  var nav = $(".nav");
  function onScroll() { if (nav) nav.dataset.scrolled = window.scrollY > 24 ? "1" : ""; }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ── cursor ring ── */
  var cursor = $(".cursor");
  if (cursor && FX.cursor !== false && !window.matchMedia("(pointer: coarse)").matches) {
    var cx = -100, cy = -100, tx = -100, ty = -100;
    window.addEventListener("pointermove", function (e) {
      tx = e.clientX; ty = e.clientY;
      root.dataset.cursor = "1";
      cursor.dataset.hot = e.target.closest && e.target.closest("a, button, summary") ? "1" : "";
    }, { passive: true });
    (function loop() {
      cx += (tx - cx) * 0.22; cy += (ty - cy) * 0.22;
      cursor.style.transform = "translate3d(" + cx + "px," + cy + "px,0)";
      requestAnimationFrame(loop);
    })();
  }

  /* ── scan widget: cells light up one by one, then findings appear, then loop ── */
  $$("[data-scan]").forEach(function (w) {
    var cells = $$(".cell", w), finds = $$(".finding", w);
    var n = cells.length, total = n + finds.length + 6;
    var bar = $("[data-progress-bar]", w), pct = $("[data-progress-pct]", w), label = $("[data-progress-label]", w);
    var run = $("[data-run]", w), runText = $("[data-run-text]", w);
    var stepLabel = w.dataset.stepLabel || "{i} / {n}";
    function pad(x) { return (x < 10 ? "0" : "") + x; }
    function show(step) {
      var scanned = Math.min(step, n), done = step >= n;
      cells.forEach(function (c, i) {
        if (i < scanned) c.dataset.on = "1"; else delete c.dataset.on;
        if (i === scanned && !done) c.dataset.active = "1"; else delete c.dataset.active;
      });
      finds.forEach(function (f, i) { if (step >= n + 1 + i) f.dataset.show = "1"; else delete f.dataset.show; });
      var p = Math.round(scanned / n * 100);
      if (bar) bar.style.width = p + "%";
      if (pct) pct.textContent = p + "%";
      if (label) label.textContent = done ? (w.dataset.doneLabel || "") : stepLabel.replace("{i}", pad(scanned + 1)).replace("{n}", pad(n));
      if (run) { if (done) run.dataset.done = "1"; else delete run.dataset.done; }
      if (runText) runText.textContent = done ? (w.dataset.doneRun || "") : (w.dataset.runLabel || "");
    }
    if (reduced) { show(total - 2); return; }
    var step = 0;
    show(0);
    setInterval(function () { step = step >= total ? 0 : step + 1; show(step); }, 620);
  });

  /* ── backgrounds: ribbon (WebGL), aurora, grid, plain ── */
  var ribbon = null;
  var bgKind = DATA.background || "ribbon";
  function startCssBackground() {
    var rs = document.documentElement.style;
    (DATA.hex || []).forEach(function (c, i) { rs.setProperty("--c" + i, c); });
    var ticking = false;
    function upd() {
      ticking = false;
      var max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      rs.setProperty("--sp", (window.scrollY / max).toFixed(4));
      rs.setProperty("--sy", String(Math.round(window.scrollY)));
    }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(upd); } }, { passive: true });
    upd();
    if (bgKind === "grid" && !mobile) {
      window.addEventListener("pointermove", function (e) {
        rs.setProperty("--mx", (e.clientX / window.innerWidth * 100).toFixed(1) + "%");
        rs.setProperty("--my", (e.clientY / window.innerHeight * 100).toFixed(1) + "%");
      }, { passive: true });
    }
  }
  function startRibbon() {
    if (bgKind !== "ribbon") { startCssBackground(); return; }
    var canvas = $("canvas.bg");
    if (!canvas || !window.Ribbon) { root.dataset.nogl = "1"; return; }
    var kf = $$("[data-scene]").map(function (el) {
      return { el: el, at: el.dataset.at ? Number(el.dataset.at) : 0.5, state: DATA.scenes[el.dataset.scene] };
    }).filter(function (k) { return k.state; });
    if (!kf.length) return;
    if (reduced && kf.length > 1) kf = [kf[0], { el: kf[1].el, at: kf[1].at, state: DATA.scenes.calm }];
    try {
      ribbon = window.Ribbon.create(canvas, {
        keyframes: kf, colors: DATA.colors, bg: DATA.bg, light: DATA.light, density: DATA.density,
        mobile: mobile, reducedMotion: reduced, onLost: function () { root.dataset.nogl = "1"; },
      });
    } catch (e) {
      root.dataset.nogl = "1";
    }
  }

  /* ── motion ── */
  function startMotion() {
    var gsap = window.gsap, ST = window.ScrollTrigger;
    if (!gsap || !ST) { root.dataset.ready = "1"; return; }
    gsap.registerPlugin(ST);

    var lenis = null;
    if (!reduced && FX.smooth !== false && window.Lenis) {
      lenis = new window.Lenis({ lerp: 0.1 });
      lenis.on("scroll", ST.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
    }

    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute("href");
      var target = id === "#top" || id === "#" ? root : $(id);
      if (!target) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(target === root ? 0 : target, { offset: -100, duration: 1.4 });
      else target.scrollIntoView();
    });

    root.dataset.ready = "1";

    if (still) {
      root.dataset.still = "1";
      $$("[data-inview]").forEach(function (n) { n.dataset.in = "1"; });
      return;
    }

    var hero = $("[data-hero]");
    if (hero) {
      var tl = gsap.timeline({ defaults: { ease: "power3.out" }, delay: 0.15 });
      if (nav) tl.from(nav, { opacity: 0, y: -12, duration: 0.8 });
      var b = $("[data-hero-badge]", hero);
      if (b) tl.from(b, { opacity: 0, y: 10, duration: 0.7 }, 0.1);
      tl.from($$("h1 [data-w]", hero), { opacity: 0, yPercent: 40, filter: "blur(12px)", duration: 1.1, stagger: 0.07 }, 0.2)
        .from($$("[data-hero-intro]", hero), { opacity: 0, y: 16, filter: "blur(6px)", duration: 0.9, stagger: 0.1 }, 0.55);
      var stage = $(".hero-stage", hero);
      if (stage) {
        tl.from($(".hero-card", stage), { opacity: 0, x: 80, rotateY: -38, filter: "blur(10px)", duration: 1.6, ease: "expo.out" }, 0.45);
        var card = $(".hero-card", stage);
        if (card) card.dataset.in = "1";
        if (!mobile && FX.tilt !== false) {
          var cs = getComputedStyle(stage);
          var bx = parseFloat(cs.getPropertyValue("--rx")) || 0, by = parseFloat(cs.getPropertyValue("--ry")) || 0;
          var rx = gsap.quickTo(stage, "--rx", { duration: 0.8, ease: "power3.out" });
          var ry = gsap.quickTo(stage, "--ry", { duration: 0.8, ease: "power3.out" });
          hero.addEventListener("pointermove", function (e) {
            ry(by + (e.clientX / window.innerWidth - 0.5) * 10);
            rx(bx - (e.clientY / window.innerHeight - 0.5) * 8);
          });
        }
      }
    }

    $$('[data-reveal="words"]').forEach(function (node) {
      if (node.closest("[data-manifesto]")) return;
      gsap.from($$("[data-w]", node), {
        opacity: 0, yPercent: 35, filter: "blur(10px)", duration: 1, stagger: 0.045, ease: "power3.out",
        scrollTrigger: { trigger: node, start: "top 88%", once: true },
      });
    });
    $$('[data-reveal="fade"]').forEach(function (node) {
      gsap.from(node, {
        opacity: 0, y: 18, filter: "blur(6px)", duration: 0.9, ease: "power3.out",
        scrollTrigger: { trigger: node, start: "top 90%", once: true },
      });
    });
    $$("[data-inview]").forEach(function (node) {
      if (node.closest(".hero-stage")) return;
      gsap.from(node, {
        opacity: 0, y: 40, filter: "blur(8px)", duration: 1.1, ease: "power3.out",
        scrollTrigger: { trigger: node, start: "top 85%", once: true, onEnter: function () { node.dataset.in = "1"; } },
      });
    });
    $$("[data-count]").forEach(function (node) {
      var end = Number(node.dataset.count), dec = Number(node.dataset.decimals || 0), o = { v: 0 };
      var lang = document.documentElement.lang || "ru";
      var fmt = function (v) { return v.toLocaleString(lang, { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
      node.textContent = fmt(0);
      gsap.to(o, {
        v: end, duration: 1.8, ease: "power2.out",
        scrollTrigger: { trigger: node, start: "top 92%", once: true },
        onUpdate: function () { node.textContent = fmt(dec ? o.v : Math.round(o.v)); },
      });
    });
    $$("[data-type]").forEach(function (node) {
      var full = node.textContent, o = { n: 0 };
      node.style.minHeight = node.offsetHeight + "px";
      node.textContent = "";
      node.dataset.typing = "1";
      gsap.to(o, {
        n: full.length, duration: full.length * 0.03, ease: "none",
        scrollTrigger: { trigger: node, start: "top 92%", once: true },
        onUpdate: function () { node.textContent = full.slice(0, Math.round(o.n)); },
        onComplete: function () { delete node.dataset.typing; },
      });
    });

    /* manifesto: the brand tile grows into an accent panel, words resolve from blur */
    $$("[data-manifesto]").forEach(function (m) {
      var panel = $("[data-m-panel]", m), center = $("[data-m-center]", m), inner = $("[data-m-inner]", m);
      var kicker = $("[data-m-kicker]", m), words = $$("[data-w]", m);
      var full = kicker ? kicker.textContent : "", k = { n: 0 };
      if (kicker) kicker.textContent = "";
      gsap.set(words, { opacity: 0.12, filter: "blur(6px)" });
      gsap.set(inner, { opacity: 0 });
      var small = function () { return window.innerWidth < 640 ? 92 : 116; };
      var bigH = function () { return Math.min(window.innerHeight * 0.76, 760); };
      gsap.timeline({ scrollTrigger: { trigger: m, start: "top top", end: "+=300%", pin: true, scrub: 0.7, invalidateOnRefresh: true } })
        .fromTo(panel, { width: small, height: small, borderRadius: 30 },
          { width: function () { return Math.min(window.innerWidth - 32, 1408); }, height: bigH, borderRadius: 28, duration: 1, ease: "power2.inOut" })
        .to(center, { y: function () { return bigH() * 0.16; }, duration: 1, ease: "power2.inOut" }, 0)
        .to(inner, { opacity: 1, duration: 0.15 }, ">-0.15")
        .to(k, { n: full.length, duration: 0.35, ease: "none", onUpdate: function () { if (kicker) kicker.textContent = full.slice(0, Math.round(k.n)); } }, "<")
        .to(words, { opacity: 1, filter: "blur(0px)", stagger: 0.07, duration: 0.25 }, "<0.1")
        .to({}, { duration: 1.1 })
        .to(inner, { opacity: 0, duration: 0.2 })
        .to(panel, { width: small, height: small, borderRadius: 30, duration: 0.8, ease: "power2.inOut" }, "<0.05")
        .to(center, { y: 0, duration: 0.8, ease: "power2.inOut" }, "<");
    });

    ST.addEventListener("refresh", function () { if (ribbon) ribbon.measure(); });
    window.addEventListener("load", function () { ST.refresh(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ST.refresh(); });
    ST.refresh();
  }

  function boot() {
    startRibbon();
    startMotion();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

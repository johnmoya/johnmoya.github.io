/* Juan Pablo Moya — Portfolio interactions (vanilla JS, no dependencies) */
(() => {
    "use strict";

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];

    /* ---------- Year ---------- */
    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();

    /* ---------- Navbar: scrolled state + progress + active link ---------- */
    const navbar = $(".navbar");
    const progress = $(".scroll-progress");
    const links = $$(".nav-links a[href^='#']");
    const sections = links.map(a => $(a.getAttribute("href"))).filter(Boolean);

    const onScroll = () => {
        const y = window.scrollY;
        if (navbar) navbar.classList.toggle("scrolled", y > 20);

        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (progress) progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;

        let current = null;
        sections.forEach(sec => { if (sec.getBoundingClientRect().top < window.innerHeight * 0.4) current = sec.id; });
        links.forEach(a => a.classList.toggle("active", a.getAttribute("href") === `#${current}`));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* ---------- Mobile menu ---------- */
    const toggle = $(".nav-toggle");
    if (toggle) toggle.addEventListener("click", () => {
        const open = document.body.classList.toggle("nav-open");
        toggle.setAttribute("aria-expanded", String(open));
    });
    links.forEach(a => a.addEventListener("click", () => {
        document.body.classList.remove("nav-open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
    }));

    /* ---------- Count-up ---------- */
    const countUp = el => {
        const target = parseFloat(el.dataset.count);
        const decimals = parseInt(el.dataset.decimals || "0", 10);
        if (reduceMotion) { el.textContent = target.toFixed(decimals); return; }
        const t0 = performance.now(), dur = 1400;
        const tick = now => {
            const p = Math.min((now - t0) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = (target * eased).toFixed(decimals);
            if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    /* ---------- VaR histogram in flagship card ---------- */
    const bars = $("#var-bars");
    const varChart = $(".var-chart");
    const N_BARS = 34, TAIL = 4;
    if (bars) {
        for (let i = 0; i < N_BARS; i++) {
            const b = document.createElement("i");
            if (i < TAIL) b.classList.add("tail");
            bars.appendChild(b);
        }
    }
    const drawBars = () => {
        // fat-tailed (Student-t-like) density, slightly left-skewed
        const items = $$("i", bars);
        items.forEach((b, i) => {
            const x = (i - N_BARS * 0.56) / (N_BARS * 0.15);
            const d = Math.pow(1 + (x * x) / 4, -2.5);
            b.style.height = `${Math.max(4, d * 100)}%`;
            b.style.transitionDelay = `${i * 18}ms`;
        });
        // position dashed VaR line at the tail boundary
        const line = $(".var-line");
        const first = items[TAIL];
        if (line && first) {
            const left = first.offsetLeft - 2;
            line.style.left = `${left}px`;
        }
        varChart.classList.add("in");
    };

    /* ---------- Reveal on scroll ---------- */
    try {
        const revealEls = $$(".reveal");
        const showAll = () => {
            revealEls.forEach(el => el.classList.add("in"));
            $$("[data-count]").forEach(el => { if (!el.dataset.done) { el.dataset.done = "1"; countUp(el); } });
            if (varChart && !varChart.classList.contains("in")) drawBars();
        };
        if ("IntersectionObserver" in window && !reduceMotion) {
            document.documentElement.classList.add("reveal-ready");
            const io = new IntersectionObserver(entries => {
                entries.forEach(e => {
                    if (!e.isIntersecting) return;
                    e.target.classList.add("in");
                    $$("[data-count]", e.target).forEach(el => { if (!el.dataset.done) { el.dataset.done = "1"; countUp(el); } });
                    if (varChart && e.target.contains(varChart)) drawBars();
                    io.unobserve(e.target);
                });
            }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });
            revealEls.forEach(el => io.observe(el));
            // Safety net: never leave content hidden
            setTimeout(() => { revealEls.forEach(el => { if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("in"); }); }, 1500);
        } else {
            showAll();
        }
    } catch (err) {
        document.documentElement.classList.remove("reveal-ready");
        console.error(err);
    }
    window.addEventListener("resize", () => { if (varChart && varChart.classList.contains("in")) drawBars(); });

    /* ---------- Cursor glow on project cards ---------- */
    $$(".project-card").forEach(card => {
        card.addEventListener("pointermove", e => {
            const r = card.getBoundingClientRect();
            card.style.setProperty("--mx", `${e.clientX - r.left}px`);
            card.style.setProperty("--my", `${e.clientY - r.top}px`);
        });
    });

    /* ---------- Hero: Monte Carlo simulation canvas ----------
       Simulated price paths (fat-tailed shocks) fan out to the right;
       terminal values accumulate into a histogram with a live 99% VaR line. */
    const canvas = $("#mc-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W, H, dpr, x0, x1, yMid, scale;

    const STEPS = 90, BATCH = 14, KEEP = 140, BINS = 46;
    let done = [], batch = [], step = 0;
    let hist = new Float32Array(BINS);
    let terminals = [];

    const randn = () => {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    // Student-t (df=4) shock for fat tails
    const shock = () => {
        const z = randn();
        let chi = 0;
        for (let k = 0; k < 4; k++) { const g = randn(); chi += g * g; }
        return Math.max(-4, Math.min(4, z / Math.sqrt(chi / 4))) * 0.7;
    };

    const resize = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = canvas.getBoundingClientRect();
        W = r.width; H = r.height;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const mobile = W < 760;
        x0 = mobile ? W * 0.05 : W * 0.54;
        x1 = mobile ? W * 0.78 : W * 0.86;
        yMid = H * (mobile ? 0.36 : 0.48);
        scale = H * (mobile ? 0.011 : 0.0135);
    };

    const newPath = () => {
        const pts = new Float32Array(STEPS + 1);
        let v = 0;
        for (let i = 1; i <= STEPS; i++) { v += shock(); pts[i] = v; }
        return pts;
    };
    const newBatch = () => { batch = Array.from({ length: BATCH }, newPath); step = 0; };

    const yOf = v => yMid - v * scale;
    const binOf = y => Math.floor(((y - (yMid - H * 0.42)) / (H * 0.84)) * BINS);

    const commitBatch = () => {
        batch.forEach(p => {
            const vT = p[STEPS];
            terminals.push(vT);
            const b = binOf(yOf(vT));
            if (b >= 0 && b < BINS) hist[b] += 1;
            done.push(p);
        });
        if (done.length > KEEP) done.splice(0, done.length - KEEP);
        if (terminals.length > 2000) terminals.splice(0, terminals.length - 2000);
        for (let i = 0; i < BINS; i++) hist[i] *= 0.985;
    };

    const drawPath = (p, upto, alpha, color) => {
        ctx.beginPath();
        const dx = (x1 - x0) / STEPS;
        ctx.moveTo(x0, yOf(0));
        for (let i = 1; i <= upto; i++) ctx.lineTo(x0 + i * dx, yOf(p[i]));
        ctx.strokeStyle = color.replace("A", alpha);
        ctx.stroke();
    };

    const quantile = (arr, q) => {
        if (arr.length < 30) return null;
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(q * (s.length - 1))];
    };

    const render = () => {
        ctx.clearRect(0, 0, W, H);

        // grid
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.035)";
        for (let gx = x0; gx <= x1 + 1; gx += (x1 - x0) / 6) {
            ctx.beginPath(); ctx.moveTo(gx, yMid - H * 0.42); ctx.lineTo(gx, yMid + H * 0.42); ctx.stroke();
        }

        // completed paths
        ctx.lineWidth = 1;
        done.forEach((p, i) => drawPath(p, STEPS, (0.04 + 0.1 * (i / done.length)).toFixed(3), "rgba(92,200,255,A)"));

        // active batch
        ctx.lineWidth = 1.4;
        batch.forEach(p => drawPath(p, step, 0.75, "rgba(124,245,200,A)"));

        // histogram of terminal values
        const hx = x1 + 14, hw = Math.max(40, W - hx - 24);
        const max = Math.max(1, ...hist);
        const binH = (H * 0.84) / BINS;
        const varV = quantile(terminals, 0.01);
        const varY = varV !== null ? yOf(varV) : null;

        for (let i = 0; i < BINS; i++) {
            const y = (yMid - H * 0.42) + i * binH;
            const len = (hist[i] / max) * hw;
            const isTail = varY !== null && y >= varY;
            ctx.fillStyle = isTail ? "rgba(255,107,107,0.7)" : "rgba(92,200,255,0.45)";
            ctx.fillRect(hx, y + 1, len, binH - 2);
        }

        // VaR line
        if (varY !== null) {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = "rgba(255,107,107,0.8)";
            ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * 0.55, varY); ctx.lineTo(W - 16, varY); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(255,107,107,0.9)";
            ctx.font = "11px 'JetBrains Mono', monospace";
            ctx.textAlign = "right";
            ctx.fillText("VaR 99%", x1 - 6, varY - 8);
            ctx.textAlign = "left";
        }

        // origin dot
        ctx.fillStyle = "#7cf5c8";
        ctx.beginPath(); ctx.arc(x0, yOf(0), 3, 0, Math.PI * 2); ctx.fill();
    };

    let last = 0;
    const loop = now => {
        if (now - last > 16) {
            step += 1;
            if (step > STEPS) { commitBatch(); newBatch(); }
            render();
            last = now;
        }
        if (!document.hidden && visible) requestAnimationFrame(loop);
        else running = false;
    };

    let visible = true, running = false;
    const start = () => { if (!running && !reduceMotion) { running = true; requestAnimationFrame(loop); } };

    resize();
    window.addEventListener("resize", () => { resize(); render(); });

    // Warm-up so the histogram isn't empty on first paint
    for (let k = 0; k < 18; k++) { newBatch(); commitBatch(); }
    newBatch();

    if (reduceMotion) { step = STEPS; render(); return; }

    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(canvas);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
    start();
})();

// assets/js/common.js
// Nav stays text-only; active tab highlight; ensure each page's H1 starts with its emoji.
// Robust to late DOM changes via MutationObserver.
(function () {
  // --- ROUTE & CONFIG ---
  function getRoute() {
    const path = location.pathname.replace(/\/+$/, '');
    const name = path.split('/').pop() || 'index.html';
    return (name.replace('.html','') || 'index');
  }
  const CONFIG = {
    index:         { emoji: '🏠', label: 'home' },
    calculator:    { emoji: '🏠', label: 'calculator' }, // you use 🏠 for Calc
    analysis:      { emoji: '📊', label: 'analysis' },
    compare:       { emoji: '⚖️', label: 'compare' },
    reports:       { emoji: '📋', label: 'reports' },
    market:        { emoji: '🏙️', label: 'market' },
    qualification: { emoji: '🏦', label: 'qualification' }
  };
  const KNOWN = new Set(Object.values(CONFIG).map(c => c.emoji));

  // --- ACTIVE NAV (no emoji injection) ---
  function applyActiveNav(route) {
    document.querySelectorAll('.nav a').forEach(a => {
      const href = a.getAttribute('href') || '';
      const isIndex = route === 'index' && /index\.html$/i.test(href);
      const isMatch = route !== 'index' && new RegExp(route + '\\.html$', 'i').test(href);
      const active = isIndex || isMatch;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });
  }

  // --- H1 EMOJI ENFORCER ---
  function applyH1Emoji(route) {
    const cfg = CONFIG[route];
    if (!cfg) return;

    // first H1 not inside header/nav
    const candidates = Array.from(document.querySelectorAll('h1'))
      .filter(h => !h.closest('header,.site-header,.nav'));
    const h1 = candidates[0];
    if (!h1) return;

    // If it already has our span, normalize it and exit
    const span = h1.querySelector('span.emoji');
    if (span) {
      if (span.textContent !== cfg.emoji) span.textContent = cfg.emoji;
      span.setAttribute('aria-label', cfg.label);
      return;
    }

    // Work off plain text to avoid duplicate emojis
    const raw = (h1.textContent || '').trim();
    const first = raw ? Array.from(raw)[0] : '';
    const rest = KNOWN.has(first) ? raw.slice(first.length).trimStart() : raw;

    h1.innerHTML = `<span class="emoji hpad" role="img" aria-label="${cfg.label}">${cfg.emoji}</span>${rest}`;
  }

  // --- APPLY (initial + on DOM changes) ---
  let route = getRoute();
  function applyAll() {
    route = getRoute();
    applyActiveNav(route);
    applyH1Emoji(route);
  }

  // Run at DOM ready and after full load
  document.addEventListener('DOMContentLoaded', applyAll);
  window.addEventListener('load', applyAll);

  // Re-apply if other scripts update the page later
  let throttle;
  const mo = new MutationObserver(() => {
    clearTimeout(throttle);
    throttle = setTimeout(applyAll, 60);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // quick debug flag
  window.__pc_common_js_loaded = true;
})();




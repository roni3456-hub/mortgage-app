// assets/js/common.js
// Nav stays text-only; active tab highlight; ensure the first content heading (H1/H2/H3) starts with its emoji.
// Works even if other scripts re-render later.

(function () {
  // --- ROUTE + CONFIG ---
  function getRoute() {
    const path = location.pathname.replace(/\/+$/, '');
    const name = path.split('/').pop() || 'index.html';
    return (name.replace('.html','') || 'index');
  }
  const CONFIG = {
    index:         { emoji: '🏠', label: 'home' },
    calculator:    { emoji: '🏠', label: 'calculator' }, // you’ve been using 🏠 for Calc
    analysis:      { emoji: '📊', label: 'analysis' },
    compare:       { emoji: '⚖️', label: 'compare' },
    reports:       { emoji: '📋', label: 'reports' },
    market:        { emoji: '🏙️', label: 'market' },
    qualification: { emoji: '🏦', label: 'qualification' }
  };
  const KNOWN = new Set(Object.values(CONFIG).map(c => c.emoji));

  // --- ACTIVE NAV (no emoji injection in nav) ---
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

  // --- EMOJI ENFORCER on first real page heading (H1/H2/H3 not inside header/nav) ---
  function applyHeadingEmoji(route) {
    const cfg = CONFIG[route];
    if (!cfg) return;

    // Prefer headings inside <main>, but fall back to the first heading in the body
    const candidates = Array.from(
      document.querySelectorAll('main h1, main h2, main h3, body h1, body h2, body h3')
    ).filter(h => !h.closest('header,.site-header,.nav'));

    const h = candidates[0];
    if (!h) return;

    const span = h.querySelector('span.emoji');
    if (span) {
      if (span.textContent !== cfg.emoji) span.textContent = cfg.emoji;
      span.setAttribute('aria-label', cfg.label);
      return;
    }

    const raw = (h.textContent || '').trim();
    const first = raw ? Array.from(raw)[0] : '';
    const rest = KNOWN.has(first) ? raw.slice(first.length).trimStart() : raw;

    h.innerHTML = `<span class="emoji hpad" role="img" aria-label="${cfg.label}">${cfg.emoji}</span>${rest}`;
  }

  // --- APPLY (initial + on DOM changes) ---
  function applyAll() {
    const route = getRoute();
    applyActiveNav(route);
    applyHeadingEmoji(route);
  }

  document.addEventListener('DOMContentLoaded', applyAll);
  window.addEventListener('load', applyAll);

  // Re-apply on dynamic changes
  let throttle;
  new MutationObserver(() => { clearTimeout(throttle); throttle = setTimeout(applyAll, 60); })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // simple debug flag
  window.__pc_common_js_loaded = true;
})();




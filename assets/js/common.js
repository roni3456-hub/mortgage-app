// assets/js/common.js
// Emojis appear ONLY in page H1s (auto-added per page); nav stays text-only;
// also highlights the active nav link.
(function () {
  try {
    // figure out current route from URL
    const path = location.pathname.replace(/\/+$/, '');
    const name = path.split('/').pop() || 'index.html';
    const route = (name.replace('.html','') || 'index');

    // --- 1) Active nav highlighting (no emoji injection in nav) ---
    document.querySelectorAll('.nav a').forEach(a => {
      const href = a.getAttribute('href') || '';
      const isIndex = route === 'index' && /index\.html$/i.test(href);
      const isMatch = route !== 'index' && new RegExp(route + '\\.html$', 'i').test(href);
      const isActive = isIndex || isMatch;
      a.classList.toggle('active', isActive);
      if (isActive) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });

    // --- 2) Ensure H1 starts with the designated emoji (and wrap accessibly) ---
    const CONFIG = {
      index:         { emoji: '🏠', label: 'home' },
      calculator:    { emoji: '🏠', label: 'calculator' }, // you’ve been using 🏠 for Calc
      analysis:      { emoji: '📊', label: 'analysis' },
      compare:       { emoji: '⚖️', label: 'compare' },
      reports:       { emoji: '📋', label: 'reports' },
      market:        { emoji: '🏙️', label: 'market' },
      qualification: { emoji: '🏦', label: 'qualification' }
    };

    const cfg = CONFIG[route];
    const h1 = document.querySelector('main h1, h1');
    if (h1 && cfg) {
      // If H1 already has our <span class="emoji">, just normalize it.
      const existingSpan = h1.querySelector('.emoji');
      if (existingSpan) {
        if (existingSpan.textContent !== cfg.emoji) existingSpan.textContent = cfg.emoji;
        existingSpan.setAttribute('aria-label', cfg.label);
      } else {
        // Work with text content to avoid duplicating emojis
        const raw = (h1.textContent || '').trim();
        const first = raw ? Array.from(raw)[0] : '';
        const KNOWN = Object.values(CONFIG).map(c => c.emoji);
        const beginsWithEmoji = KNOWN.includes(first);
        const restText = beginsWithEmoji ? raw.slice(first.length).trimStart() : raw;

        // Force the designated emoji for this route
        h1.innerHTML = `<span class="emoji hpad" role="img" aria-label="${cfg.label}">${cfg.emoji}</span>${restText}`;
      }
    }
  } catch (e) {
    console.warn('common.js init error', e);
  }
})();



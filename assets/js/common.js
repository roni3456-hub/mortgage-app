// assets/js/common.js
// Non-destructive UI polish for emojis + active nav across all pages.
(function () {
  try {
    // Figure out current page route (index, calculator, analysis, etc.)
    const path = location.pathname.replace(/\/+$/, '');
    const name = path.split('/').pop() || 'index.html';
    const route = (name.replace('.html','') || 'index');

    // Map routes/links to emojis + accessible labels
    const iconMap = {
      index:         { emoji: '🏠', label: 'home',          match: /index\.html$/i },
      calculator:    { emoji: '🏠', label: 'calculator',    match: /calculator\.html$/i },
      reports:       { emoji: '📋', label: 'reports',       match: /reports\.html$/i },
      analysis:      { emoji: '📊', label: 'analysis',      match: /analysis\.html$/i },
      compare:       { emoji: '⚖️', label: 'compare',       match: /compare\.html$/i },
      market:        { emoji: '🏙️', label: 'market',        match: /market\.html$/i },
      qualification: { emoji: '🏦', label: 'qualification', match: /qualification\.html$/i },
      app:           { emoji: '📱', label: 'download app',  match: /site\.webmanifest$/i }
    };

    // 1) Highlight the active nav link (without relying on hardcoded "active" class)
    document.querySelectorAll('.nav a').forEach(a => {
      const href = a.getAttribute('href') || '';
      let isActive = false;
      for (const key in iconMap) {
        if (iconMap[key].match.test(href)) {
          // active if this link matches current route
          if ((route === 'index' && /index\.html$/i.test(href)) ||
              (route !== 'index' && new RegExp(route + '\\.html$', 'i').test(href))) {
            isActive = true;
          }
          // 2) Prefix emoji if not already present
          const txt = (a.textContent || '').trim();
          const first = Array.from(txt)[0] || '';
          if (first !== iconMap[key].emoji) {
            a.innerHTML = `<span class="emoji hpad" role="img" aria-label="${iconMap[key].label}">${iconMap[key].emoji}</span>${txt}`;
          } else {
            // ensure accessibility wrapper if emoji already present
            if (!a.querySelector('.emoji')) {
              const rest = txt.slice(first.length).trimStart();
              a.innerHTML = `<span class="emoji hpad" role="img" aria-label="${iconMap[key].label}">${first}</span>${rest}`;
            }
          }
        }
      }
      a.classList.toggle('active', isActive);
      if (isActive) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });

    // 3) If a page’s main <h1> starts with one of our emojis, wrap it for accessibility
    const labelByEmoji = {
      '🏠':'home','🏦':'mortgage','📊':'analysis','⚖️':'compare',
      '📋':'reports','🏙️':'market','📱':'download app','💾':'save'
    };
    const h1 = document.querySelector('h1');
    if (h1) {
      const txt = (h1.textContent || '').trim();
      if (txt) {
        const first = Array.from(txt)[0];
        if (labelByEmoji[first] && !h1.querySelector('.emoji')) {
          const rest = txt.slice(first.length).trimStart();
          h1.innerHTML = `<span class="emoji hpad" role="img" aria-label="${labelByEmoji[first]}">${first}</span>${rest}`;
        }
      }
    }
  } catch (e) {
    console.warn('common.js init error', e);
  }
})();

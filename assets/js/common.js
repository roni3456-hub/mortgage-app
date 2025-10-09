// assets/js/common.js
// Keeps emojis ONLY in page H1s; no emojis in nav; highlights active tab.
(function () {
  try {
    const path = location.pathname.replace(/\/+$/, '');
    const name = path.split('/').pop() || 'index.html';
    const route = name.replace('.html','') || 'index';

    // Highlight the active nav link
    document.querySelectorAll('.nav a').forEach(a => {
      const href = a.getAttribute('href') || '';
      const isIndex = route === 'index' && /index\.html$/i.test(href);
      const isMatch = route !== 'index' && new RegExp(route + '\\.html$', 'i').test(href);
      const isActive = isIndex || isMatch;
      a.classList.toggle('active', isActive);
      if (isActive) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });

    // Wrap the leading emoji in <h1> for accessibility
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


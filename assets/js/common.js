// PropCheck common enhancements (emoji nav + a11y)
(function(){
  try{
    const iconFor = (href, text) => {
      // normalize by filename
      try{
        const url = new URL(href, location.href);
        const file = (url.pathname.split('/').pop() || '').toLowerCase();
        const map = {
          "": "🏠","index.html":"🏠","/":"🏠",
          "calculator.html":"🏠",
          "reports.html":"📋",
          "analysis.html":"📊",
          "compare.html":"⚖️",
          "market.html":"🏙️",
          "qualification.html":"🏦",
          "site.webmanifest":"📱"
        };
        if(map[file]) return map[file];
      }catch(e){}
      // fallback by keyword in text
      text = (text||'').toLowerCase();
      if(text.includes('report')) return "📋";
      if(text.includes('analys')) return "📊";
      if(text.includes('compar')) return "⚖️";
      if(text.includes('market')) return "🏙️";
      if(text.includes('qualif')) return "🏦";
      if(text.includes('calc')) return "🏠"; // keep original convention
      if(text.includes('home')) return "🏠";
      if(text.includes('install') || text.includes('app')) return "📱";
      return null;
    };

    // decorate nav links with emojis if missing
    document.querySelectorAll('.nav-links a, nav .nav-link, nav a.nav-link').forEach(a=>{
      const txt = (a.textContent||'').trim();
      const hasEmoji = /\p{Extended_Pictographic}/u.test(txt);
      if(!hasEmoji){
        const emoji = iconFor(a.getAttribute('href')||'', txt);
        if(emoji){
          a.innerHTML = `<span class="emoji hpad" role="img" aria-hidden="true">${emoji}</span>` + txt;
        }
      }
    });

    // wrap leading emojis in headings for a11y
    const labelMap = {"🏠":"home","🏦":"mortgage","📊":"analysis","⚖️":"compare","📋":"reports","🏙️":"market","📱":"download app","💾":"save"};
    document.querySelectorAll('h1,h2,h3,button,.btn').forEach(el=>{
      const txt = (el.textContent||'').trim();
      if(!txt) return;
      const first = Array.from(txt)[0];
      if(labelMap[first] && !el.querySelector('.emoji')){
        const rest = txt.slice(first.length).trimStart();
        el.innerHTML = `<span class="emoji hpad" role="img" aria-label="${labelMap[first]}">${first}</span>${rest}`;
      }
    });
  }catch(e){ console.warn('common.js error', e); }
})();

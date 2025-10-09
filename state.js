
// Simple shared state using localStorage. Works across pages.
(function(){
  const LS_USER = "pc:user";
  const LS_DEAL = "pc:deal";

  window.PCState = {
    getUser(){ try{return JSON.parse(localStorage.getItem(LS_USER)||"null");}catch{return null;} },
    setUser(u){ localStorage.setItem(LS_USER, JSON.stringify(u)); },
    clearUser(){ localStorage.removeItem(LS_USER); },

    getDeal(){ try{return JSON.parse(localStorage.getItem(LS_DEAL)||"null");}catch{return null;} },
    setDeal(d){ localStorage.setItem(LS_DEAL, JSON.stringify(d)); },
    clearDeal(){ localStorage.removeItem(LS_DEAL); }
  };

  // Convenience helpers
  window.PC = {
    money(n){ if(n==null||isNaN(n)) return "$0"; return n.toLocaleString('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}); },
  };
})();

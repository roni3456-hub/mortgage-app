
// Google Sign-In (ID token). Requires gsi/client script on pages using it.
(function(){
  function decodeJwt(token){
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g,'+').replace(/_/g,'/');
    const json = decodeURIComponent(atob(payload).split('').map(c => '%' + ('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    try { return JSON.parse(json); } catch { return null; }
  }

  window.PCAuth = {
    initGoogleButton(targetEl){
      const cfg = window.PC_CONFIG||{};
      if (!window.google || !google.accounts || !google.accounts.id) return;
      if (!cfg.GOOGLE_OAUTH_CLIENT_ID) {
        targetEl.innerHTML = '<div style="color:#ef4444">Missing Google OAuth Client ID</div>';
        return;
      }
      google.accounts.id.initialize({
        client_id: cfg.GOOGLE_OAUTH_CLIENT_ID,
        callback: (resp)=>{
          const payload = decodeJwt(resp.credential);
          if (!payload) { alert('Google sign-in failed.'); return; }
          const user = { mode:'google', sub:payload.sub, name:payload.name||payload.given_name||'', email:payload.email||'' };
          window.PCState.setUser(user);
          window.location.href = "calculator.html";
        },
        ux_mode: 'popup',
        auto_select: false,
        itp_support: true
      });
      google.accounts.id.renderButton(targetEl, { theme:'outline', size:'large', shape:'pill', text:'signin_with', width:260 });
    },
    signOut(){
      window.PCState.clearUser();
      window.location.href = "index.html";
    }
  };
})();

// PropCheck — Centralized Google Identity + gapi bootstrap
// Goals:
//  - No auto popups on page load
//  - Share one access token across all pages (per tab/session)
//  - Silent refresh if possible, interactive only on user action
//
// Public API:
//   PCAuth.init() -> Promise<void>
//   PCAuth.signIn() -> Promise<string>   // interactive popup
//   PCAuth.ensureAuth(interactive:boolean) -> Promise<string|null> // gets/refreshes token
//   PCAuth.getAccessTokenOrNull() -> string|null
//   PCAuth.signOutLocalOnly() -> void    // clears local token (does NOT revoke Google session)

(function () {
  const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

  const store = {
    get(k){ try{return sessionStorage.getItem(k);}catch{return null;} },
    set(k,v){ try{sessionStorage.setItem(k,v);}catch{} },
    del(k){ try{sessionStorage.removeItem(k);}catch{} },
  };

  const TOKEN_KEY = "pc:token";
  const EXP_KEY   = "pc:token_expires"; // epoch ms

  let gapiReady = false;
  let gisReady  = false;
  let tokenClient = null;

  function nowMs(){ return Date.now(); }
  function isExpired(){
    const exp = Number(store.get(EXP_KEY) || 0);
    return !exp || nowMs() >= exp;
  }
  function setGapiTokenIfAny(){
    const token = store.get(TOKEN_KEY);
    if (token && window.gapi?.client) {
      gapi.client.setToken({ access_token: token });
    }
  }

  async function loadGapi(){
    if (gapiReady) return;
    await new Promise((res) => {
      if (window.gapi?.load) {
        window.gapi.load("client", res);
      } else {
        const iv = setInterval(() => {
          if (window.gapi?.load) { clearInterval(iv); window.gapi.load("client", res); }
        }, 20);
      }
    });
    await gapi.client.init({}); // discovery comes from drive.js
    gapiReady = true;
    setGapiTokenIfAny();
  }

  async function loadGIS(){
    if (gisReady) return;
    await new Promise((res) => {
      if (window.google?.accounts?.oauth2) return res();
      const iv = setInterval(() => {
        if (window.google?.accounts?.oauth2) { clearInterval(iv); res(); }
      }, 20);
    });
    gisReady = true;
  }

  function resolveClientId(){
    const cfg = (window.PC_CONFIG || {});
    return (
      cfg.GOOGLE_OAUTH_CLIENT_ID ||
      cfg.GOOGLE_CLIENT_ID ||
      window.GOOGLE_OAUTH_CLIENT_ID || // fallback global if someone defines it
      ""
    );
  }

  function buildTokenClient(){
    if (tokenClient) return;
    const clientId = resolveClientId();
    if (!clientId) {
      console.warn("[PCAuth] Missing Google OAuth Client ID. Set PC_CONFIG.GOOGLE_OAUTH_CLIENT_ID.");
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: () => {}, // replaced per-request
    });
  }

  async function silentWarmup(){
    if (!tokenClient) buildTokenClient();
    return new Promise((resolve) => {
      tokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          const expiresIn = Number(resp.expires_in || 3600);
          const expMs = nowMs() + (expiresIn * 1000 - 5000);
          store.set(TOKEN_KEY, resp.access_token);
          store.set(EXP_KEY, String(expMs));
          setGapiTokenIfAny();
        }
        resolve();
      };
    // Disabled automatic silent popup on load – now only runs on user click
// tokenClient.requestAccessToken({ prompt: "" });
resolve(); // do nothing until explicitly called

    });
  }

  async function interactiveSignIn(){
    if (!tokenClient) buildTokenClient();
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          const expiresIn = Number(resp.expires_in || 3600);
          const expMs = nowMs() + (expiresIn * 1000 - 5000);
          store.set(TOKEN_KEY, resp.access_token);
          store.set(EXP_KEY, String(expMs));
          setGapiTokenIfAny();
          resolve(resp.access_token);
        } else {
          reject(new Error("No access_token in response"));
        }
      };
      tokenClient.requestAccessToken({ prompt: "consent" }); // popup (user-initiated)
    });
  }

  async function ensureAuth(interactive){
    await loadGapi();
    await loadGIS();

    const token = store.get(TOKEN_KEY);
    if (token && !isExpired()) {
      setGapiTokenIfAny();
      return token;
    }

    await silentWarmup();
    const afterSilent = store.get(TOKEN_KEY);
    if (afterSilent && !isExpired()) return afterSilent;

    if (interactive) {
      return await interactiveSignIn();
    }
    return null;
  }

  function getAccessTokenOrNull(){
    const t = store.get(TOKEN_KEY);
    if (!t || isExpired()) return null;
    return t;
  }

  function signOutLocalOnly(){
    store.del(TOKEN_KEY);
    store.del(EXP_KEY);
    if (gapiReady && window.gapi?.client) {
      gapi.client.setToken(null);
    }
  }

  // Public API
  window.PCAuth = {
    init: async () => { await loadGapi(); await loadGIS(); setGapiTokenIfAny(); },
    ensureAuth,
    signIn: interactiveSignIn,
    getAccessTokenOrNull,
    signOutLocalOnly,
  };
})();


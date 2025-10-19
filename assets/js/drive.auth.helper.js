<!-- assets/js/drive.auth.helper.js -->
<script>
/**
 * PropCheck — Centralized Google Identity + gapi bootstrap
 * Goals:
 *  - No auto popups on page load
 *  - Share one access token across all pages (per tab/session)
 *  - Silent refresh if possible, interactive only on user action
 *
 * Public API:
 *   PCAuth.init() -> Promise<void>
 *   PCAuth.signIn() -> Promise<string>   // interactive popup
 *   PCAuth.ensureAuth(interactive:boolean) -> Promise<string> // gets/refreshes token
 *   PCAuth.getAccessTokenOrNull() -> string|null
 *   PCAuth.signOutLocalOnly() -> void    // clears local token (does NOT revoke Google session)
 *
 * Usage in pages:
 *   1) Include scripts (GSI + gapi) then this file.
 *   2) On Save/Load clicks, call: await PCAuth.ensureAuth(true)
 *   3) For a dedicated Sign-in button: await PCAuth.signIn()
 */

(function () {
  const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

  const store = {
    get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { sessionStorage.setItem(key, val); } catch {} },
    del(key) { try { sessionStorage.removeItem(key); } catch {} },
  };

  const TOKEN_KEY = "pc:token";
  const EXP_KEY   = "pc:token_expires"; // epoch ms

  let gapiReady = false;
  let gisReady  = false;
  let tokenClient = null;

  function nowMs(){ return Date.now(); }
  function isExpired() {
    const exp = Number(store.get(EXP_KEY) || 0);
    return !exp || nowMs() >= exp;
  }
  function setGapiTokenIfAny() {
    const token = store.get(TOKEN_KEY);
    if (token && window.gapi?.client) {
      gapi.client.setToken({ access_token: token });
    }
  }

  async function loadGapi() {
    if (gapiReady) return;
    await new Promise((res) => {
      if (window.gapi?.load) {
        window.gapi.load("client", res);
      } else {
        const check = setInterval(() => {
          if (window.gapi?.load) { clearInterval(check); window.gapi.load("client", res); }
        }, 20);
      }
    });
    await gapi.client.init({}); // no discovery here; drive.js can load discovery if it wants
    gapiReady = true;
    setGapiTokenIfAny();
  }

  async function loadGIS() {
    if (gisReady) return;
    await new Promise((res) => {
      if (window.google?.accounts?.oauth2) return res();
      const check = setInterval(() => {
        if (window.google?.accounts?.oauth2) { clearInterval(check); res(); }
      }, 20);
    });
    gisReady = true;
  }

  function buildTokenClient() {
    const clientId = (window.PC_CONFIG && window.PC_CONFIG.GOOGLE_CLIENT_ID) || window.GOOGLE_OAUTH_CLIENT_ID || "";
    if (!clientId) {
      console.warn("[PCAuth] Missing GOOGLE_CLIENT_ID in config. Set window.PC_CONFIG.GOOGLE_CLIENT_ID.");
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      // NOTE: we control prompt dynamically per request below
      callback: (resp) => {
        // This is overridden per-request; kept for completeness.
      },
    });
  }

  async function silentWarmupIfPossible() {
    // Does NOT trigger a popup. If user has a Google session, this succeeds silently.
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
      tokenClient.requestAccessToken({ prompt: "" }); // silent attempt, no UI
    });
  }

  async function interactiveSignIn() {
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
      tokenClient.requestAccessToken({ prompt: "consent" }); // popup only on user click
    });
  }

  async function ensureAuth(interactive) {
    await loadGapi();
    await loadGIS();

    const token = store.get(TOKEN_KEY);
    if (token && !isExpired()) {
      setGapiTokenIfAny();
      return token;
    }

    // Try silent refresh first (no popup)
    await silentWarmupIfPossible();
    const afterSilent = store.get(TOKEN_KEY);
    if (afterSilent && !isExpired()) return afterSilent;

    if (interactive) {
      // User triggered action → allow popup
      return await interactiveSignIn();
    }

    // Non-interactive caller; return null if still not authorized
    return null;
  }

  function getAccessTokenOrNull() {
    const t = store.get(TOKEN_KEY);
    if (!t || isExpired()) return null;
    return t;
  }

  function signOutLocalOnly() {
    store.del(TOKEN_KEY);
    store.del(EXP_KEY);
    if (gapiReady && window.gapi?.client) {
      gapi.client.setToken(null);
    }
  }

  // public
  window.PCAuth = {
    init: async () => { await loadGapi(); await loadGIS(); setGapiTokenIfAny(); /* no popup */ },
    ensureAuth,
    getAccessTokenOrNull,
    signIn: interactiveSignIn,
    signOutLocalOnly,
  };
})();
</script>


// assets/js/drive.auth.helper.js
// Token-reuse helper for Google Drive (additive; does not modify your drive.js)

(function () {
  const SCOPES =
    "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";
  const CLIENT_ID = (window.CONFIG && CONFIG.GOOGLE_OAUTH_CLIENT_ID) || "";

  function ensureGIS() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      throw new Error('Google Identity Services not loaded. Add <script src="https://accounts.google.com/gsi/client" async defer></script> to your HTML.');
    }
  }

  const Auth = (function () {
    let tokenClient = null;
    let accessToken = null;
    let expiryMs = 0;

    function ensureClient() {
      ensureGIS();
      if (tokenClient) return tokenClient;
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        prompt: "", // we control prompt per request
        callback: () => {},
      });
      return tokenClient;
    }

    function req(promptMode) {
      return new Promise((resolve) => {
        ensureClient().requestAccessToken({
          prompt: promptMode, // "none" (silent) or "consent" (interactive)
          callback: (res) => resolve(res && res.access_token ? res : null),
        });
      });
    }

    async function getToken({ forcePrompt = false } = {}) {
      const now = Date.now();
      if (!forcePrompt && accessToken && now < (expiryMs - 60_000)) return accessToken;

      if (!forcePrompt) {
        const silent = await req("none");
        if (silent && silent.access_token) {
          accessToken = silent.access_token;
          expiryMs = now + ((silent.expires_in || 3300) * 1000);
          return accessToken;
        }
      }

      const interactive = await req("consent");
      if (!interactive) throw new Error("Drive auth failed");
      accessToken = interactive.access_token;
      expiryMs = Date.now() + ((interactive.expires_in || 3300) * 1000);
      return accessToken;
    }

    async function driveFetch(url, opts = {}) {
      const token = await getToken();
      const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
      const res = await fetch(url, { ...opts, headers });
      if (!res.ok) {
        let msg = "";
        try { msg = await res.text(); } catch {}
        throw new Error(`Drive ${res.status}: ${msg || res.statusText}`);
      }
      return res;
    }

    return { getToken, driveFetch };
  })();

  // Export
  window.PCAuth = Auth;
})();

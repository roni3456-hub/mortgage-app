// PropCheck — Centralized Google Drive auth + resumable upload
// v2 (Option B: silent refresh on every page)
// - One owner for GIS/gapi + token
// - Silent token attempt on load (no popup)
// - Minimal API for pages: autoInit, isReady, getUser, onStatus, saveDealToDrive, signIn, signOut

(function () {
  const SCOPES =
    "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

  // --- internal state ---
  let gapiReady = false;
  let accessToken = null;
  let tokenClient = null;
  let currentUser = null; // { displayName, emailAddress }
  const listeners = new Set();

  // localStorage keys
  const LS = {
    SEEN_CONSENT: "pcdrive_seen_consent",     // "1" after first successful consent
    LAST_OK: "pcdrive_last_ok",               // ISO string of last success
  };

  // --- utils ---
  const log = (...a) => { try { console.log("[PCDrive]", ...a); } catch {} };
  const asStr = (v) => (typeof v === "string" ? v : JSON.stringify(v));
  const safeJSON = (s, f=null) => { try { return JSON.parse(s); } catch { return f; } };
  function parseGapiError(e) {
    try {
      if (!e) return "Unknown error";
      if (e.result && e.result.error) {
        const er = e.result.error;
        return (er.code ? er.code + " " : "") + (er.status ? er.status + " " : "") + (er.message || asStr(er));
      }
      if (e.body && typeof e.body === "string") {
        const j = JSON.parse(e.body);
        if (j?.error?.message) return j.error.message;
        if (j?.error_description) return j.error_description;
        return asStr(j);
      }
      if (e.message) return e.message;
      if (e.statusText) return e.statusText;
      return asStr(e);
    } catch { return asStr(e); }
  }
  function toJson(res) {
    if (!res) return null;
    if (res.result) return res.result;
    if (typeof res.body === "string") {
      try { return JSON.parse(res.body); } catch { return null; }
    }
    return null;
  }
  function emit() {
    const snapshot = { ready: !!accessToken, user: currentUser };
    listeners.forEach(cb => { try { cb(snapshot); } catch {} });
  }

  // --- load GIS/gapi ---
  function waitForGIS(ms = 10000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        if (window.google?.accounts?.oauth2) return resolve();
        if (Date.now() - t0 > ms) return reject(new Error("Google Identity Services not loaded"));
        setTimeout(poll, 50);
      })();
    });
  }
  function waitForGapi(ms = 10000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        if (window.gapi?.load) return resolve();
        if (Date.now() - t0 > ms) return reject(new Error("Google API client not loaded"));
        setTimeout(poll, 50);
      })();
    });
  }
  async function ensureGapiInit() {
    if (gapiReady) return;
    await waitForGapi();
    await new Promise((resolve, reject) => {
      gapi.load("client", async () => {
        try {
          await gapi.client.init({
            apiKey: (window.PC_CONFIG || {}).GOOGLE_DRIVE_API_KEY,
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
          });
          gapiReady = true;
          log("gapi client ready (Drive discovery loaded)");
          resolve();
        } catch (e) { reject(e); }
      });
    });
  }
  async function ensureTokenClient() {
    await waitForGIS();
    if (tokenClient) return tokenClient;
    const cfg = window.PC_CONFIG || {};
    if (!cfg.GOOGLE_OAUTH_CLIENT_ID) throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID");
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.GOOGLE_OAUTH_CLIENT_ID,
      scope: SCOPES,
      // callback set per request
    });
    return tokenClient;
  }

  // --- token acquisition ---
  async function requestToken(promptValue, timeoutMs) {
    await ensureTokenClient();
    await ensureGapiInit();
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error("Timed out waiting for token")); }
      }, timeoutMs);

      tokenClient.callback = (resp) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          if (window.gapi?.client) gapi.client.setToken({ access_token: accessToken });
          localStorage.setItem(LS.LAST_OK, new Date().toISOString());
          resolve(accessToken);
        } else {
          reject(new Error("No access token returned"));
        }
      };

      try { tokenClient.requestAccessToken({ prompt: promptValue }); }
      catch (e) { clearTimeout(timer); if (!settled) { settled = true; reject(e); } }
    });
  }

  async function attemptSilentToken() {
    try {
      log("Silent token attempt…");
      await requestToken("", 9000);
      localStorage.setItem(LS.SEEN_CONSENT, "1");
      await refreshUser();
      emit();
      log("Silent token OK");
      return true;
    } catch (e) {
      log("Silent token failed:", parseGapiError(e));
      return false;
    }
  }

  async function interactiveToken() {
    log("Interactive consent…");
    await requestToken("consent", 20000);
    localStorage.setItem(LS.SEEN_CONSENT, "1");
    await refreshUser();
    emit();
    log("Interactive token OK");
    return true;
  }

  async function refreshUser() {
    try {
      if (!accessToken) { currentUser = null; return; }
      await ensureGapiInit();
      const about = await gapi.client.drive.about.get({ fields: "user(displayName,emailAddress)" });
      const j = toJson(about);
      currentUser = j?.user || null;
    } catch (e) {
      log("User fetch failed:", parseGapiError(e));
      currentUser = null;
    }
  }

  // --- public lifecycle helpers ---
  async function ensureReady(interactive = false) {
    if (accessToken) return true;
    // Always try silent first (works if user has already consented on this origin)
    const okSilent = await attemptSilentToken();
    if (okSilent) return true;
    if (interactive) {
      // Needs a user gesture (click). Caller should pass interactive=true when user clicks Sign in.
      await interactiveToken();
      return true;
    }
    return false;
  }

  function isReady() { return !!accessToken; }
  function getUser() { return currentUser; }
  function onStatus(cb) { if (typeof cb === "function") listeners.add(cb); return () => listeners.delete(cb); }

  async function signInInteractive() {
    await interactiveToken();
    return { ready: isReady(), user: getUser() };
  }

  function signOut() {
    accessToken = null;
    currentUser = null;
    emit();
  }

  // --- folders & upload (your existing behavior, preserved) ---
  async function gapiCall(fn) {
    try { return toJson(await fn()); }
    catch (e) { throw new Error(parseGapiError(e)); }
  }

  async function findOrCreateFolder(name, parentId) {
    const q =
      "name = '" + String(name).replace(/'/g, "\\'") +
      "' and mimeType = 'application/vnd.google-apps.folder' and '" +
      parentId + "' in parents and trashed = false";

    const list = await gapiCall(() =>
      gapi.client.drive.files.list({ q, fields: "files(id,name)" })
    );
    const got = (list && list.files) || [];
    if (got.length) return got[0].id;

    const created = await gapiCall(() =>
      gapi.client.drive.files.create({
        resource: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
        fields: "id",
      })
    );
    if (!created || !created.id) throw new Error("Failed creating folder: " + name);
    return created.id;
  }

  async function getOrCreatePropcheckTree() {
    const propId = await findOrCreateFolder("PropCheck", "root");
    const dealsId = await findOrCreateFolder("Deals", propId);
    return { propId, dealsId };
  }

  function defaultFilename(deal) {
    const base = (deal && (deal.title || "Property")).trim().slice(0, 80) || "Property";
    const date = new Date().toISOString().slice(0, 10);
    return `${base} - ${date}.json`;
  }

  async function startResumableSession(metadata, contentLength) {
    const initUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,parents,webViewLink";
    const res = await fetch(initUrl, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/json",
        "X-Upload-Content-Length": String(contentLength)
      },
      body: JSON.stringify(metadata)
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> "");
      throw new Error(`Resumable init failed: ${res.status} ${res.statusText || ""} ${text}`.trim());
    }
    const sessionUrl = res.headers.get("Location");
    if (!sessionUrl) throw new Error("Resumable init failed: missing upload session URL");
    return sessionUrl;
  }

  async function uploadJsonResumable(obj, dealsFolderId) {
    const filename = defaultFilename(obj);
    const payload = new TextEncoder().encode(JSON.stringify(obj, null, 2));
    const metadata = { name: filename, parents: [dealsFolderId], mimeType: "application/json" };
    const sessionUrl = await startResumableSession(metadata, payload.byteLength);
    const res = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Content-Length": String(payload.byteLength) },
      body: payload
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> "");
      throw new Error(`Resumable upload failed: ${res.status} ${res.statusText || ""} ${text}`.trim());
    }
    return await res.json(); // { id, name, parents?, webViewLink? }
  }

  async function ensureInDeals(fileId, dealsId) {
    const file = await gapiCall(() =>
      gapi.client.drive.files.get({ fileId, fields: "id,name,parents" })
    );
    const parents = file.parents || [];
    if (parents.includes(dealsId)) return file;

    const remove = parents.length ? parents.join(",") : undefined;
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set("addParents", dealsId);
    if (remove) url.searchParams.set("removeParents", remove);
    url.searchParams.set("fields", "id,name,parents,webViewLink");

    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> "");
      throw new Error(`Move failed: ${res.status} ${res.statusText || ""} ${text}`.trim());
    }
    return await res.json();
  }

  async function uploadJsonToDrive(obj) {
    // Ensure we’re ready; ask for interactive consent if needed (must be called from a click)
    const ok = await ensureReady(false);
    if (!ok) throw new Error("Not signed in to Google Drive");
    const { dealsId } = await getOrCreatePropcheckTree();
    const uploaded = await uploadJsonResumable(obj, dealsId);
    const finalFile = await ensureInDeals(uploaded.id, dealsId);
    return finalFile;
  }

  // --- public API ---
  window.PCDrive = {
    // 1) call this once per page (see snippet below)
    async autoInit() {
      // try silent refresh; never prompts
      await ensureReady(false);
      await refreshUser(); // harmless if not ready
      emit();
    },

    // 2) expose sign-in/out for any UI you add
    async signIn() { await ensureReady(true); await refreshUser(); emit(); return { ready: isReady(), user: getUser() }; },
    signOut() { signOut(); },

    // 3) status & user
    isReady,
    getUser,
    onStatus, // cb({ready:boolean, user:{displayName,emailAddress}|null}) => unsubscribe()

    // 4) your existing save entrypoint
    async saveDealToDrive(deal) {
      if (!deal || typeof deal !== "object") throw new Error("No deal to save");
      const enriched = Object.assign({}, deal, { savedAt: new Date().toISOString() });
      try {
        const res = await uploadJsonToDrive(enriched);
        return res; // { id, name, parents, webViewLink }
      } catch (e) {
        const msg = e?.message || asStr(e);
        throw new Error("Drive save failed: " + msg);
      }
    }
  };
})();




// PropCheck — Google Drive client (auth delegated to PCAuth)
// Goals:
// - No automatic popups (silent only on page load)
// - One token shared across pages (via PCAuth/sessionStorage)
// - Keep existing PCDrive API so pages don’t need to change

(function () {
  const SCOPES =
    "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

  // --- internal state ---
  let gapiReady = false;
  let ready = false;               // true when we have a valid token set on gapi
  let currentUser = null;          // { displayName, emailAddress }
  const listeners = new Set();     // for header chip status updates

  // --- utils ---
  const log = (...a) => { try { console.log("[PCDrive]", ...a); } catch {} };
  const asStr = (v) => (typeof v === "string" ? v : JSON.stringify(v));
  const toJson = (res) => {
    if (!res) return null;
    if (res.result) return res.result;
    if (typeof res.body === "string") { try { return JSON.parse(res.body); } catch { return null; } }
    return null;
  };
  function emit() {
    const snap = { ready, user: currentUser };
    listeners.forEach(cb => { try { cb(snap); } catch {} });
  }
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

  // --- gapi bootstrap (Drive discovery only; no token work here) ---
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
          const cfg = window.PC_CONFIG || {};
          await gapi.client.init({
            apiKey: cfg.GOOGLE_DRIVE_API_KEY,
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
          });
          gapiReady = true;
          log("gapi ready (Drive discovery loaded)");
          resolve();
        } catch (e) { reject(e); }
      });
    });
  }

  // --- token helpers (delegated to PCAuth) ---
  function getBearer() {
    // Prefer gapi token; fall back to PCAuth getter
    const t = (window.gapi?.client?.getToken && gapi.client.getToken()) || {};
    const access = t.access_token || (window.PCAuth && PCAuth.getAccessTokenOrNull && PCAuth.getAccessTokenOrNull());
    return access || null;
  }

  async function ensureReady(interactive = false) {
    // 1) Make sure gapi client is initialized
    await ensureGapiInit();

    // 2) Ask PCAuth to make sure there is a token.
    //    - interactive=false on page load (silent attempt; no popup)
    //    - interactive=true on user click (allowed to show popup)
    if (window.PCAuth && typeof PCAuth.ensureAuth === "function") {
      const token = await PCAuth.ensureAuth(interactive);
      ready = !!token;
      // PCAuth ensures gapi.client.setToken({access_token})
    } else {
      log("PCAuth not found — include drive.auth.helper.js before drive.js");
      ready = false;
    }

    // 3) Fetch user info if ready (for the header chip)
    if (ready) {
      try {
        const about = await gapi.client.drive.about.get({ fields: "user(displayName,emailAddress)" });
        currentUser = (toJson(about) || {}).user || null;
      } catch (e) {
        log("About failed:", parseGapiError(e));
        currentUser = null;
      }
    } else {
      currentUser = null;
    }

    emit();
    return ready;
  }

  // --- Drive helpers (unchanged behavior) ---
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
    const token = getBearer();
    if (!token) throw new Error("Not signed in to Google Drive");
    const initUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,parents,webViewLink";
    const res = await fetch(initUrl, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
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
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(payload.byteLength)
      },
      body: payload
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> "");
      throw new Error(`Resumable upload failed: ${res.status} ${res.statusText || ""} ${text}`.trim());
    }
    return await res.json(); // { id, name, parents?, webViewLink? }
  }

  async function ensureInDeals(fileId, dealsId) {
    const token = getBearer();
    if (!token) throw new Error("Not signed in to Google Drive");

    const file = await gapiCall(() =>
      gapi.client.drive.files.get({ fileId, fields: "id,name,parents" })
    );
    const parents = (file && file.parents) || [];
    if (parents.includes(dealsId)) return file;

    const remove = parents.length ? parents.join(",") : undefined;
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set("addParents", dealsId);
    if (remove) url.searchParams.set("removeParents", remove);
    url.searchParams.set("fields", "id,name,parents,webViewLink");

    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: {
        "Authorization": "Bearer " + token,
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
    const ok = await ensureReady(false);        // will not prompt; caller should have clicked already
    if (!ok) throw new Error("Not signed in to Google Drive");
    const { dealsId } = await getOrCreatePropcheckTree();
    const uploaded = await uploadJsonResumable(obj, dealsId);
    const finalFile = await ensureInDeals(uploaded.id, dealsId);
    return finalFile;
  }

  // --- public API (matches current usage on your pages) ---
  window.PCDrive = {
    // Called on DOMContentLoaded by your pages to silently hydrate header chip (no popups).
    // (Index/reports/etc already do this):contentReference[oaicite:3]{index=3}:contentReference[oaicite:4]{index=4}
    async autoInit() {
      try {
        await ensureReady(false);   // silent
      } catch (e) {
        log("autoInit error:", e?.message || e);
        ready = false; currentUser = null;
      }
      emit();
    },

    // Used by the header button: explicit user-initiated sign-in (allows popup)
    async signIn() {
      await ensureReady(true);      // interactive
      emit();
      return { ready, user: currentUser };
    },

    // Used by the header button to clear local token; no server revoke (matches your intent)
    signOut() {
      try {
        if (window.PCAuth && typeof PCAuth.signOutLocalOnly === "function") {
          PCAuth.signOutLocalOnly();
        }
      } finally {
        if (window.gapi?.client) gapi.client.setToken(null);
        ready = false;
        currentUser = null;
        emit();
      }
    },

    isReady() { return !!ready; },
    getUser() { return currentUser; },
    onStatus(cb) { if (typeof cb === "function") { listeners.add(cb); return () => listeners.delete(cb); } return () => {}; },

    // Your existing save entrypoint used across pages
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





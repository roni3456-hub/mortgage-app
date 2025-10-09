// PropCheck → Google Drive uploader with full error parsing & robust init
(function () {
  const SCOPES =
    "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

  let gapiReady = false;
  let accessToken = null;
  let tokenClient = null;

  // ------------ small utils ------------
  const log = (...a) => { try { console.log("[PCDrive]", ...a); } catch {} };
  const asStr = (v) => (typeof v === "string" ? v : JSON.stringify(v));
  function parseGapiError(e) {
    try {
      // gapi errors can be in several shapes; normalize them
      if (!e) return "Unknown error";
      if (e.result && e.result.error) {
        const er = e.result.error;
        if (er.message) return `${er.code || ""} ${er.status || ""} ${er.message}`.trim();
        return asStr(er);
      }
      if (e.body && typeof e.body === "string") {
        const j = JSON.parse(e.body);
        if (j && j.error && (j.error.message || j.error_description)) {
          return (j.error.message || j.error_description);
        }
        return asStr(j);
      }
      if (e.message) return e.message;
      if (e.statusText) return e.statusText;
      return asStr(e);
    } catch {
      return asStr(e);
    }
  }
  function toJson(res) {
    if (!res) return null;
    if (res.result) return res.result;
    if (typeof res.body === "string") {
      try { return JSON.parse(res.body); } catch { return null; }
    }
    return null;
  }

  // ------------ load GIS / gapi ------------
  function waitForGIS(ms = 10000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        if (window.google && google.accounts && google.accounts.oauth2) return resolve();
        if (Date.now() - t0 > ms) return reject(new Error("Google Identity Services not loaded"));
        setTimeout(poll, 50);
      })();
    });
  }

  async function ensureGapiInit() {
    if (gapiReady) return;
    // wait for gapi script tag to exist
    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        if (window.gapi && gapi.load) return resolve();
        if (Date.now() - t0 > 10000) return reject(new Error("Google API client not loaded"));
        setTimeout(poll, 50);
      })();
    });
    // init client + Drive discovery
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
        } catch (e) {
          reject(e);
        }
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

  async function obtainAccessTokenFromUserGesture() {
    function attempt(promptValue, timeoutMs) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error("Timed out waiting for token"));
          }
        }, timeoutMs);

        tokenClient.callback = (resp) => {
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          if (resp && resp.access_token) {
            accessToken = resp.access_token;
            if (window.gapi && gapi.client) gapi.client.setToken({ access_token: accessToken });
            resolve(accessToken);
          } else {
            reject(new Error("No access token returned"));
          }
        };

        try {
          tokenClient.requestAccessToken({ prompt: promptValue });
        } catch (e) {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            reject(e);
          }
        }
      });
    }

    try {
      log("Token (silent) …");
      return await attempt("", 9000);
    } catch {
      log("Silent failed → consent …");
      return await attempt("consent", 20000);
    }
  }

  async function ensureDriveAuthFromClick() {
    const cfg = window.PC_CONFIG || {};
    if (!cfg.GOOGLE_DRIVE_API_KEY) throw new Error("Missing GOOGLE_DRIVE_API_KEY");
    await ensureTokenClient();
    await ensureGapiInit();
    if (!accessToken) await obtainAccessTokenFromUserGesture();
  }

  // ------------ Drive helpers ------------
  async function gapiCall(fn) {
    try {
      const res = await fn();
      return toJson(res);
    } catch (e) {
      throw new Error(parseGapiError(e));
    }
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

  function makeMultipart(metadata, blob) {
    const boundary = "propcheck_" + Math.random().toString(36).slice(2);
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelim = "\r\n--" + boundary + "--";
    const metaPart = new Blob([
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
    ]);

    return {
      type: "multipart/related; boundary=" + boundary,
      body: new Blob([
        delimiter, metaPart, "\r\n", delimiter,
        "Content-Type: " + (blob.type || "application/json") + "\r\n\r\n",
        blob, closeDelim
      ]),
    };
  }

  function defaultFilename(deal) {
    const base = (deal && (deal.title || "Property")).trim().slice(0, 80) || "Property";
    const date = new Date().toISOString().slice(0, 10);
    return `${base} - ${date}.json`;
  }

  async function uploadJsonToDrive(obj) {
    await ensureDriveAuthFromClick();

    const propcheckId = await findOrCreateFolder("PropCheck", "root");
    const dealsId = await findOrCreateFolder("Deals", propcheckId);

    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const meta = { name: defaultFilename(obj), mimeType: "application/json", parents: [dealsId] };
    const mp = makeMultipart(meta, blob);

    const up = await gapiCall(() =>
      gapi.client.request({
        path: "/upload/drive/v3/files",
        method: "POST",
        params: { uploadType: "multipart" },
        headers: { "Content-Type": mp.type },
        body: mp.body,
      })
    );

    if (!up || !up.id) throw new Error("Upload failed");

    const file = await gapiCall(() =>
      gapi.client.drive.files.get({ fileId: up.id, fields: "id,name,webViewLink" })
    );
    return file;
  }

  // ------------ Public API ------------
  window.PCDrive = {
    async saveDealToDrive(deal) {
      if (!deal || typeof deal !== "object") throw new Error("No deal to save");
      const enriched = Object.assign({}, deal, { savedAt: new Date().toISOString() });
      try {
        const res = await uploadJsonToDrive(enriched);
        return res; // { id, name, webViewLink }
      } catch (e) {
        throw new Error("Drive save failed: " + parseGapiError(e));
      }
    },
  };
})();

// assets/js/drive.js
// PropCheck → Google Drive JSON uploader (incremental OAuth + gapi client)
(function () {
  const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

  let gapiReady = false;
  let tokenClient = null;
  let accessToken = null;

  function diag(...a){ try{ console.log("[PCDrive]", ...a); }catch(_){} }

  function requireConfig(){
    if (!window.PC_CONFIG) throw new Error("PC_CONFIG missing");
    if (!PC_CONFIG.GOOGLE_DRIVE_API_KEY) throw new Error("GOOGLE_DRIVE_API_KEY missing");
    if (!PC_CONFIG.GOOGLE_OAUTH_CLIENT_ID) throw new Error("GOOGLE_OAUTH_CLIENT_ID missing");
  }

  function ensureGapiInit(){
    return new Promise((resolve) => {
      if (gapiReady) return resolve();
      if (!window.gapi || !gapi.load) return resolve(); // gapi script not present; caller should include it
      gapi.load("client", async () => {
        await gapi.client.init({ apiKey: PC_CONFIG.GOOGLE_DRIVE_API_KEY });
        gapiReady = true;
        diag("gapi client ready");
        resolve();
      });
    });
  }

  function ensureTokenClient(){
    if (tokenClient) return;
    if (!window.google || !google.accounts || !google.accounts.oauth2){
      throw new Error("Google Identity Services not loaded");
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: PC_CONFIG.GOOGLE_OAUTH_CLIENT_ID,
      scope: SCOPES,
      prompt: "", // consent will appear first time
      callback: (resp) => {
        if (resp && resp.access_token){
          accessToken = resp.access_token;
          if (window.gapi && gapi.client) gapi.client.setToken({ access_token: accessToken });
          diag("access token acquired");
        } else {
          diag("no access token returned", resp);
        }
      }
    });
  }

  async function ensureDriveAuth(){
    requireConfig();
    ensureTokenClient();
    if (!accessToken){
      diag("requesting access token…");
      await new Promise((resolve, reject) => {
        let t = setTimeout(() => reject(new Error("Timeout obtaining token")), 8000);
        tokenClient.requestAccessToken({ prompt: "" });  // must be called from a user gesture
        (function wait(){
          if (accessToken){ clearTimeout(t); return resolve(); }
          setTimeout(wait, 50);
        })();
      });
    }
    await ensureGapiInit();
  }

  async function findOrCreateFolder(name, parentId){
    const q = "name = '" + String(name).replace(/'/g, "\\'") + "' and mimeType = 'application/vnd.google-apps.folder' and '" + parentId + "' in parents and trashed = false";
    const list = await gapi.client.drive.files.list({ q, fields: "files(id,name)" });
    if (list.result.files && list.result.files.length) return list.result.files[0].id;
    const created = await gapi.client.drive.files.create({
      resource: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
      fields: "id"
    });
    return created.result.id;
  }

  function makeMultipart(metadata, blob){
    const boundary = "propcheck_" + Math.random().toString(36).slice(2);
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelim = "\r\n--" + boundary + "--";
    const metaPart = new Blob(["Content-Type: application/json; charset=UTF-8\r\n\r\n", JSON.stringify(metadata)]);
    return {
      type: "multipart/related; boundary=" + boundary,
      body: new Blob([delimiter, metaPart, "\r\n", delimiter, "Content-Type: " + (blob.type || "application/json") + "\r\n\r\n", blob, closeDelim])
    };
  }

  function defaultFilename(deal){
    const base = (deal && deal.title ? String(deal.title) : "Property").trim().slice(0, 80) || "Property";
    const date = new Date().toISOString().slice(0,10);
    return `${base} - ${date}.json`;
  }

  async function uploadJsonToDrive(obj){
    await ensureDriveAuth();

    // Folder: /PropCheck/Deals
    const propcheckId = await findOrCreateFolder("PropCheck", "root");
    const dealsId = await findOrCreateFolder("Deals", propcheckId);

    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const meta = { name: defaultFilename(obj), mimeType: "application/json", parents: [dealsId] };
    const mp = makeMultipart(meta, blob);

    const upload = await gapi.client.request({
      path: "/upload/drive/v3/files",
      method: "POST",
      params: { uploadType: "multipart" },
      headers: { "Content-Type": mp.type },
      body: mp.body
    });

    const file = await gapi.client.drive.files.get({ fileId: upload.result.id, fields: "id,name,webViewLink" });
    return file.result;
  }

  // Public API
  window.PCDrive = {
    /**
     * Saves the current deal JSON to Google Drive (PropCheck/Deals).
     * Requires that the user signed in with Google (so we have a Google account context).
     * Must be called from a click/tap handler to allow OAuth popup/consent.
     */
    async saveDealToDrive(deal){
      if (!deal || typeof deal !== "object") throw new Error("No deal to save");
      const user = window.PCState && PCState.getUser ? PCState.getUser() : null;
      if (!user || user.mode !== "google") throw new Error("Sign in with Google to save to Drive");

      const enriched = Object.assign({}, deal, {
        savedBy: { name: user.name || "", email: user.email || "" },
        savedAt: new Date().toISOString()
      });

      const res = await uploadJsonToDrive(enriched);
      return res; // { id, name, webViewLink }
    }
  };
})();

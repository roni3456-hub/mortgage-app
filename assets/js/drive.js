// PropCheck → Google Drive JSON uploader (robust GIS + gapi init, retry with consent)
(function () {
  const SCOPES =
    "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

  let gapiReady = false;
  let accessToken = null;
  let tokenClient = null;

  function log(...a){ try{ console.log("[PCDrive]", ...a);}catch{} }

  function requireConfig(){
    if (!window.PC_CONFIG) throw new Error("PC_CONFIG missing");
    if (!PC_CONFIG.GOOGLE_DRIVE_API_KEY) throw new Error("GOOGLE_DRIVE_API_KEY missing");
    if (!PC_CONFIG.GOOGLE_OAUTH_CLIENT_ID) throw new Error("GOOGLE_OAUTH_CLIENT_ID missing");
  }

  // Wait until the GIS library is present
  function waitForGIS(ms=8000){
    return new Promise((resolve, reject)=>{
      const start = Date.now();
      (function poll(){
        if (window.google && google.accounts && google.accounts.oauth2) return resolve();
        if (Date.now() - start > ms) return reject(new Error("Google Identity Services (GIS) not loaded"));
        setTimeout(poll, 50);
      })();
    });
  }

  // Wait until gapi is present, then init the client with our API key
  function ensureGapiInit(){
    return new Promise((resolve, reject)=>{
      if (gapiReady) return resolve();
      if (!window.gapi || !gapi.load){
        // Wait briefly for the script tag to finish loading
        const start = Date.now();
        (function poll(){
          if (window.gapi && gapi.load){
            gapi.load("client", async () => {
              try{
                await gapi.client.init({ apiKey: PC_CONFIG.GOOGLE_DRIVE_API_KEY });
                gapiReady = true;
                log("gapi client ready");
                resolve();
              }catch(e){ reject(e); }
            });
            return;
          }
          if (Date.now() - start > 8000) return reject(new Error("Google API client (gapi) not loaded"));
          setTimeout(poll, 50);
        })();
        return;
      }
      gapi.load("client", async () => {
        try{
          await gapi.client.init({ apiKey: PC_CONFIG.GOOGLE_DRIVE_API_KEY });
          gapiReady = true;
          log("gapi client ready");
          resolve();
        }catch(e){ reject(e); }
      });
    });
  }

  async function ensureTokenClient(){
    await waitForGIS();
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: PC_CONFIG.GOOGLE_OAUTH_CLIENT_ID,
      scope: SCOPES,
      // NOTE: we'll set the callback right before each request (per GIS best practice)
    });
    return tokenClient;
  }

  // Try to fetch an access token; first attempt with no prompt (silent),
  // then retry with prompt:'consent' if nothing returns quickly.
  async function obtainAccessTokenFromUserGesture(){
    requireConfig();
    await ensureTokenClient();

    // Helper to make one attempt
    function attempt({ promptValue, timeoutMs }){
      return new Promise((resolve, reject)=>{
        let settled = false;
        const timer = setTimeout(()=>{
          if (settled) return;
          settled = true;
          reject(new Error("Timed out waiting for token"));
        }, timeoutMs);

        // Set the callback each time before requesting
        tokenClient.callback = (resp) => {
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          if (resp && resp.access_token){
            accessToken = resp.access_token;
            if (window.gapi && gapi.client) gapi.client.setToken({ access_token: accessToken });
            resolve(accessToken);
          } else {
            reject(new Error("No access token returned"));
          }
        };

        try{
          tokenClient.requestAccessToken({ prompt: promptValue });
        }catch(e){
          clearTimeout(timer);
          if (!settled){
            settled = true;
            reject(e);
          }
        }
      });
    }

    // First: silent/auto attempt (no prompt). If it hangs, we retry with consent.
    try{
      log("Requesting token (silent)...");
      await attempt({ promptValue: "", timeoutMs: 9000 });
      log("Token acquired silently");
      return accessToken;
    }catch(_silentErr){
      log("Silent token attempt failed/timeout; retrying with consent…");
    }

    // Retry WITH consent prompt (this will open a popup)
    try{
      const token = await attempt({ promptValue: "consent", timeoutMs: 20000 });
      log("Token acquired with consent");
      return token;
    }catch(e){
      // Common reasons: popup blocked, third-party cookies disabled, or user closed popup.
      throw new Error(
        "Could not obtain Google Drive permission. " +
        "If you didn't see a Google popup, please allow pop-ups for this site and try again."
      );
    }
  }

  async function ensureDriveAuthFromClick(){
    // This must be called from a user click/tap handler
    await waitForGIS();                 // ensure GIS is ready
    await ensureGapiInit();             // ensure gapi client is ready
    if (!accessToken) {
      await obtainAccessTokenFromUserGesture();
    }
  }

  async function findOrCreateFolder(name, parentId){
    const q = "name = '" + String(name).replace(/'/g, "\\'") +
              "' and mimeType = 'application/vnd.google-apps.folder' and '" +
              parentId + "' in parents and trashed = false";
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
    const metaPart = new Blob([
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata)
    ]);
    return {
      type: "multipart/related; boundary=" + boundary,
      body: new Blob([delimiter, metaPart, "\r\n", delimiter,
        "Content-Type: " + (blob.type || "application/json") + "\r\n\r\n",
        blob, closeDelim])
    };
  }

  function defaultFilename(deal){
    const base = (deal && (deal.title || "Property")).trim().slice(0,80) || "Property";
    const date = new Date().toISOString().slice(0,10);
    return `${base} - ${date}.json`;
  }

  async function uploadJsonToDrive(obj){
    await ensureDriveAuthFromClick();

    // Ensure /PropCheck/Deals exists
    const propcheckId = await findOrCreateFolder("PropCheck", "root");
    const dealsId     = await findOrCreateFolder("Deals", propcheckId);

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

    const file = await gapi.client.drive.files.get({
      fileId: upload.result.id,
      fields: "id,name,webViewLink"
    });

    return file.result;
  }

  // Public API
  window.PCDrive = {
    /**
     * Call this from a user click handler (e.g., on "Save to Drive" button).
     * It will prompt the user for Drive consent the first time, then upload JSON to /PropCheck/Deals.
     */
    async saveDealToDrive(deal){
      if (!deal || typeof deal !== "object") throw new Error("No deal to save");
      // (User Google sign-in is recommended but not strictly required for token client.)
      const enriched = Object.assign({}, deal, { savedAt: new Date().toISOString() });
      return await uploadJsonToDrive(enriched);
    }
  };
})();

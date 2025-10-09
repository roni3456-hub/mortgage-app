// PropCheck → Google Drive JSON uploader (robust GIS + gapi init + response normalization)
(function () {
  const SCOPES =
    "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";

  let gapiReady = false;
  let accessToken = null;
  let tokenClient = null;

  function log(...a){ try{ console.log("[PCDrive]", ...a);}catch{} }
  function errMsg(e){ return (e && (e.message || e.statusText)) || String(e || "Unknown error"); }

  function requireConfig(){
    if (!window.PC_CONFIG) throw new Error("PC_CONFIG missing");
    if (!PC_CONFIG.GOOGLE_DRIVE_API_KEY) throw new Error("GOOGLE_DRIVE_API_KEY missing");
    if (!PC_CONFIG.GOOGLE_OAUTH_CLIENT_ID) throw new Error("GOOGLE_OAUTH_CLIENT_ID missing");
  }

  function waitForGIS(ms=10000){
    return new Promise((resolve, reject)=>{
      const start = Date.now();
      (function poll(){
        if (window.google && google.accounts && google.accounts.oauth2) return resolve();
        if (Date.now() - start > ms) return reject(new Error("Google Identity Services not loaded"));
        setTimeout(poll, 50);
      })();
    });
  }

  // Normalize gapi client responses (sometimes uses .result, sometimes only .body)
  function toJson(res){
    if (!res) return null;
    if (res.result) return res.result;
    if (typeof res.body === "string") {
      try { return JSON.parse(res.body); } catch { return null; }
    }
    return null;
  }

  async function ensureGapiInit(){
    if (gapiReady) return;
    await new Promise((resolve, reject)=>{
      const start = Date.now();
      (function poll(){
        if (window.gapi && gapi.load) return resolve();
        if (Date.now() - start > 10000) return reject(new Error("Google API client not loaded"));
        setTimeout(poll, 50);
      })();
    });

    // Load client + Drive discovery
    await new Promise((resolve, reject)=>{
      gapi.load("client", async () => {
        try{
          await gapi.client.init({
            apiKey: PC_CONFIG.GOOGLE_DRIVE_API_KEY,
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"]
          });
          gapiReady = true;
          log("gapi client ready (with Drive discovery)");
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
      scope: SCOPES
      // callback is set per-request below
    });
    return tokenClient;
  }

  // Try silent, then consent
  async function obtainAccessTokenFromUserGesture(){
    function attempt(promptValue, timeoutMs){
      return new Promise((resolve, reject)=>{
        let settled = false;
        const timer = setTimeout(()=>{
          if (!settled){ settled = true; reject(new Error("Timed out waiting for token")); }
        }, timeoutMs);

        tokenClient.callback = (resp)=>{
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          if (resp && resp.access_token){
            accessToken = resp.access_token;
            gapi.client.setToken({ access_token: accessToken });
            return resolve(accessToken);
          }
          reject(new Error("No access token returned"));
        };

        try { tokenClient.requestAccessToken({ prompt: promptValue }); }
        catch(e){ clearTimeout(timer); if(!settled){settled=true; reject(e);} }
      });
    }

    try{
      log("Token (silent) …");
      return await attempt("", 9000);
    }catch{
      log("Silent failed → consent …");
      return await attempt("consent", 20000);
    }
  }

  async function ensureDriveAuthFromClick(){
    requireConfig();
    await ensureTokenClient();
    await ensureGapiInit();
    if (!accessToken) await obtainAccessTokenFromUserGesture();
  }

  async function findOrCreateFolder(name, parentId){
    const q =
      "name = '" + String(name).replace(/'/g, "\\'") +
      "' and mimeType = 'application/vnd.google-apps.folder' and '" +
      parentId + "' in parents and trashed = false";
    const listRes = await gapi.client.drive.files.list({ q, fields: "files(id,name)" });
    const list = toJson(listRes);
    const files = (list && list.files) || [];
    if (files.length) return files[0].id;

    const createRes = await gapi.client.drive.files.create({
      resource: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
      fields: "id"
    });
    const created = toJson(createRes);
    if (!created || !created.id) throw new Error("Failed creating folder: " + name);
    return created.id;
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

    // Ensure /PropCheck/Deals
    const propcheckId = await findOrCreateFolder("PropCheck", "root");
    const dealsId = await findOrCreateFolder("Deals", propcheckId);

    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const meta = { name: defaultFilename(obj), mimeType: "application/json", parents: [dealsId] };
    const mp = makeMultipart(meta, blob);

    const upRes = await gapi.client.request({
      path: "/upload/drive/v3/files",
      method: "POST",
      params: { uploadType: "multipart" },
      headers: { "Content-Type": mp.type },
      body: mp.body
    });
    const up = toJson(upRes);
    if (!up || !up.id) throw new Error("Upload failed");

    const getRes = await gapi.client.drive.files.get({ fileId: up.id, fields: "id,name,webViewLink" });
    const file = toJson(getRes);
    return file;
  }

  // Public API
  window.PCDrive = {
    async saveDealToDrive(deal){
      if (!deal || typeof deal !== "object") throw new Error("No deal to save");
      const enriched = Object.assign({}, deal, { savedAt: new Date().toISOString() });
      try{
        const res = await uploadJsonToDrive(enriched);
        return res; // { id, name, webViewLink }
      }catch(e){
        throw new Error("Drive save failed: " + errMsg(e));
      }
    }
  };
})();

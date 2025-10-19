// assets/js/common.js
// Nav stays text-only; active tab highlight; ensure the first content heading (H1/H2/H3) starts with its emoji.
// Works even if other scripts re-render later.

(function () {
  // --- ROUTE + CONFIG ---
  function getRoute() {
    const path = location.pathname.replace(/\/+$/, '');
    const name = path.split('/').pop() || 'index.html';
    return (name.replace('.html','') || 'index');
  }
  const CONFIG = {
    index:         { emoji: '🏠', label: 'home' },
    calculator:    { emoji: '🏠', label: 'calculator' }, // you’ve been using 🏠 for Calc
    analysis:      { emoji: '📊', label: 'analysis' },
    compare:       { emoji: '⚖️', label: 'compare' },
    reports:       { emoji: '📋', label: 'reports' },
    market:        { emoji: '🏙️', label: 'market' },
    qualification: { emoji: '🏦', label: 'qualification' }
  };
  const KNOWN = new Set(Object.values(CONFIG).map(c => c.emoji));

  // --- ACTIVE NAV (no emoji injection in nav) ---
  function applyActiveNav(route) {
    document.querySelectorAll('.nav a').forEach(a => {
      const href = a.getAttribute('href') || '';
      const isIndex = route === 'index' && /index\.html$/i.test(href);
      const isMatch = route !== 'index' && new RegExp(route + '\\.html$', 'i').test(href);
      const active = isIndex || isMatch;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });
  }

  // --- EMOJI ENFORCER on first real page heading (H1/H2/H3 not inside header/nav) ---
  function applyHeadingEmoji(route) {
    const cfg = CONFIG[route];
    if (!cfg) return;

    // Prefer headings inside <main>, but fall back to the first heading in the body
    const candidates = Array.from(
      document.querySelectorAll('main h1, main h2, main h3, body h1, body h2, body h3')
    ).filter(h => !h.closest('header,.site-header,.nav'));

    const h = candidates[0];
    if (!h) return;

    const span = h.querySelector('span.emoji');
    if (span) {
      if (span.textContent !== cfg.emoji) span.textContent = cfg.emoji;
      span.setAttribute('aria-label', cfg.label);
      return;
    }

    const raw = (h.textContent || '').trim();
    const first = raw ? Array.from(raw)[0] : '';
    const rest = KNOWN.has(first) ? raw.slice(first.length).trimStart() : raw;

    h.innerHTML = `<span class="emoji hpad" role="img" aria-label="${cfg.label}">${cfg.emoji}</span>${rest}`;
  }

  // --- APPLY (initial + on DOM changes) ---
  function applyAll() {
    const route = getRoute();
    applyActiveNav(route);
    applyHeadingEmoji(route);
  }

  document.addEventListener('DOMContentLoaded', applyAll);
  window.addEventListener('load', applyAll);

  // Re-apply on dynamic changes
  let throttle;
  new MutationObserver(() => { clearTimeout(throttle); throttle = setTimeout(applyAll, 60); })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // simple debug flag
  window.__pc_common_js_loaded = true;
})();
// Unified "make sure we're signed in to Drive" helper
window.PC = window.PC || {};
PC.requireDrive = async function () {
  try {
    // Already good?
    if (PCDrive?.isReady && PCDrive.isReady()) return true;

    // Try to get/refresh a token (this is allowed because user clicked a button)
    const token = await (window.PCAuth?.ensureAuth?.(true) || Promise.resolve(null));
    return !!token || (PCDrive?.isReady && PCDrive.isReady());
  } catch {
    return false;
  }
};

/* =========================
   PCDriveUI: Global Drive Picker
   ========================= */
(function () {
  if (window.PCDriveUI) return; // avoid double init

  // Inject a reusable picker card into the page
  function injectPickerDOM() {
    if (document.getElementById("pcDrivePicker")) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="pcDrivePicker" class="card hidden" style="margin:16px 0;">
        <h3 class="title">Load from Google Drive</h3>
        <p class="muted">Choose a saved deal from <strong>Drive → PropCheck → Deals</strong>.</p>
        <div class="form-group">
          <label for="pcDriveFiles">Saved Files</label>
          <select id="pcDriveFiles"></select>
        </div>
        <div class="actions">
          <button id="pcDriveApply" class="btn btn-primary" type="button">Load Selected</button>
          <button id="pcDriveCancel" class="btn btn-secondary" type="button">Cancel</button>
        </div>
      </div>
    `;
    // Prefer placing inside <main>, else body
    const host = document.querySelector("main") || document.body;
    host.appendChild(wrap.firstElementChild);
  }

  async function waitForDriveClient(ms = 10000) {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      (function poll() {
        if (window.gapi?.client?.drive?.files) return resolve();
        if (Date.now() - t0 > ms) return reject(new Error("Drive client not ready"));
        setTimeout(poll, 50);
      })();
    });
  }

  async function ensureFolder(name, parentId) {
    const q =
      "name = '" + String(name).replace(/'/g, "\\'") +
      "' and mimeType = 'application/vnd.google-apps.folder' and '" +
      parentId + "' in parents and trashed = false";
    const list = await gapi.client.drive.files.list({ q, fields: "files(id,name)" });
    const files = list?.result?.files || [];
    if (files.length) return files[0].id;

    const created = await gapi.client.drive.files.create({
      resource: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
      fields: "id"
    });
    return created?.result?.id;
  }

  async function listDeals() {
    const propId  = await ensureFolder("PropCheck", "root");
    const dealsId = await ensureFolder("Deals", propId);
    const resp = await gapi.client.drive.files.list({
      q: `'${dealsId}' in parents and trashed = false and mimeType = 'application/json'`,
      orderBy: "modifiedTime desc",
      pageSize: 100,
      fields: "files(id,name,modifiedTime)"
    });
    return resp?.result?.files || [];
  }

  async function populateSelect(sel) {
    sel.innerHTML = "";
    const files = await listDeals();
    if (!files.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No saved deals found";
      sel.appendChild(opt);
      return [];
    }
    files.forEach(f => {
      const opt = document.createElement("option");
      const dt  = new Date(f.modifiedTime).toLocaleString();
      opt.value = f.id;
      opt.textContent = `${f.name}  —  ${dt}`;
      sel.appendChild(opt);
    });
    return files;
  }

  async function openPicker(onSelect /* optional */) {
    injectPickerDOM();

    // Ensure we have/refresh a token (popup only because the user clicked)
    const token = await (window.PCAuth?.ensureAuth?.(true) || Promise.resolve(null));
    if (!token) throw new Error("Sign-in failed or was cancelled.");

    await waitForDriveClient();

    const card  = document.getElementById("pcDrivePicker");
    const sel   = document.getElementById("pcDriveFiles");
    const apply = document.getElementById("pcDriveApply");
    const cancel= document.getElementById("pcDriveCancel");

    const files = await populateSelect(sel);
    card.classList.remove("hidden");
    window.scrollTo({ top: card.offsetTop - 10, behavior: "smooth" });

    return new Promise((resolve) => {
      function cleanup() {
        apply.removeEventListener("click", onApply);
        cancel.removeEventListener("click", onCancel);
        card.classList.add("hidden");
      }
      async function onApply() {
        const id = sel.value;
        if (!id) { alert("No file selected."); return; }
        try {
          const resp = await gapi.client.drive.files.get({ fileId: id, alt: "media" });
          let data = resp?.body ?? resp?.result;
          if (typeof data === "string") data = JSON.parse(data);
          const file = files.find(f => f.id === id) || { id, name: "Deal.json" };

          // Optional callback style
          if (typeof onSelect === "function") {
            try { await onSelect(file, data); } catch {}
          }

          cleanup();
          resolve({ file, deal: data });
        } catch (e) {
          alert("Load failed: " + (e?.message || e));
        }
      }
      function onCancel() {
        cleanup();
        resolve(null);
      }
      apply.addEventListener("click", onApply);
      cancel.addEventListener("click", onCancel);
    });
  }

  window.PCDriveUI = { openPicker };
})();





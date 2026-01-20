(function () {
  const params = new URLSearchParams(location.search);
  const id = (params.get("id") || "").trim();
  const eq = (params.get("eq") || "").trim();

  // =========================
  // Helpers: meta + per-equipment links
  // =========================

  // Pre-Firebase equipment metadata (stored on index.html as localStorage).
  // Firebase migration note: replace this with Firestore equipment/{eq} document fetch.
  function loadEqMeta(){
    if (!eq) return null;
    const primaryKey = `nexus_meta_${eq}`;
    const legacyKey = "nexus_meta_";
    try{
      const raw = localStorage.getItem(primaryKey);
      if (raw) return JSON.parse(raw);
      // legacy fallback (older builds stored a single meta blob)
      const legacyRaw = localStorage.getItem(legacyKey);
      if (legacyRaw) return JSON.parse(legacyRaw);
    }catch(e){
      // ignore
    }
    return null;
  }

  // Equipment-specific links (set on equipment.html)
  function linksKey(){ return `nexus_${eq || "NO_EQ"}_equipment_links_v1`; }
  function loadEqLinks(){
    try{
      const raw = localStorage.getItem(linksKey());
      return raw ? JSON.parse(raw) : {};
    }catch(e){
      return {};
    }
  }
  function getEqLink(k){
    const links = loadEqLinks();
    const v = (links && links[k]) ? String(links[k]).trim() : "";
    return v;
  }

  function role(){
    try{
      if(window.NEXUS && typeof window.NEXUS.getRole === "function"){
        return window.NEXUS.getRole() || "viewer";
      }
    }catch(e){}
    return "viewer";
  }
  function canEditForemanPlus(){
    const order = ["viewer","tech","foreman","superintendent","admin"];
    return order.indexOf(role()) >= order.indexOf("foreman");
  }

  if (!id || !window.FORMS || !window.FORMS[id]) {
    document.body.innerHTML =
      '<div style="background:#b60000;color:white;padding:40px;font-family:Arial">' +
      "<h2>Invalid or missing form ID</h2>" +
      "<p>Example: <code>form.html?id=rif</code></p>" +
      "</div>";
    return;
  }

  const cfg = window.FORMS[id];

  document.title = cfg.title || "Form";
  document.getElementById("page-title").textContent = cfg.title || "";
  document.getElementById("section-title").textContent = cfg.sectionTitle || "";

  const eqLabel = document.getElementById("eqLabel");
  if (eqLabel) eqLabel.textContent = eq ? `Equipment: ${eq}` : "";

  if (cfg.backgroundImage) {
    document.body.style.backgroundImage = `url("${cfg.backgroundImage}")`;
  }

  const buttonsWrap = document.getElementById("buttonsWrap");
  const buttonsEl = document.getElementById("buttons");
  const mediaEl = document.getElementById("media");

  // Keys used by equipment.html / index.html
  function stepKey(stepId){ return `nexus_${eq || "NO_EQ"}_step_${stepId}`; }
  function landingKey(){ return `nexus_${eq || "NO_EQ"}_landing_complete`; }

  // =========================
  // Firebase sync (optional)
  // - expects window.NEXUS_FB = { db, auth } from your firebase init script
  // - mirrors Firestore <-> localStorage
  // =========================
  async function fbSetStep(eqId, stepId, isDone){
    try{
      if (!window.NEXUS_FB?.db || !eqId || !stepId) return;
      const { db, auth } = window.NEXUS_FB;

      const { doc, setDoc, serverTimestamp } =
        await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");

      const ref = doc(db, "equipment", eqId, "steps", stepId);
      await setDoc(ref, {
        done: !!isDone,
        updatedAt: serverTimestamp(),
        updatedBy: auth?.currentUser?.uid || null
      }, { merge:true });
    }catch(e){
      // silent fail: localStorage still works offline
      console.warn("Firebase step sync failed:", e);
    }
  }

  let fbUnsub = null;
  async function fbListenStep(eqId, stepId){
    try{
      if (!window.NEXUS_FB?.db || !eqId || !stepId) return;
      const { db } = window.NEXUS_FB;

      const { doc, onSnapshot } =
        await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");

      const ref = doc(db, "equipment", eqId, "steps", stepId);

      // Listen for remote changes and mirror into localStorage
      fbUnsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() || {};
        if (data.done) localStorage.setItem(stepKey(stepId), "1");
        else localStorage.removeItem(stepKey(stepId));
        refreshStepBtn();
      });
    }catch(e){
      console.warn("Firebase listener failed:", e);
    }
  }

  // Toggle button
  const stepBtn = document.getElementById("stepCompleteBtn");

  // Steps that should NOT have completion toggles (support/reference only)
  const NON_COMPLETABLE = new Set(["construction","phenolic","transformer","supporting","megger_reporting"]);
  const hideToggle = NON_COMPLETABLE.has(id);

  function usable(){ return !!(eq && id); }
  function done(){ return !!(eq && id && localStorage.getItem(stepKey(id)) === "1"); }

  async function setDoneState(nextDone){
    if (!usable()) return;

    // Keep existing cfg.completedKey behavior (optional/legacy)
    if (cfg.completedKey){
      if (nextDone) localStorage.setItem(cfg.completedKey, "true");
      else localStorage.removeItem(cfg.completedKey);
    }

    // Local-first write (offline-friendly)
    if (nextDone){
      localStorage.setItem(stepKey(id), "1");
      localStorage.setItem(landingKey(), "1");
    } else {
      localStorage.removeItem(stepKey(id));
      // Do not clear landing flag here; equipment.html recomputes it accurately.
    }

    // Firebase mirror (best-effort)
    await fbSetStep(eq, id, nextDone);
  }

  function refreshStepBtn(){
    if (!stepBtn) return;
    if (hideToggle){ stepBtn.style.display = "none"; return; }

    // Always visible; disable if missing eq/id to prevent bad writes
    stepBtn.style.display = "block";
    stepBtn.disabled = !usable();
    stepBtn.title = usable() ? "" : "Missing eq or id in URL";

    stepBtn.classList.toggle("complete", done());
  }

  if (stepBtn){
    stepBtn.addEventListener("click", async () => {
      if (!usable()) return;
      const next = !done();
      await setDoneState(next);
      refreshStepBtn();
    });
  }

  refreshStepBtn();
  window.addEventListener("storage", refreshStepBtn);
  window.addEventListener("focus", refreshStepBtn);
  window.addEventListener("pageshow", refreshStepBtn);

  // Start Firebase listener (if configured) for cross-device updates
  if (usable()) fbListenStep(eq, id);

  window.addEventListener("beforeunload", () => {
    try{ if (fbUnsub) fbUnsub(); }catch(e){}
  });

  // Helper: add eq to INTERNAL links only
  function withEq(href) {
    if (!eq || !href) return href;
    if (/^https?:\/\//i.test(href)) return href;

    const u = new URL(href, location.href);
    if (u.origin !== location.origin) return href;

    u.searchParams.set("eq", eq);

    if (u.pathname.endsWith("/submit.html") || u.pathname.endsWith("submit.html")) {
      if (!u.searchParams.get("form") && !u.searchParams.get("id")) {
        u.searchParams.set("form", id);
      }
    }

    return u.pathname + u.search + u.hash;
  }

  // =========================
  // SPECIAL: Diagram Image page (id=transformer)
  // - Upload OR Link
  // - Saved per equipment
  // - Foreman+ can edit; everyone can view/open
  // =========================
  if (id === "transformer") {
    const DIAG_KEY = `nexus_${eq || "NO_EQ"}_diagram_v1`;

    buttonsWrap.style.display = "none";
    mediaEl.style.display = "block";

    const editable = canEditForemanPlus();

    mediaEl.innerHTML = `
      <div style="text-align:left;margin-top:10px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.18);border-radius:14px;padding:14px;">
        <div style="font-weight:900;font-size:18px;margin-bottom:8px;">Diagram Image (Upload or Link)</div>
        <div style="font-weight:800;opacity:.9;margin-bottom:10px;">
          ${editable ? "Foreman+ can upload/set link." : "View only (Foreman+ required to upload/set link)."}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <label style="font-weight:900;">
            Upload Image
            <input id="nxDiagFile" type="file" accept="image/*" ${editable ? "" : "disabled"} />
          </label>

          <label style="font-weight:900;">
            Or File Link (SharePoint/Drive/Procore/etc.)
            <input id="nxDiagLink" type="text" placeholder="https://..." ${editable ? "" : "disabled"} />
          </label>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center;">
          <a id="nxDiagOpen" class="btn" href="#" target="_blank" rel="noopener" style="display:none;">Open Diagram Link</a>
          <button id="nxDiagClear" class="btn secondary" type="button" ${editable ? "" : "disabled"}>Clear</button>
          <div id="nxDiagStatus" style="margin-left:auto;font-weight:900;opacity:.9;">Not saved</div>
        </div>

        <div id="nxDiagPreviewWrap" style="margin-top:14px;display:none;">
          <img id="nxDiagPreview" src="" alt="Diagram preview" style="max-width:100%;border-radius:14px;border:1px solid rgba(255,255,255,0.18);" />
        </div>
      </div>
    `;

    function setStatus(t){
      const s = document.getElementById("nxDiagStatus");
      if (s) s.textContent = t;
    }

    function loadDiagram(){
      try{
        const raw = localStorage.getItem(DIAG_KEY);
        if(!raw) return { link:"", dataUrl:"" };
        const d = JSON.parse(raw) || {};
        return { link: d.link || "", dataUrl: d.dataUrl || "" };
      }catch(e){
        return { link:"", dataUrl:"" };
      }
    }

    function saveDiagram(next){
      localStorage.setItem(DIAG_KEY, JSON.stringify({
        link: next.link || "",
        dataUrl: next.dataUrl || "",
        updatedAt: new Date().toISOString()
      }));
      setStatus("Saved");

      // Firebase hook placeholder:
      // window.nexusFirebase?.saveSheet?.(eq, "diagram", next);
    }

    function applyToUI(d){
      const linkEl = document.getElementById("nxDiagLink");
      const openEl = document.getElementById("nxDiagOpen");
      const prevWrap = document.getElementById("nxDiagPreviewWrap");
      const prevImg = document.getElementById("nxDiagPreview");

      if(linkEl) linkEl.value = d.link || "";

      if(openEl && d.link){
        openEl.href = d.link;
        openEl.style.display = "inline-flex";
      }else if(openEl){
        openEl.style.display = "none";
      }

      if(prevWrap && prevImg && d.dataUrl){
        prevImg.src = d.dataUrl;
        prevWrap.style.display = "block";
      }else if(prevWrap){
        prevWrap.style.display = "none";
      }
    }

    const initial = loadDiagram();
    applyToUI(initial);

    const linkEl = document.getElementById("nxDiagLink");
    const fileEl = document.getElementById("nxDiagFile");
    const clearBtn = document.getElementById("nxDiagClear");

    if(linkEl && editable){
      linkEl.addEventListener("input", () => {
        const d = loadDiagram();
        d.link = (linkEl.value || "").trim();
        saveDiagram(d);
        applyToUI(d);
      });
    }

    if(fileEl && editable){
      fileEl.addEventListener("change", () => {
        const f = fileEl.files && fileEl.files[0];
        if(!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          const d = loadDiagram();
          d.dataUrl = String(reader.result || "");
          saveDiagram(d);
          applyToUI(d);
        };
        reader.readAsDataURL(f);
      });
    }

    if(clearBtn && editable){
      clearBtn.addEventListener("click", () => {
        localStorage.removeItem(DIAG_KEY);
        setStatus("Cleared");
        applyToUI({ link:"", dataUrl:"" });
      });
    }

    return;
  }

  // =========================
  // EMBED MODE
  // =========================
  if (cfg.embedUrl) {
    buttonsWrap.style.display = "none";
    mediaEl.style.display = "block";
    mediaEl.innerHTML = `<iframe class="embed" src="${withEq(cfg.embedUrl)}" title="${cfg.title || ""}"></iframe>`;
    return;
  }

  // =========================
  // IMAGE MODE (+ magnifier unchanged)
  // =========================
  if (cfg.imageUrl) {
    buttonsWrap.style.display = "none";
    mediaEl.style.display = "block";
    mediaEl.innerHTML = `
      <img id="mainImg" src="${cfg.imageUrl}" alt="${cfg.title || "Image"}" style="max-width:100%;border-radius:18px;cursor:zoom-in;">
      <div style="margin-top:12px;">
        <a class="btn" href="${cfg.imageUrl}" target="_blank" rel="noopener noreferrer">Open Image in New Tab</a>
      </div>
    `;

    if (cfg.magnifier) {
      const img = document.getElementById("mainImg");
      const zoom = Number(cfg.zoom || 4);

      const modal = document.createElement("div");
      modal.className = "nx-modal";
      modal.innerHTML = `
        <div class="nx-modal-content">
          <button class="nx-return-home" type="button">Return to Home</button>
          <button class="nx-close" type="button" aria-label="Close">&times;</button>
          <img id="nxModalImg" src="${cfg.imageUrl}" alt="${cfg.title || "Image"}">
          <div class="nx-magnifier" id="nxMagnifier"></div>
        </div>
      `;
      document.body.appendChild(modal);

      const closeBtn = modal.querySelector(".nx-close");
      const homeBtn = modal.querySelector(".nx-return-home");
      const modalImg = modal.querySelector("#nxModalImg");
      const magnifier = modal.querySelector("#nxMagnifier");
      let moveFn = null;

      function getCursorPos(e) {
        const a = modalImg.getBoundingClientRect();
        const pageX = (e.touches && e.touches[0]) ? e.touches[0].pageX : e.pageX;
        const pageY = (e.touches && e.touches[0]) ? e.touches[0].pageY : e.pageY;
        const x = pageX - a.left - window.pageXOffset;
        const y = pageY - a.top - window.pageYOffset;
        return { x, y };
      }

      function magnify(imgEl, z) {
        const glass = magnifier;
        const bw = 6;
        const iw = imgEl.width;
        const ih = imgEl.height;

        glass.style.backgroundImage = `url('${imgEl.src}')`;
        glass.style.backgroundRepeat = "no-repeat";
        glass.style.backgroundSize = (iw * z) + "px " + (ih * z) + "px";
        glass.style.display = "block";

        const w = glass.offsetWidth / 2;
        const h = glass.offsetHeight / 2;

        moveFn = function (e) {
          e.preventDefault();
          const pos = getCursorPos(e);
          let x = pos.x;
          let y = pos.y;

          if (x > iw - (w / z)) x = iw - (w / z);
          if (x < w / z) x = w / z;
          if (y > ih - (h / z)) y = ih - (h / z);
          if (y < h / z) y = h / z;

          glass.style.left = (x - w) + "px";
          glass.style.top = (y - h) + "px";
          glass.style.backgroundPosition =
            "-" + ((x * z) - w + bw) + "px -" + ((y * z) - h + bw) + "px";
        };

        imgEl.addEventListener("mousemove", moveFn, { passive: false });
        glass.addEventListener("mousemove", moveFn, { passive: false });
        imgEl.addEventListener("touchmove", moveFn, { passive: false });
      }

      function removeMagnifier() {
        magnifier.style.display = "none";
        if (moveFn) {
          modalImg.removeEventListener("mousemove", moveFn);
          magnifier.removeEventListener("mousemove", moveFn);
          modalImg.removeEventListener("touchmove", moveFn);
          moveFn = null;
        }
      }

      function openModal() {
        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
        requestAnimationFrame(() => magnify(modalImg, zoom));
      }

      function closeModal() {
        modal.style.display = "none";
        document.body.style.overflow = "";
        removeMagnifier();
      }

      img.addEventListener("click", openModal);
      closeBtn.addEventListener("click", closeModal);
      homeBtn.addEventListener("click", () => {
        closeModal();
        window.location.href = eq ? `index.html?eq=${encodeURIComponent(eq)}` : "index.html";
      });

      modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.style.display === "flex") closeModal(); });
    }

    return;
  }

  // =========================
  // BUTTON MODE
  // =========================
  buttonsWrap.style.display = "inline-block";
  mediaEl.style.display = "none";
  buttonsEl.innerHTML = "";

  // Button list (allow dynamic injection based on equipment metadata)
  const btnList = Array.isArray(cfg.buttons) ? [...cfg.buttons] : [];

  // RIF: add Procore links
  if (id === "rif") {
    const meta = loadEqMeta() || {};

    // Existing: construction procore (if set in meta)
    if (meta.procoreEquipUrl) {
      btnList.unshift({
        text: "RIF – Procore (Construction)",
        href: meta.procoreEquipUrl
      });
    }

    // NEW: RIF-Procore (Not Updated) (equipment-specific override field)
    const rifPU = getEqLink("rifProcoreNotUpdated");
    if (rifPU) {
      btnList.unshift({
        text: "RIF-Procore (Not Updated)",
        href: rifPU
      });
    }
  }

  // NEW: Meg SOP
  if (id === "meg") {
    const sop = getEqLink("megSop");
    if (sop) {
      btnList.unshift({
        text: "Megohmmeter SOP",
        href: sop
      });
    }
  }

  // NEW: Torque SOP
  if (id === "torque") {
    const sop = getEqLink("torqueSop");
    if (sop) {
      btnList.unshift({
        text: "Torque Application SOP",
        href: sop
      });
    }
  }

  btnList.forEach((b) => {
    const a = document.createElement("a");
    a.className = "btn";
    a.textContent = b.text || "Open";
    a.href = withEq(b.href || "#");

    if (/^https?:\/\//i.test(a.href)) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }

    buttonsEl.appendChild(a);
  });

})();

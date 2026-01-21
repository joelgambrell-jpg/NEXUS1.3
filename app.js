/* app.js (FULL drop-in) */
(function () {
  const params = new URLSearchParams(location.search);
  const id = (params.get("id") || "").trim();
  const eq = (params.get("eq") || "").trim();

  function loadEqMeta(){
    if (!eq) return null;
    const primaryKey = `nexus_meta_${eq}`;
    const legacyKey = "nexus_meta_";
    try{
      const raw = localStorage.getItem(primaryKey);
      if (raw) return JSON.parse(raw);
      const legacyRaw = localStorage.getItem(legacyKey);
      if (legacyRaw) return JSON.parse(legacyRaw);
    }catch(e){}
    return null;
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

  // Keys used by equipment.html / package_export.html
  function stepKey(stepId){ return `nexus_${eq || "NO_EQ"}_step_${stepId}`; }
  function landingKey(){ return `nexus_${eq || "NO_EQ"}_landing_complete`; }

  // =========================
  // Firebase sync (optional)
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

  // =========================
  // Completion button (RIF ONLY on form/task landing)
  // =========================
  const stepBtn = document.getElementById("stepCompleteBtn");

  // Only show this button on these landing pages:
  const SHOW_STEP_COMPLETE_ON = new Set(["rif"]);

  // Non-completable (support/reference only)
  const NON_COMPLETABLE = new Set(["construction","phenolic","transformer","supporting","megger_reporting"]);
  const hideToggle = NON_COMPLETABLE.has(id);

  function usable(){ return !!(eq && id); }
  function done(){ return !!(eq && id && localStorage.getItem(stepKey(id)) === "1"); }

  async function setDoneState(nextDone){
    if (!usable()) return;

    if (cfg.completedKey){
      if (nextDone) localStorage.setItem(cfg.completedKey, "true");
      else localStorage.removeItem(cfg.completedKey);
    }

    if (nextDone){
      localStorage.setItem(stepKey(id), "1");
      localStorage.setItem(landingKey(), "1");
    } else {
      localStorage.removeItem(stepKey(id));
    }

    await fbSetStep(eq, id, nextDone);
  }

  function refreshStepBtn(){
    if (!stepBtn) return;

    if (hideToggle || !SHOW_STEP_COMPLETE_ON.has(id)){
      stepBtn.style.display = "none";
      return;
    }

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

  if (usable() && SHOW_STEP_COMPLETE_ON.has(id)) fbListenStep(eq, id);

  window.addEventListener("beforeunload", () => {
    try{ if (fbUnsub) fbUnsub(); }catch(e){}
  });

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

  // EMBED MODE
  if (cfg.embedUrl) {
    buttonsWrap.style.display = "none";
    mediaEl.style.display = "block";
    mediaEl.innerHTML = `<iframe class="embed" src="${withEq(cfg.embedUrl)}" title="${cfg.title || ""}"></iframe>`;
    return;
  }

  // IMAGE MODE
  if (cfg.imageUrl) {
    buttonsWrap.style.display = "none";
    mediaEl.style.display = "block";
    mediaEl.innerHTML = `
      <img id="mainImg" src="${cfg.imageUrl}" alt="${cfg.title || "Image"}" style="max-width:100%;border-radius:18px;cursor:zoom-in;">
      <div style="margin-top:12px;">
        <a class="btn" href="${cfg.imageUrl}" target="_blank" rel="noopener noreferrer">Open Image in New Tab</a>
      </div>
    `;
    return;
  }

  // BUTTON MODE
  buttonsWrap.style.display = "inline-block";
  mediaEl.style.display = "none";
  buttonsEl.innerHTML = "";

  const btnList = Array.isArray(cfg.buttons) ? [...cfg.buttons] : [];

  // RIF: Procore quick link
  if (id === "rif") {
    const meta = loadEqMeta() || {};
    if (meta.procoreEquipUrl) {
      btnList.unshift({
        text: "RIF – Procore (Construction)",
        href: meta.procoreEquipUrl,
        newTab: true
      });
    }
  }

  // TORQUE: SOP directly under Torque Application Log
  if (id === "torque") {
    btnList.splice(1, 0, {
      text: "Torque SOP",
      href: "torque_sop.html",
      newTab: true
    });
  }

  btnList.forEach((b) => {
    const a = document.createElement("a");
    a.className = "btn";
    a.textContent = b.text || "Open";
    a.href = withEq(b.href || "#");

    if (b.newTab || /^https?:\/\//i.test(a.href)) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }

    buttonsEl.appendChild(a);
  });

  refreshStepBtn();
})();
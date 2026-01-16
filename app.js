(function () {
  const params = new URLSearchParams(location.search);
  const id = (params.get("id") || "").trim();
  const eq = (params.get("eq") || "").trim();

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

  // EMBED MODE
  if (cfg.embedUrl) {
    buttonsWrap.style.display = "none";
    mediaEl.style.display = "block";
    mediaEl.innerHTML = `<iframe class="embed" src="${cfg.embedUrl}" title="${cfg.title || ""}"></iframe>`;
    return;
  }

  // IMAGE MODE (+ magnifier unchanged)
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

  // BUTTON MODE
  buttonsWrap.style.display = "inline-block";
  mediaEl.style.display = "none";
  buttonsEl.innerHTML = "";

  (cfg.buttons || []).forEach((b) => {
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

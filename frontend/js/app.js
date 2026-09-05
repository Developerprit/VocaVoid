/* =========================================================================
   VocaVoid — console controller. Wires the native chrome + PianoRoll + VV API.
   ========================================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = {
    current: null,         // full project object
    vbs: [],               // voicebanks
    audio: null,
    saveTimer: null,
  };

  let pr = null;           // PianoRoll instance
  let els = {};            // cached DOM refs

  /* ---------------- boot ---------------- */
  function boot() {
    try {
      init();
    } catch (e) {
      console.error(e);
      toast("界面初始化失败: " + e.message, "err");
    }
  }

  function init() {
    els = {
      vfDot: $("vfDot"), vfText: $("vfText"),
      newSongBtn: $("newSongBtn"),
      projectList: $("projectList"), voicebankList: $("voicebankList"),
      tempoInput: $("tempoInput"), transposeInput: $("transposeInput"),
      voicebankSelect: $("voicebankSelect"),
      synthBtn: $("synthBtn"), clearBtn: $("clearBtn"), exportBtn: $("exportBtn"),
      lastResult: $("lastResult"),
      inspector: $("inspector"), emptyState: $("emptyState"),
      prScroll: $("prScroll"), canvas: $("pianoroll"),
      toast: $("toast"),
      modalBack: $("modalBack"), newNameInput: $("newNameInput"),
      modalCancel: $("modalCancel"), modalCreate: $("modalCreate"),
      themeToggle: $("themeToggle"),
    };

    pr = new PianoRoll(els.canvas, {
      onChange: scheduleSave,
      onSelect: renderInspector,
      onNoteDblClick: (n) => {
        renderInspector(n);
        const inp = els.inspector.querySelector(".lyric-input");
        if (inp) inp.focus();
      },
    });

    bindEvents();
    refreshHealth();
    loadVoicebanks();
    loadProjects();

    window.addEventListener("resize", () => pr && pr.resize());
    if (window.ResizeObserver) {
      new ResizeObserver(() => pr && pr.resize()).observe(els.prScroll);
    }
  }

  /* ---------------- events ---------------- */
  function bindEvents() {
    els.newSongBtn.addEventListener("click", openModal);
    els.themeToggle.addEventListener("click", toggleTheme);
    els.synthBtn.addEventListener("click", synthCurrent);
    els.clearBtn.addEventListener("click", () => {
      if (!state.current) return;
      pr.setNotes([]); state.current.notes = [];
      els.emptyState.classList.remove("hidden");
      scheduleSave();
    });
    els.exportBtn.addEventListener("click", exportJson);
    els.tempoInput.addEventListener("change", () => {
      if (!state.current) return;
      state.current.tempo_bpm = clampInt(els.tempoInput.value, 20, 400, 100);
      els.tempoInput.value = state.current.tempo_bpm;
      scheduleSave();
    });
    els.transposeInput.addEventListener("change", () => {
      if (!state.current) return;
      state.current.transpose = clampInt(els.transposeInput.value, -24, 24, 0);
      els.transposeInput.value = state.current.transpose;
      scheduleSave();
    });
    els.voicebankSelect.addEventListener("change", () => {
      if (!state.current) return;
      state.current.model_id = els.voicebankSelect.value;
      scheduleSave();
    });

    els.modalCancel.addEventListener("click", closeModal);
    els.modalCreate.addEventListener("click", () => {
      const name = (els.newNameInput.value || "").trim();
      closeModal();
      newProject(name);
    });
    els.newNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") els.modalCreate.click();
    });

    document.addEventListener("keydown", (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") { pr && pr.deleteSelected(); e.preventDefault(); }
      if (e.key === "Escape") { pr && pr.setSelected(null); }
    });

    // inspector delegation
    els.inspector.addEventListener("input", (e) => {
      const n = pr && pr.getSelected(); if (!n) return;
      const f = e.target.dataset.field;
      if (!f) return;
      if (f === "lyric") pr.updateNote(n.id, { lyric: e.target.value });
      else if (f === "midi") pr.updateNote(n.id, { midi: clampInt(e.target.value, 48, 84, n.midi) });
      else if (f === "start") pr.updateNote(n.id, { start: Math.max(0, +e.target.value || 0) });
      else if (f === "duration") pr.updateNote(n.id, { duration: Math.max(0.02, +e.target.value || 0.02) });
    });
    els.inspector.addEventListener("click", (e) => {
      if (e.target.classList.contains("del-note")) pr && pr.deleteSelected();
    });
  }

  /* ---------------- data loading ---------------- */
  async function refreshHealth() {
    try {
      const h = await VV.health();
      const ok = h && h.vf_ok;
      els.vfDot.className = "dot " + (ok ? "ok" : "bad");
      els.vfText.textContent = ok ? "VF: 已连接 " + (h.vf && h.vf.version ? h.vf.version : "") : "VF: 未连接";
    } catch (e) {
      els.vfDot.className = "dot bad";
      els.vfText.textContent = "VF: 错误";
    }
  }

  async function loadVoicebanks() {
    try {
      const data = await VV.listVoicebanks();
      state.vbs = data.voicebanks || [];
    } catch (e) {
      state.vbs = [];
    }
    renderVoicebankList();
    populateSelect();
  }

  async function loadProjects() {
    let projects = [];
    try { projects = (await VV.listProjects()).projects || []; } catch (e) { projects = []; }
    if (projects.length === 0) {
      await createDemoProject();
      return;
    }
    renderProjectList(projects);
    selectProject(projects[0].id);
  }

  async function createDemoProject() {
    try {
      const p = await VV.createProject("Demo · 你好世界");
      const notes = [
        { id: "d1", midi: 60, start: 0, duration: 0.9, lyric: "你" },
        { id: "d2", midi: 62, start: 1, duration: 0.9, lyric: "好" },
        { id: "d3", midi: 64, start: 2, duration: 0.9, lyric: "世" },
        { id: "d4", midi: 65, start: 3, duration: 1.1, lyric: "界" },
      ];
      await VV.saveProject(p.id, {
        name: p.name, tempo_bpm: 100, transpose: 0, model_id: "stub-zh", grid: 0.25, notes,
      });
      const projects = (await VV.listProjects()).projects || [];
      renderProjectList(projects);
      selectProject(p.id);
      toast("已创建示例工程", "ok");
    } catch (e) {
      toast("创建工程失败: " + e.message, "err");
    }
  }

  /* ---------------- rendering ---------------- */
  function renderProjectList(projects) {
    els.projectList.innerHTML = "";
    projects.forEach((p) => {
      const el = document.createElement("div");
      el.className = "proj" + (state.current && state.current.id === p.id ? " active" : "");
      el.dataset.id = p.id;
      el.innerHTML =
        '<span class="pdot"></span>' +
        '<div class="pmeta"><div class="pname"></div><div class="psub"></div></div>' +
        '<div class="pdel" title="删除">✕</div>';
      el.querySelector(".pname").textContent = p.name || "未命名";
      el.querySelector(".psub").textContent = (p.tempo_bpm || 100) + " BPM · " + (p.note_count || 0) + " 音符 · " + (p.model_id || "stub-zh");
      el.addEventListener("click", (ev) => {
        if (ev.target.classList.contains("pdel")) return;
        selectProject(p.id);
      });
      el.querySelector(".pdel").addEventListener("click", (ev) => {
        ev.stopPropagation();
        deleteProject(p.id);
      });
      els.projectList.appendChild(el);
    });
  }

  function renderVoicebankList() {
    els.voicebankList.innerHTML = "";
    if (state.vbs.length === 0) {
      const e = document.createElement("div");
      e.className = "vb-section-title";
      e.textContent = "（无 — 把 .vfvp 放入 vfvp/ 目录）";
      els.voicebankList.appendChild(e);
      return;
    }
    state.vbs.forEach((vb) => {
      const el = document.createElement("div");
      el.className = "vb";
      const tag = vb.source === "vocaforge" ? "已注册" : (vb.registered ? "已注册" : "本地");
      const sub = [vb.lang, vb.backend].filter(Boolean).join(" · ");
      el.innerHTML =
        '<div class="vicon">♪</div>' +
        '<div class="vmeta"><div class="vname"></div><div class="vsub"></div></div>' +
        '<span class="vtag"></span>';
      el.querySelector(".vname").textContent = vb.name || vb.id;
      el.querySelector(".vsub").textContent = sub || "—";
      el.querySelector(".vtag").textContent = tag;
      if (vb.source === "local" && !vb.registered) {
        const btn = document.createElement("button");
        btn.className = "ghost"; btn.style.cssText = "padding:3px 8px;font-size:11px;";
        btn.textContent = "↻ 注册";
        btn.addEventListener("click", async () => {
          try {
            await VV.registerVoicebank(vb.path);
            toast("已注册: " + vb.name, "ok");
            await loadVoicebanks();
          } catch (e) { toast("注册失败: " + e.message, "err"); }
        });
        el.appendChild(btn);
      }
      els.voicebankList.appendChild(el);
    });
  }

  function populateSelect() {
    const sel = els.voicebankSelect;
    sel.innerHTML = "";
    if (state.vbs.length === 0) {
      const o = document.createElement("option");
      o.value = "stub-zh"; o.textContent = "stub-zh (内置测试声库)";
      sel.appendChild(o);
      return;
    }
    state.vbs.forEach((vb) => {
      const o = document.createElement("option");
      o.value = vb.id;
      o.textContent = (vb.name || vb.id) + (vb.source === "vocaforge" ? " ✓" : " (本地)");
      sel.appendChild(o);
    });
    if (state.current && state.current.model_id) sel.value = state.current.model_id;
  }

  function renderInspector(note) {
    if (!note) {
      els.inspector.classList.add("hidden");
      els.inspector.innerHTML = "";
      return;
    }
    els.inspector.classList.remove("hidden");
    const name = pr.noteName(note.midi);
    els.inspector.innerHTML =
      '<div class="ifield"><span class="ik">歌词 LYRIC</span>' +
      '<input class="lyric-input" data-field="lyric" value="' + escapeAttr(note.lyric) + '" /></div>' +
      '<div class="ifield"><span class="ik">音高 ' + name + '</span>' +
      '<input type="number" data-field="midi" min="48" max="84" value="' + note.midi + '" /></div>' +
      '<div class="ifield"><span class="ik">起始 (拍)</span>' +
      '<input type="number" step="0.25" data-field="start" value="' + note.start + '" /></div>' +
      '<div class="ifield"><span class="ik">时长 (拍)</span>' +
      '<input type="number" step="0.25" data-field="duration" value="' + note.duration + '" /></div>' +
      '<button class="danger del-note">删除音符</button>';
  }

  /* ---------------- actions ---------------- */
  async function selectProject(id) {
    try {
      const p = await VV.getProject(id);
      state.current = p;
      els.tempoInput.value = p.tempo_bpm || 100;
      els.transposeInput.value = p.transpose || 0;
      pr.setNotes(p.notes || []);
      els.emptyState.classList.toggle("hidden", (p.notes || []).length > 0);
      if (state.vbs.length) populateSelect();
      els.voicebankSelect.value = p.model_id || "stub-zh";
      renderProjectList((await VV.listProjects()).projects || []);
      renderInspector(null);
    } catch (e) {
      toast("打开工程失败: " + e.message, "err");
    }
  }

  async function newProject(name) {
    try {
      const p = await VV.createProject(name || "");
      const projects = (await VV.listProjects()).projects || [];
      renderProjectList(projects);
      selectProject(p.id);
      toast("已新建工程", "ok");
    } catch (e) {
      toast("新建失败: " + e.message, "err");
    }
  }

  async function deleteProject(id) {
    try {
      await VV.deleteProject(id);
      const projects = (await VV.listProjects()).projects || [];
      renderProjectList(projects);
      if (projects.length) selectProject(projects[0].id);
      else { state.current = null; pr.setNotes([]); els.emptyState.classList.remove("hidden"); }
      toast("已删除", "ok");
    } catch (e) {
      toast("删除失败: " + e.message, "err");
    }
  }

  function scheduleSave() {
    if (!state.current) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveCurrent, 600);
  }

  async function saveCurrent() {
    if (!state.current) return;
    const p = state.current;
    const payload = {
      name: p.name,
      tempo_bpm: p.tempo_bpm,
      transpose: p.transpose,
      model_id: p.model_id,
      grid: p.grid,
      notes: pr.getNotes(),
    };
    try {
      const saved = await VV.saveProject(p.id, payload);
      state.current = saved;
      els.emptyState.classList.toggle("hidden", (saved.notes || []).length > 0);
      renderProjectList((await VV.listProjects()).projects || []);
    } catch (e) {
      toast("保存失败: " + e.message, "err");
    }
  }

  async function synthCurrent() {
    if (!state.current) return;
    // ensure latest notes are saved first
    clearTimeout(state.saveTimer);
    await saveCurrent();
    els.synthBtn.disabled = true;
    els.synthBtn.textContent = "⏳ 合成中…";
    try {
      const r = await VV.synth(state.current.id, {});
      const url = r.url;
      els.lastResult.innerHTML = '已生成 <a href="' + url + '" download>下载 WAV</a> · ' +
        ((r.bytes || 0) / 1024).toFixed(1) + ' KB';
      playAudio(url);
      toast("合成完成 · " + (r.model_id || ""), "ok");
    } catch (e) {
      toast("合成失败: " + e.message, "err");
    } finally {
      els.synthBtn.disabled = false;
      els.synthBtn.textContent = "▶ 合成并保存";
    }
  }

  function playAudio(url) {
    if (state.audio) { state.audio.pause(); }
    state.audio = new Audio(url);
    state.audio.play().catch(() => {});
  }

  function exportJson() {
    if (!state.current) return;
    const data = Object.assign({}, state.current, { notes: pr.getNotes() });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (state.current.name || "song") + ".vvproj.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------------- modal / theme / toast ---------------- */
  function openModal() { els.modalBack.classList.add("show"); els.newNameInput.value = ""; els.newNameInput.focus(); }
  function closeModal() { els.modalBack.classList.remove("show"); }

  function toggleTheme() {
    const cur = document.documentElement.dataset.theme || "dark";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("vv-theme", next);
    if (pr) pr.draw();
  }

  let toastTimer = null;
  function toast(msg, type) {
    els.toast.textContent = msg;
    els.toast.className = "show" + (type ? " " + type : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.className = ""; }, 2600);
  }

  /* ---------------- utils ---------------- */
  function clampInt(v, lo, hi, dflt) {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function escapeAttr(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  /* ---------------- go ---------------- */
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

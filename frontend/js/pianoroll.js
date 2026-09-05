/* =========================================================================
   PianoRoll — canvas piano-roll editor for VocaVoid1.
   Notes: { id, midi, start, duration, lyric }. Time unit = beats (1 beat = 1/4 note).
   Emits onChange() after any edit; onSelect(note|null); onNoteDblClick(note).
   ========================================================================= */
class PianoRoll {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = Object.assign(
      {
        midiLow: 48, midiHigh: 84,      // C3..C6
        pxPerBeat: 56,
        rowH: 17,
        leftPad: 50,
        defaultLen: 1,                  // beats
        snap: 0.25,
        onChange: () => {},
        onSelect: () => {},
        onNoteDblClick: () => {},
      },
      opts || {}
    );
    this.notes = [];
    this.selectedId = null;
    this.playhead = null;
    this.dragging = null;               // {mode, note, offBeats, offMidi}
    this.dpr = window.devicePixelRatio || 1;
    this._bind();
    this.resize();
  }

  /* ---------- geometry ---------- */
  get rows() { return this.opts.midiHigh - this.opts.midiLow + 1; }
  midiToY(midi) { return (this.opts.midiHigh - midi) * this.opts.rowH; }
  yToMidi(y) {
    const r = Math.floor(y / this.opts.rowH);
    return Math.max(this.opts.midiLow, Math.min(this.opts.midiHigh, this.opts.midiHigh - r));
  }
  beatToX(b) { return this.opts.leftPad + b * this.opts.pxPerBeat; }
  xToBeat(x) { return (x - this.opts.leftPad) / this.opts.pxPerBeat; }
  snap(v) { const s = this.opts.snap; return Math.round(v / s) * s; }
  isBlack(midi) { return [1, 3, 6, 8, 10].indexOf(((midi % 12) + 12) % 12) !== -1; }
  noteName(midi) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  contentBeats() {
    let max = this.opts.defaultLen * 8;
    for (const n of this.notes) max = Math.max(max, n.start + n.duration);
    return Math.max(8, Math.ceil(max + 4));
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const wrapW = wrap.clientWidth || 800;
    const contentW = this.opts.leftPad + this.contentBeats() * this.opts.pxPerBeat + 24;
    const cssW = Math.max(wrapW, contentW);
    const cssH = this.rows * this.opts.rowH + 1;
    this.cssW = cssW; this.cssH = cssH;
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.draw();
  }

  /* ---------- data ---------- */
  setNotes(notes) {
    this.notes = (notes || []).map((n) => ({
      id: n.id || Math.random().toString(36).slice(2, 9),
      midi: n.midi | 0,
      start: Math.max(0, +n.start || 0),
      duration: Math.max(0.02, +n.duration || 0.4),
      lyric: n.lyric || "",
    }));
    this.draw();
  }
  getNotes() { return this.notes.map((n) => ({ ...n })); }
  getSelected() { return this.notes.find((n) => n.id === this.selectedId) || null; }
  setSelected(id) { this.selectedId = id; this.opts.onSelect(this.getSelected()); this.draw(); }

  addNote(midi, start) {
    const n = {
      id: Math.random().toString(36).slice(2, 9),
      midi, start: Math.max(0, this.snap(start)),
      duration: this.opts.defaultLen, lyric: "",
    };
    this.notes.push(n);
    this.selectedId = n.id;
    this.opts.onSelect(n);
    this.resize(); this.draw();
    this.opts.onChange();
    return n;
  }
  deleteSelected() {
    if (!this.selectedId) return;
    this.notes = this.notes.filter((n) => n.id !== this.selectedId);
    this.selectedId = null;
    this.opts.onSelect(null);
    this.resize(); this.draw();
    this.opts.onChange();
  }
  updateNote(id, patch) {
    const n = this.notes.find((x) => x.id === id);
    if (!n) return;
    Object.assign(n, patch);
    if (patch.start !== undefined) n.start = Math.max(0, n.start);
    if (patch.duration !== undefined) n.duration = Math.max(0.02, n.duration);
    this.opts.onChange();
    this.draw();
  }

  /* ---------- drawing ---------- */
  draw() {
    const ctx = this.ctx, o = this.opts;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.cssW, H = this.cssH;
    const cs = getComputedStyle(document.documentElement);
    const cBg = cs.getPropertyValue("--panel").trim() || "#14171c";
    const cLine = cs.getPropertyValue("--grid").trim() || "rgba(255,255,255,.05)";
    const cLineS = cs.getPropertyValue("--grid-strong").trim() || "rgba(255,255,255,.12)";
    const cText = cs.getPropertyValue("--muted").trim() || "#8b929c";
    const cFaint = cs.getPropertyValue("--faint").trim() || "#5b616b";
    const cAccent = cs.getPropertyValue("--accent").trim() || "#ff7a45";
    const cNoteA = cs.getPropertyValue("--note-a").trim() || "#ff9a5e";
    const cNoteB = cs.getPropertyValue("--note-b").trim() || "#ff6a30";
    const cNoteSel = cs.getPropertyValue("--note-sel").trim() || "#ffd79a";
    const cSel = cs.getPropertyValue("--accent-2").trim() || "#38d6c0";

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = cBg; ctx.fillRect(0, 0, W, H);

    // key rows + labels
    for (let m = o.midiLow; m <= o.midiHigh; m++) {
      const y = this.midiToY(m);
      if (this.isBlack(m)) { ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(0, y, W, o.rowH); }
      ctx.strokeStyle = cLine; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(o.leftPad, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
      if (m % 12 === 0) {
        ctx.fillStyle = cText; ctx.font = "10px JetBrains Mono, monospace"; ctx.textBaseline = "middle";
        ctx.fillText(this.noteName(m), 8, y + o.rowH / 2);
      }
    }
    ctx.strokeStyle = cLine; ctx.beginPath(); ctx.moveTo(o.leftPad, H - 0.5); ctx.lineTo(W, H - 0.5); ctx.stroke();

    // beat grid
    const beats = this.contentBeats();
    for (let b = 0; b <= beats; b++) {
      const x = this.beatToX(b);
      ctx.strokeStyle = (b % 4 === 0) ? cLineS : cLine; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    }

    // notes
    for (const n of this.notes) {
      const x = this.beatToX(n.start);
      const w = Math.max(3, n.duration * o.pxPerBeat);
      const y = this.midiToY(n.midi);
      const sel = n.id === this.selectedId;
      const grad = ctx.createLinearGradient(x, y, x, y + o.rowH);
      grad.addColorStop(0, cNoteA); grad.addColorStop(1, cNoteB);
      this._roundRect(x + 1, y + 1.5, w - 2, o.rowH - 3, 4);
      ctx.fillStyle = grad; ctx.fill();
      if (sel) {
        ctx.strokeStyle = cNoteSel; ctx.lineWidth = 2;
        this._roundRect(x + 1, y + 1.5, w - 2, o.rowH - 3, 4); ctx.stroke();
        // resize handle
        ctx.fillStyle = cNoteSel;
        ctx.fillRect(x + w - 4, y + o.rowH / 2 - 4, 3, 8);
      } else {
        ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
        this._roundRect(x + 1, y + 1.5, w - 2, o.rowH - 3, 4); ctx.stroke();
      }
      if (n.lyric) {
        ctx.fillStyle = "rgba(26,14,6,0.92)"; ctx.font = "11px Space Grotesk, sans-serif";
        ctx.textBaseline = "middle"; ctx.textAlign = "left";
        ctx.fillText(n.lyric, x + 6, y + o.rowH / 2 + 0.5);
      }
    }

    // playhead
    if (this.playhead != null) {
      const x = this.beatToX(this.playhead);
      ctx.strokeStyle = cSel; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- interaction ---------- */
  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  _hit(x, y) {
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      const nx = this.beatToX(n.start);
      const nw = Math.max(3, n.duration * this.opts.pxPerBeat);
      const ny = this.midiToY(n.midi);
      if (x >= nx && x <= nx + nw && y >= ny && y <= ny + this.opts.rowH) {
        return { note: n, onEdge: x >= nx + nw - 6 };
      }
    }
    return null;
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      const p = this._pos(e);
      const hit = this._hit(p.x, p.y);
      if (hit) {
        this.selectedId = hit.note.id;
        this.opts.onSelect(hit.note);
        this.dragging = {
          mode: hit.onEdge ? "resize" : "move",
          note: hit.note,
          offBeats: this.xToBeat(p.x) - hit.note.start,
          offMidi: this.yToMidi(p.y) - hit.note.midi,
        };
        c.setPointerCapture(e.pointerId);
        this.draw();
      } else {
        if (p.x >= this.opts.leftPad) {
          const midi = this.yToMidi(p.y);
          const beat = this.snap(this.xToBeat(p.x));
          this.addNote(midi, beat);
        }
      }
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const p = this._pos(e);
      const d = this.dragging, n = d.note;
      if (d.mode === "move") {
        const nb = this.snap(this.xToBeat(p.x) - d.offBeats);
        const nm = this.yToMidi(p.y) - d.offMidi;
        n.start = Math.max(0, nb);
        n.midi = nm;
      } else {
        const nb = this.snap(this.xToBeat(p.x));
        n.duration = Math.max(this.opts.snap, nb - n.start);
      }
      this.resize(); this.draw();
    });
    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = null;
      try { c.releasePointerCapture(e.pointerId); } catch (_) {}
      this.opts.onChange();
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", (e) => {
      const p = this._pos(e);
      const hit = this._hit(p.x, p.y);
      if (hit) { this.selectedId = hit.note.id; this.opts.onNoteDblClick(hit.note); }
    });
  }
}

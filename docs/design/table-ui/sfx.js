// ── 音效：全部用 WebAudio 合成，不加载任何音频文件 ──────────
// 真实牌局的声音很短、很干：筹码是黏土块的"哒"，发牌是布面摩擦的"唰"。
const SFX = (() => {
  let ac = null, on = true, master = null;

  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  /** 一段白噪声缓冲，用来做摩擦与碰撞的底子 */
  function noise(dur) {
    const c = ctx(), n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function env(node, { attack = 0.002, decay = 0.08, peak = 1 }) {
    const c = ctx(), g = c.createGain(), t = c.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    return g;
  }

  /** 单枚筹码落下：短噪声 + 两个高频共振，像黏土互敲 */
  function chip(vary = 0) {
    if (!on) return;
    const c = ctx(), t = c.currentTime;
    const src = noise(0.07);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400 + vary * 220;
    bp.Q.value = 3.5;
    src.connect(bp);
    const g = env(bp, { decay: 0.055, peak: 0.5 });
    g.connect(master);
    src.start(t); src.stop(t + 0.08);

    [3100 + vary * 180, 4700 + vary * 260].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const og = env(o, { decay: 0.035, peak: 0.10 - i * 0.04 });
      og.connect(master);
      o.start(t); o.stop(t + 0.05);
    });
  }

  /** 一叠筹码：几枚错开落下 */
  function chips(count = 4) {
    if (!on) return;
    for (let i = 0; i < count; i++) {
      setTimeout(() => chip(i % 4), i * 42 + Math.random() * 14);
    }
  }

  /** 发牌：一道向下扫的窄带噪声，像卡片擦过桌布 */
  function deal() {
    if (!on) return;
    const c = ctx(), t = c.currentTime;
    const src = noise(0.13);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(3600, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.12);
    src.connect(bp);
    const g = env(bp, { attack: 0.006, decay: 0.11, peak: 0.32 });
    g.connect(master);
    src.start(t); src.stop(t + 0.14);
  }

  /** 轮到你：两声柔和的提示 */
  function turn() {
    if (!on) return;
    const c = ctx(), t = c.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t + i * 0.11);
      g.gain.linearRampToValueAtTime(0.16, t + i * 0.11 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.11 + 0.22);
      o.connect(g); g.connect(master);
      o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.24);
    });
  }

  /** 赢池：上行三音 + 一片筹码 */
  function win() {
    if (!on) return;
    const c = ctx(), t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = c.createGain();
      const s = t + i * 0.075;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.14, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3);
      o.connect(g); g.connect(master);
      o.start(s); o.stop(s + 0.32);
    });
    setTimeout(() => chips(7), 160);
  }

  /** 弃牌：一声闷响 */
  function fold() {
    if (!on) return;
    const c = ctx(), t = c.currentTime;
    const src = noise(0.09);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    src.connect(lp);
    const g = env(lp, { decay: 0.08, peak: 0.3 });
    g.connect(master);
    src.start(t); src.stop(t + 0.1);
  }

  return {
    chip, chips, deal, turn, win, fold,
    get enabled() { return on; },
    toggle() { on = !on; if (on) ctx(); return on; },
    set volume(v) { if (master) master.gain.value = v; },
  };
})();

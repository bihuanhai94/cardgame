// ── 面额与拆分 ──────────────────────────────────────
const DENOMS = [
  { v: 1000, cls: 'd1000' },
  { v: 500,  cls: 'd500'  },
  { v: 100,  cls: 'd100'  },
  { v: 25,   cls: 'd25'   },
  { v: 5,    cls: 'd5'    },
];

/** 拆分金额为筹码序列（大面额优先），最多 cap 枚 */
function breakdown(amount, cap = 40) {
  const out = [];
  let left = amount;
  for (const d of DENOMS) {
    while (left >= d.v && out.length < cap) { out.push(d); left -= d.v; }
  }
  return out;
}

/**
 * 码成摞 —— 用于玩家自己的筹码。
 * 每摞最多 perCol 枚，满了开新摞。元素不旋转，只微调条纹角度。
 */
function renderPile(el, amount, opts = {}) {
  const { w = 22, perCol = 9, cap = 40, animateFrom = null } = opts;
  const chips = breakdown(amount, cap);
  const lift = w * 0.155;

  const cols = [];
  for (let i = 0; i < chips.length; i += perCol) cols.push(chips.slice(i, i + perCol));

  el.className = 'pile';
  el.innerHTML = cols.map((col, ci) => {
    const h = w * 0.30 + lift * (col.length - 1);
    const inner = col.map((c, i) => {
      const idx = ci * perCol + i;
      const isNew = animateFrom !== null && idx >= animateFrom;
      const jx = ((idx * 37) % 7 - 3) * 0.4;          // 手码的轻微错位
      const spin = (idx * 47) % 360;                   // 只转条纹，不转本体
      return `<div class="chip3d ${c.cls}${isNew ? ' new' : ''}"
        style="--cw:${w}px; --spin:${spin}deg; bottom:${i * lift}px; margin-left:${jx}px;
               animation-delay:${isNew ? (idx - animateFrom) * 45 : 0}ms"></div>`;
    }).join('');
    return `<span class="col" style="width:${w}px;height:${h}px">${inner}</span>`;
  }).join('');

  return chips.length;
}

/**
 * 计算第 i 枚筹码在堆中的落点。
 * 位置只依赖 i，不依赖总数 —— 所以后来的筹码不会挤动先前的。
 */
function chipPlacement(i, opts) {
  const { w, cap, boxW } = opts;
  const R = boxW / 2 - w / 2 - 2;
  const r = R * Math.sqrt((i + 0.5) / cap);
  const a = i * 2.39996;                        // 黄金角
  const jx = ((i * 41) % 11 - 5) * 0.45;
  const jy = ((i * 67) % 9  - 4) * 0.3;
  return {
    x: Math.cos(a) * r + jx,
    y: Math.sin(a) * r * 0.40 + jy,             // 压扁成椭圆 → 俯视透视
    lift: (1 - r / R) * (w * 0.5),              // 越靠中心越高
    spin: (i * 53) % 360,
  };
}

/**
 * 累积式底池。
 * 池子保存的是「实际被推进来的那些筹码」，不是按总额重算的结果 ——
 * 所以飞进来什么颜色，落下就是什么颜色。
 *
 * 新增筹码时只往 DOM 里追加新节点，绝不重建已有的 ——
 * 层叠顺序靠显式 z-index 而非 DOM 顺序，因此追加不会打乱压盖关系。
 */
function createHeap(el, opts = {}) {
  const o = { w: 20, cap: 46, boxW: 190, boxH: 88, ...opts };
  let chips = [];                                // {cls, v, x, y, lift, spin, node}

  el.className = 'heap';
  el.style.width = o.boxW + 'px';
  el.style.height = o.boxH + 'px';

  function makeNode(c, animate) {
    const n = document.createElement('div');
    n.className = 'chip3d ' + c.cls + (animate ? ' new' : '');
    n.style.cssText =
      `--cw:${o.w}px;--spin:${c.spin}deg;` +
      `left:calc(50% + ${c.x.toFixed(1)}px - ${o.w / 2}px);` +
      `top:calc(50% + ${(c.y - c.lift).toFixed(1)}px);` +
      `z-index:${Math.round(100 + c.y - c.lift)};`;
    return n;
  }

  function sizeShadow() {
    el.style.setProperty('--hw', Math.min(o.boxW, 40 + chips.length * 3.2) + 'px');
  }

  /** 换大筹码：池子太满时把最早的一批小面额并成大面额（荷官的 color up） */
  function colorUp() {
    let guard = 0;
    while (chips.length > o.cap && guard++ < 20) {
      const before = chips.length;
      const gone = chips.splice(0, 6);
      gone.forEach(c => c.node.remove());
      const sum = gone.reduce((s, c) => s + c.v, 0);
      breakdown(sum, 6).forEach(d => chips.push({ cls: d.cls, v: d.v }));
      if (chips.length >= before) break;
    }
    // 重排落点并整体重绘（这一步很少发生）
    el.innerHTML = '';
    chips.forEach((c, i) => {
      Object.assign(c, chipPlacement(i, o));
      c.node = makeNode(c, false);
      el.appendChild(c.node);
    });
    sizeShadow();
  }

  return {
    /** 推入一笔钱；传 denoms 则完全按它的面额构成落下（与飞过来的筹码一致） */
    add(amount, denoms) {
      const list = denoms || breakdown(amount, 24);
      let delay = 0;
      list.forEach(d => {
        const c = { cls: d.cls, v: d.v, ...chipPlacement(chips.length, o) };
        c.node = makeNode(c, true);
        c.node.style.animationDelay = delay + 'ms';
        delay += 38;
        chips.push(c);
        el.appendChild(c.node);            // 只追加，不碰已有节点
      });
      if (chips.length > o.cap) colorUp();
      sizeShadow();
      return chips.length;
    },
    clear() { chips = []; el.innerHTML = ''; sizeShadow(); },
    get count() { return chips.length; },
  };
}

// ── 数字滚动 ────────────────────────────────────────
function rollTo(el, from, to, ms = 700) {
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * e).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── 筹码飞行 ────────────────────────────────────────
function flyChips(fromEl, toEl, amount, opts = {}) {
  const { count = 5, dur = 520, spread = 26, w = 20 } = opts;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const chips = breakdown(amount, count);

  return new Promise((resolve) => {
    if (!chips.length) return resolve([]);
    chips.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = `chip3d ${c.cls} flyer`;
      el.style.setProperty('--cw', w + 'px');
      el.style.setProperty('--spin', ((i * 61) % 360) + 'deg');
      el.style.left = (a.left + a.width / 2 - w / 2) + 'px';
      el.style.top  = (a.top  + a.height / 2) + 'px';
      document.body.appendChild(el);

      const jx = (Math.random() - .5) * spread;
      const jy = (Math.random() - .5) * spread * .5;
      const dx = (b.left + b.width / 2 - w / 2 + jx) - (a.left + a.width / 2 - w / 2);
      const dy = (b.top  + b.height / 2 + jy) - (a.top  + a.height / 2);

      requestAnimationFrame(() => {
        el.style.transition = `transform ${dur}ms cubic-bezier(.25,.75,.35,1)`;
        el.style.transitionDelay = (i * 45) + 'ms';
        el.style.transform = `translate(${dx}px, ${dy}px)`;   // 不旋转本体
      });
      setTimeout(() => {
        el.remove();
        if (i === chips.length - 1) resolve(chips);
      }, dur + i * 45 + 20);
    });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

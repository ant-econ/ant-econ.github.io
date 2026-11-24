/* 개미일지 계산기 — 공용 계산·차트 키트 (외부 라이브러리 없이 동작) */
(function (w) {
  'use strict';
  var K = {};

  K.$ = function (s, r) { return (r || document).querySelector(s); };
  K.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  K.el = function (id) { return document.getElementById(id); };

  function toNum(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[,\s원$%]/g, ''));
    return isFinite(n) ? n : 0;
  }
  K.num = function (el, def) {
    if (!el) return def == null ? 0 : def;
    var raw = (el.value != null ? el.value : el);
    if (raw === '' || raw == null) return def == null ? 0 : def;
    var n = toNum(raw);
    return isFinite(n) ? n : (def == null ? 0 : def);
  };

  K.won = function (n) {
    if (!isFinite(n)) n = 0;
    var neg = n < 0;
    var s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s + '원';
  };
  K.num3 = function (n) {
    if (!isFinite(n)) n = 0;
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  K.pct = function (n, d) {
    if (!isFinite(n)) n = 0;
    return n.toFixed(d == null ? 2 : d) + '%';
  };
  K.usd = function (n) {
    if (!isFinite(n)) n = 0;
    var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + '$' + s;
  };
  K.shortWon = function (v) {
    var a = Math.abs(v);
    var sign = v < 0 ? '-' : '';
    if (a >= 1e12) return sign + (a / 1e12).toFixed(a >= 1e13 ? 0 : 1) + '조';
    if (a >= 1e8) return sign + (a / 1e8).toFixed(a >= 1e9 ? 0 : 1) + '억';
    if (a >= 1e4) return sign + Math.round(a / 1e4).toLocaleString('ko-KR') + '만';
    return sign + Math.round(a).toLocaleString('ko-KR');
  };
  K.compact = function (v) {
    var a = Math.abs(v), sign = v < 0 ? '-' : '';
    if (a >= 1e8) return sign + (a / 1e8).toFixed(a >= 1e9 ? 1 : 2) + '억';
    if (a >= 1e4) return sign + (a / 1e4).toFixed(1) + '만';
    return sign + Math.round(a).toLocaleString('ko-KR');
  };

  /* 이벤트 묶음 */
  K.on = function (els, fn, type) {
    (Array.isArray(els) ? els : [els]).forEach(function (el) {
      if (!el) return;
      el.addEventListener(type || 'input', fn);
    });
  };
  K.onChange = function (els, fn) { K.on(els, fn, 'change'); };

  /* 금액 입력 콤마 포맷 (문서 전체 위임) */
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('money')) return;
    var digits = (t.value || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    t.value = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }, true);

  /* 테마 */
  function paintTheme() {
    var dark = document.documentElement.getAttribute('data-theme') !== 'light';
    K.$$('.themebtn').forEach(function (b) { b.textContent = dark ? '☾' : '☀'; });
  }
  K.theme = function (onChange) {
    try {
      var saved = localStorage.getItem('ant-theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch (e) {}
    paintTheme();
    K.$$('.themebtn').forEach(function (b) {
      b.addEventListener('click', function () {
        var dark = document.documentElement.getAttribute('data-theme') !== 'light';
        document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
        try { localStorage.setItem('ant-theme', dark ? 'light' : 'dark'); } catch (e) {}
        paintTheme();
        if (onChange) onChange();
      });
    });
  };

  K.cssVar = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  };
  K.color = function (name) {
    var map = { accent: '--accent', accent2: '--accent-2', up: '--up', down: '--down', warn: '--warn', muted: '--muted', text: '--text', line: '--line' };
    return K.cssVar(map[name] || name);
  };
  function alpha(color, a) {
    if (!color || color.charAt(0) !== '#') return color;
    var h = color.slice(1);
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  K.alpha = alpha;

  /* ---------- 캔버스 공통 ---------- */
  K.prep = function (cv) {
    var dpr = w.devicePixelRatio || 1;
    var cw = cv.clientWidth || 640;
    var ch = cv.clientHeight || 260;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr);
      cv.height = Math.round(ch * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.font = '11px -apple-system,"Pretendard","Noto Sans KR",sans-serif';
    ctx.textBaseline = 'middle';
    return { ctx: ctx, w: cw, h: ch };
  };
  K.niceStep = function (v) {
    if (!isFinite(v) || v <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var m = v / e;
    var n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * e;
  };

  /* 선·영역 그래프 */
  K.plot = function (cv, cfg) {
    if (!cv) return;
    var p = K.prep(cv), ctx = p.ctx, W = p.w, H = p.h;
    var labels = cfg.labels || [];
    var series = (cfg.series || []).filter(function (s) { return s && s.data && s.data.length; });
    if (!series.length) return;
    var n = 1;
    series.forEach(function (s) { n = Math.max(n, s.data.length); });
    var padL = cfg.padL || 52, padR = cfg.padR || 14, padT = 14, padB = 26;
    var iw = Math.max(20, W - padL - padR), ih = Math.max(20, H - padT - padB);

    var vals = [];
    series.forEach(function (s) {
      s.data.forEach(function (v) { if (isFinite(v)) vals.push(v); });
    });
    if (!vals.length) return;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (cfg.yMin != null) lo = Math.min(lo, cfg.yMin);
    if (cfg.yMax != null) hi = Math.max(hi, cfg.yMax);
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
    if (hi === lo) hi = lo + 1;
    var step = K.niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    if (hi === lo) hi = lo + step;
    var count = Math.round((hi - lo) / step);
    if (count > 9) { step = K.niceStep((hi - lo) / 4) * 2; count = Math.round((hi - lo) / step); }

    var y = function (v) { return padT + ih - (v - lo) / (hi - lo) * ih; };
    var x = function (i) { return n <= 1 ? padL + iw / 2 : padL + iw * (i / (n - 1)); };

    var grid = K.color('line'), muted = K.color('muted'), fmt = cfg.yFmt || K.shortWon;
    ctx.textAlign = 'right';
    for (var k = 0; k <= count; k++) {
      var val = lo + k * step;
      var yy = Math.round(y(val)) + 0.5;
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + iw, yy); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(fmt(val), padL - 8, y(val));
    }
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = muted; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, Math.round(y(0)) + 0.5); ctx.lineTo(padL + iw, Math.round(y(0)) + 0.5); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    series.forEach(function (s) {
      var c = s.color || K.color('accent');
      if (s.fill) {
        var g = ctx.createLinearGradient(0, padT, 0, padT + ih);
        g.addColorStop(0, alpha(c, 0.26));
        g.addColorStop(1, alpha(c, 0));
        ctx.beginPath();
        ctx.moveTo(x(0), y(s.base != null ? s.base : Math.max(lo, 0)));
        s.data.forEach(function (v, i) { ctx.lineTo(x(i), y(v)); });
        ctx.lineTo(x(s.data.length - 1), y(s.base != null ? s.base : Math.max(lo, 0)));
        ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      }
      ctx.strokeStyle = c; ctx.lineWidth = s.width || 2.2;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.data.forEach(function (v, i) {
        var px = x(i), py = y(v);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke(); ctx.setLineDash([]);
      if (s.dots) {
        ctx.fillStyle = c;
        s.data.forEach(function (v, i) {
          if (s.dotsEvery && i % s.dotsEvery !== 0) return;
          ctx.beginPath(); ctx.arc(x(i), y(v), 2.6, 0, Math.PI * 2); ctx.fill();
        });
      }
    });

    if (labels.length) {
      ctx.fillStyle = muted;
      var every = Math.max(1, Math.ceil(n / (cfg.xTicks || 8)));
      var lastDrawn = -99;
      for (var i = 0; i < n; i++) {
        if (i % every !== 0 && i !== n - 1) continue;
        if (labels[i] == null || labels[i] === '') continue;
        if (i === n - 1 && (n - 1 - lastDrawn) < every * 0.6) continue;
        lastDrawn = i;
        var px2 = x(i);
        ctx.textAlign = px2 < padL + 18 ? 'left' : (px2 > padL + iw - 18 ? 'right' : 'center');
        ctx.fillText(String(labels[i]), px2, padT + ih + 13);
      }
    }

    (cfg.markers || []).forEach(function (m) {
      var i = m.i != null ? m.i : m.x;
      if (i == null || i < 0) return;
      var px = x(i);
      var mc = m.color || K.color('warn');
      ctx.strokeStyle = mc; ctx.lineWidth = 1.4; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + ih); ctx.stroke();
      ctx.setLineDash([]);
      if (m.label) {
        ctx.fillStyle = mc; ctx.textAlign = 'center';
        ctx.fillText(m.label, Math.min(padL + iw - 34, Math.max(padL + 34, px)), padT + 7);
      }
    });

    (cfg.notes || []).forEach(function (t) {
      var c = t.color || muted;
      ctx.fillStyle = c; ctx.textAlign = t.align || 'left';
      ctx.font = '11px -apple-system,"Noto Sans KR",sans-serif';
      ctx.fillText(t.text, t.x != null ? t.x : padL, t.y != null ? t.y : padT + 6);
    });
  };

  /* 막대 그래프 (그룹형) */
  K.bars = function (cv, cfg) {
    if (!cv) return;
    var p = K.prep(cv), ctx = p.ctx, W = p.w, H = p.h;
    var labels = cfg.labels || [];
    var series = (cfg.series || []).filter(function (s) { return s && s.data; });
    var n = labels.length || (series[0] ? series[0].data.length : 0);
    if (!n || !series.length) return;
    var padL = cfg.padL || 52, padR = cfg.padR || 14, padT = 16, padB = 26;
    var iw = Math.max(20, W - padL - padR), ih = Math.max(20, H - padT - padB);
    var vals = [];
    series.forEach(function (s) { s.data.forEach(function (v) { if (isFinite(v)) vals.push(v); }); });
    if (!vals.length) return;
    var hi = Math.max.apply(null, vals.concat([0]));
    var lo = Math.min.apply(null, vals.concat([0]));
    if (hi === lo) hi = lo + 1;
    var step = K.niceStep((hi - lo) / 4);
    hi = Math.ceil(hi / step) * step;
    lo = Math.floor(lo / step) * step;
    var count = Math.round((hi - lo) / step);
    var y = function (v) { return padT + ih - (v - lo) / (hi - lo) * ih; };
    var grid = K.color('line'), muted = K.color('muted'), fmt = cfg.yFmt || K.shortWon;

    ctx.textAlign = 'right';
    for (var k = 0; k <= count; k++) {
      var val = lo + k * step, yy = Math.round(y(val)) + 0.5;
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + iw, yy); ctx.stroke();
      ctx.fillStyle = muted; ctx.fillText(fmt(val), padL - 8, y(val));
    }
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = muted; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, Math.round(y(0)) + 0.5); ctx.lineTo(padL + iw, Math.round(y(0)) + 0.5); ctx.stroke();
    }

    var slot = iw / n;
    var bw = Math.max(4, Math.min(34, slot * 0.66 / series.length));
    var zero = y(0);
    series.forEach(function (s, si) {
      var c = s.color || K.color('accent');
      s.data.forEach(function (v, i) {
        var cx = padL + slot * (i + 0.5) - (bw * series.length + 2 * (series.length - 1)) / 2 + si * (bw + 2);
        var top = y(Math.max(0, v)), bot = y(Math.min(0, v));
        ctx.fillStyle = s.soft ? alpha(c, s.soft) : c;
        ctx.fillRect(cx, top, bw, Math.max(1, bot - top));
      });
    });
    ctx.fillStyle = muted; ctx.textAlign = 'center';
    var every = Math.max(1, Math.ceil(n / (cfg.xTicks || 8)));
    for (var i = 0; i < n; i++) {
      if (i % every !== 0 && i !== n - 1) continue;
      ctx.fillText(String(labels[i]), padL + slot * (i + 0.5), padT + ih + 13);
    }
  };

  K.eachResize = function (fn) {
    var t;
    w.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(fn, 120); });
  };

  w.KIT = K;
})(window);

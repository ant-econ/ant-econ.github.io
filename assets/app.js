/* 주식하는 개구리 계산기 — 계산 로직 & 차트 (라이브러리 없이 동작) */
(function () {
  'use strict';

  /* ---------- 공통 유틸 ---------- */
  var won = function (n) {
    if (!isFinite(n)) n = 0;
    var neg = n < 0;
    var s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s + '원';
  };
  var num = function (el, def) {
    var v = parseFloat((el && el.value || '').replace(/,/g, ''));
    return isFinite(v) ? v : (def || 0);
  };
  var pct = function (n, d) { return (isFinite(n) ? n : 0).toFixed(d == null ? 2 : d) + '%'; };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  /* 화면 상태 (계산 함수보다 먼저 초기화되어야 함) */
  var compSeries = [];
  var divState = { gross: 0, net: 0, freq: 4, n: 0 };

  /* ---------- 금액 입력 콤마 포맷 ---------- */
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('money')) return;
    var digits = (t.value || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    t.value = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }, true);

  /* ---------- 테마 ---------- */
  var themeBtn = $('#themebtn');
  var themeRoot = document.documentElement;
  var themeKey = themeRoot.getAttribute('data-theme-key') || 'ant-theme';
  var themeDefault = themeRoot.getAttribute('data-theme-default');
  var saved = null;
  try { saved = localStorage.getItem(themeKey); } catch (e) {}
  if (saved === 'dark' || saved === 'light') themeRoot.setAttribute('data-theme', saved);
  else if (themeDefault) themeRoot.setAttribute('data-theme', themeDefault);
  var paintBtn = function () {
    var dark = document.documentElement.getAttribute('data-theme') !== 'light';
    if (themeBtn) themeBtn.textContent = dark ? '☾' : '☀';
  };
  paintBtn();
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var dark = document.documentElement.getAttribute('data-theme') !== 'light';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    try { localStorage.setItem(themeKey, dark ? 'light' : 'dark'); } catch (e) {}
    paintBtn();
    drawAll();
  });

  /* ---------- 탭 ---------- */
  var tabs = $$('.tabs button');
  var panels = $$('.panel');
  function showTab(name, scroll) {
    tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    panels.forEach(function (p) {
      var on = p.id === 'panel-' + name;
      p.classList.toggle('show', on);
      if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
    $$('nav.top a').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === name); });
    drawAll();
    if (scroll) {
      var t = $('.tabs');
      if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.pageYOffset - 70, behavior: 'smooth' });
    }
  }
  tabs.forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab, false); }); });
  $$('nav.top a[data-tab]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); showTab(a.dataset.tab, true); });
  });

  /* ================= 1. 양도소득세 ================= */
  var ledger = $('#ledger');
  function addRow(sell, buy, fee) {
    var row = document.createElement('div');
    row.className = 'lrow';
    row.innerHTML =
      '<div class="inp"><input type="text" inputmode="numeric" class="money sell" placeholder="매도금액" aria-label="매도금액" autocomplete="off" value="' + (sell || '') + '"></div>' +
      '<div class="inp"><input type="text" inputmode="numeric" class="money buy" placeholder="매입금액" aria-label="매입금액" autocomplete="off" value="' + (buy || '') + '"></div>' +
      '<div class="inp"><input type="text" inputmode="numeric" class="money fee" placeholder="필요경비" aria-label="필요경비" autocomplete="off" value="' + (fee == null ? '0' : fee) + '"></div>' +
      '<button class="del" aria-label="이 매도 건 삭제" title="삭제">✕</button>';
    ledger.appendChild(row);
    bindRow(row);
    calcTax();
  }
  function bindRow(row) {
    $$('input', row).forEach(function (i) { i.addEventListener('input', calcTax); });
    var d = $('.del', row);
    if (d) d.addEventListener('click', function () {
      if ($$('.lrow', ledger).length > 1) { row.remove(); calcTax(); }
    });
  }
  $$('.lrow', ledger).forEach(bindRow);
  var addBtn = $('#addtrade');
  if (addBtn) addBtn.addEventListener('click', function () { addRow('', '', 0); });
  var carry = $('#lossCarry');
  if (carry) carry.addEventListener('change', calcTax);

  function calcTax() {
    if (!ledger) return;
    var gross = 0, fees = 0, rows = $$('.lrow', ledger);
    rows.forEach(function (r) {
      var sell = num($('.sell', r)), buy = num($('.buy', r)), fee = num($('.fee', r));
      var g = sell - buy;
      var incl = (carry && !carry.checked) ? (g - fee > 0) : true;
      if (incl) { gross += g; fees += fee; }
    });
    var income = gross - fees;
    var base = Math.max(0, income - 2500000);
    var tax = base * 0.22;
    var incTax = base * 0.20, locTax = base * 0.02;
    var net = income - tax;
    var rate = gross > 0 ? (tax / gross * 100) : 0;

    $('#tax-gain').textContent = won(gross);
    $('#tax-fee').textContent = won(fees);
    $('#tax-deduct').textContent = '-' + won(Math.min(2500000, Math.max(0, income)));
    $('#tax-base').textContent = won(base);
    $('#tax-income').textContent = won(incTax);
    $('#tax-local').textContent = won(locTax);
    $('#tax-amount').textContent = won(tax);
    $('#tax-net').textContent = won(net);
    $('#tax-net').className = net >= 0 ? 'pos' : 'neg';
    $('#tax-rate').textContent = pct(rate, 2);

    var msg = $('#tax-msg');
    if (income <= 0) {
      msg.className = 'note';
      msg.innerHTML = '양도소득이 없거나 손실입니다. 이 경우 세금은 0원이고, 같은 해 다른 해외주식 이익과 통산할 수 있습니다.';
    } else if (income <= 2500000) {
      msg.className = 'note';
      msg.innerHTML = '양도소득 <strong>' + won(income) + '</strong>은 기본공제 250만 원 이하라 <strong>세금 0원</strong>입니다. 다만 해외주식은 차익이 있으면 금액과 관계없이 확정신고 대상이니, 신고 여부는 홈택스 안내를 확인하세요.';
    } else {
      msg.className = 'note warn';
      msg.innerHTML = '과세표준 <strong>' + won(base) + '</strong>에 22%(소득세 20% + 지방소득세 2%)가 적용됩니다. 다음 해 <strong>5월 1~31일</strong> 홈택스에서 신고·납부하세요.';
    }
  }
  calcTax();

  /* ================= 2. 복리 ================= */
  var cInit = $('#c-init'), cMonth = $('#c-month'), cRate = $('#c-rate'),
      cYears = $('#c-years'), cWhen = $('#c-when'), cInfl = $('#c-infl'), cChart = $('#c-chart');

  function calcCompound() {
    if (!cInit) return;
    var init = Math.max(0, num(cInit)), monthly = Math.max(0, num(cMonth));
    var rate = num(cRate), years = Math.max(1, Math.min(60, Math.round(num(cYears, 20))));
    var infl = Math.max(0, num(cInfl));
    if (years !== num(cYears, years)) years = Math.max(1, Math.min(60, Math.round(num(cYears))));
    var when = cWhen.value;
    var mr = rate <= -100 ? -1 : Math.pow(1 + rate / 100, 1 / 12) - 1;

    var bal = init, paid = init;
    var series = [{ year: 0, paid: paid, value: bal }];
    for (var y = 1; y <= years; y++) {
      for (var m = 0; m < 12; m++) {
        if (when === 'begin') bal = bal * (1 + mr) + monthly;
        else bal = (bal + monthly) * (1 + mr);
        paid += monthly;
      }
      series.push({ year: y, paid: paid, value: bal });
    }
    compSeries = series;
    var profit = bal - paid;
    var real = infl > 0 ? bal / Math.pow(1 + infl / 100, years) : bal;

    $('#c-final').textContent = won(bal);
    $('#c-final').className = bal >= paid ? 'pos' : 'neg';
    $('#c-paid').textContent = won(paid);
    $('#c-profit').textContent = won(profit);
    $('#c-profit').className = profit >= 0 ? 'pos' : 'neg';
    $('#c-ror').textContent = paid > 0 ? pct(profit / paid * 100, 1) : '—';
    $('#c-mult').textContent = paid > 0 ? (bal / paid).toFixed(2) + '배' : '—';
    $('#c-real').textContent = infl > 0 ? won(real) : '물가상승률 0%';

    var tb = $('#c-table tbody');
    if (tb) {
      var html = '';
      var step = years > 30 ? 5 : (years > 15 ? 2 : 1);
      for (var i = 1; i < series.length; i++) {
        var s = series[i];
        var p = s.value - s.paid;
        if (i % step !== 0 && i !== series.length - 1) continue;
        html += '<tr><td>' + i + '년</td><td>' + won(s.paid) + '</td><td>' + won(s.value) +
          '</td><td class="pos">' + won(p) + '</td><td>' + pct(s.paid > 0 ? p / s.paid * 100 : 0, 1) + '</td></tr>';
      }
      tb.innerHTML = html;
    }
    drawCompound();
  }
  [cInit, cMonth, cRate, cYears, cInfl].forEach(function (el) { if (el) el.addEventListener('input', calcCompound); });
  if (cWhen) cWhen.addEventListener('change', calcCompound);
  calcCompound();

  /* ================= 3. 배당 ================= */
  var dAmount = $('#d-amount'), dYield = $('#d-yield'), dFreq = $('#d-freq'),
      dWht = $('#d-wht'), dOther = $('#d-other'), dMarg = $('#d-marg'), dChart = $('#d-chart');

  function calcDividend() {
    if (!dAmount) return;
    var amount = Math.max(0, num(dAmount));
    var y = Math.max(0, num(dYield));
    var freq = parseInt(dFreq.value, 10) || 4;
    var wht = Math.max(0, Math.min(50, num(dWht)));
    var other = Math.max(0, num(dOther));
    var marg = parseFloat(dMarg.value) || 16.5;

    var gross = amount * y / 100;
    var tax = gross * wht / 100;
    var net = gross - tax;
    var total = gross + other;
    var each = net / freq;

    $('#d-gross').textContent = won(gross);
    $('#d-tax').textContent = '-' + won(tax);
    $('#d-net').textContent = won(net);
    $('#d-month').textContent = won(net / 12);
    $('#d-each').textContent = won(each);
    $('#d-netyield').textContent = amount > 0 ? pct(net / amount * 100, 2) : '0%';
    $('#d-total').textContent = won(total);

    var msg = $('#d-msg');
    if (total > 20000000) {
      var over = total - 20000000;
      var gap = Math.max(0, marg / 100 - 0.15);
      var extra = over * gap;
      msg.className = 'note warn';
      msg.innerHTML = '금융소득 합계 <strong>' + won(total) + '</strong>으로 2,000만 원을 넘습니다. 초과분 ' + won(over) +
        '은 종합소득세율 ' + marg + '%로 다른 소득과 합산 과세되며, 이미 원천징수된 15%를 빼면 추가 부담은 약 <strong>' +
        won(extra) + '</strong>입니다. 추가 반영 시 연 실수령은 약 <strong>' + won(net - extra) + '</strong>입니다.';
    } else {
      msg.className = 'note';
      msg.innerHTML = '금융소득 합계 ' + won(total) + '으로 2,000만 원 이하입니다. 원천징수 ' + wht + '%로 과세가 종결됩니다.';
    }
    divState = { gross: gross, net: net, freq: freq, n: freq };
    drawDividend();
  }
  [dAmount, dYield, dWht, dOther].forEach(function (el) { if (el) el.addEventListener('input', calcDividend); });
  [dFreq, dMarg].forEach(function (el) { if (el) el.addEventListener('change', calcDividend); });
  calcDividend();

  /* ================= 차트 공통 ================= */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  }
  function prep(cv) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight || 260;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function axisOf(peak) {
    var p = Math.max(peak || 0, 1);
    var step = niceStep(p / 4);
    while (step * 4 < p) step *= 2;
    return { step: step, max: step * 4 };
  }
  function niceStep(v) {
    var e = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var m = v / e;
    var n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * e;
  }
  function shortWon(v) {
    var a = Math.abs(v);
    if (a >= 100000000) return (v / 100000000).toFixed(a >= 1000000000 ? 0 : 1) + '억';
    if (a >= 10000) return Math.round(v / 10000).toLocaleString('ko-KR') + '만';
    return Math.round(v).toLocaleString('ko-KR');
  }

  function drawCompound() {
    if (!cChart) return;
    var p = prep(cChart), ctx = p.ctx, w = p.w, h = p.h;
    var data = compSeries;
    if (!data || data.length < 2) return;
    var padL = 52, padR = 46, padT = 14, padB = 26;
    var iw = w - padL - padR, ih = h - padT - padB;
    var peak = 0;
    data.forEach(function (d) { peak = Math.max(peak, d.value, d.paid); });
    var ax = axisOf(peak), maxV = ax.max;
    var grid = cssVar('--line'), muted = cssVar('--muted'), accent = cssVar('--accent'),
        accent2 = cssVar('--accent-2'), up = cssVar('--up');

    ctx.font = '11px -apple-system,"Noto Sans KR",sans-serif';
    ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var yy = padT + ih - (ih * g / 4);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy + .5); ctx.lineTo(padL + iw, yy + .5); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = 'right';
      ctx.fillText(shortWon(ax.step * g), padL - 8, yy);
    }

    var n = data.length - 1;
    var slot = iw / n;
    var bw = Math.max(3, Math.min(30, slot * 0.58));
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, accent2); grad.addColorStop(1, accent);

    data.forEach(function (d, i) {
      if (i === 0) return;
      var x = padL + slot * (i - 0.5) - bw / 2;
      var hAll = ih * (d.value / maxV);
      var hPaid = ih * (Math.min(d.paid, d.value) / maxV);
      var yTop = padT + ih - hAll;
      ctx.fillStyle = grad;
      ctx.beginPath();
      var r = Math.min(4, bw / 2);
      if (ctx.roundRect) { ctx.roundRect(x, yTop, bw, Math.max(1, hAll), [r, r, 0, 0]); ctx.fill(); }
      else ctx.fillRect(x, yTop, bw, Math.max(1, hAll));
      // 원금 구간 (아래쪽, 반투명)
      ctx.fillStyle = 'rgba(255,255,255,.30)';
      if (document.documentElement.getAttribute('data-theme') === 'light') ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillRect(x, padT + ih - hPaid, bw, Math.max(1, hPaid));
      // 수익금 구분선
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, padT + ih - hPaid); ctx.lineTo(x + bw, padT + ih - hPaid); ctx.stroke();
    });

    // 수익률(%) 라인
    ctx.strokeStyle = up; ctx.lineWidth = 2; ctx.beginPath();
    data.forEach(function (d, i) {
      if (i === 0) return;
      var x = padL + slot * (i - 0.5);
      var rr = d.paid > 0 ? (d.value - d.paid) / d.paid : 0;
      var yy = padT + ih - Math.min(1, Math.max(0, rr / 3)) * ih;
      if (i === 1) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    });
    ctx.stroke();
    ctx.fillStyle = up; ctx.textAlign = 'left';
    ctx.fillText('수익률', padL + iw + 6, padT + 8);

    // x축 라벨
    ctx.fillStyle = muted; ctx.textAlign = 'center';
    var step = n <= 10 ? 1 : Math.ceil(n / 8);
    data.forEach(function (d, i) {
      if (i === 0) return;
      if (i % step !== 0 && i !== n) return;
      ctx.fillText(i + '년', padL + slot * (i - 0.5), padT + ih + 13);
    });
  }

  function drawDividend() {
    if (!dChart) return;
    var p = prep(dChart), ctx = p.ctx, w = p.w, h = p.h;
    var n = divState.n || 4;
    var labels = { 12: '월', 4: '분기', 2: '반기', 1: '연' };
    var padL = 52, padR = 16, padT = 14, padB = 26;
    var iw = w - padL - padR, ih = h - padT - padB;
    var grossEach = divState.gross / n, netEach = divState.net / n;
    var ax = axisOf(Math.max(grossEach, netEach)), maxV = ax.max;
    var grid = cssVar('--line'), muted = cssVar('--muted'), accent = cssVar('--accent'), accent2 = cssVar('--accent-2');
    var soft = document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(29,92,246,.18)' : 'rgba(120,160,230,.30)';

    ctx.font = '11px -apple-system,"Noto Sans KR",sans-serif';
    ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var yy = padT + ih - (ih * g / 4);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy + .5); ctx.lineTo(padL + iw, yy + .5); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = 'right';
      ctx.fillText(shortWon(ax.step * g), padL - 8, yy);
    }

    var slot = iw / n;
    var bw = Math.max(6, Math.min(40, slot * 0.34));
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, accent2); grad.addColorStop(1, accent);

    for (var i = 0; i < n; i++) {
      var cx = padL + slot * (i + 0.5);
      var hG = ih * (grossEach / maxV), hN = ih * (netEach / maxV);
      ctx.fillStyle = soft;
      ctx.fillRect(cx - bw - 2, padT + ih - Math.max(1, hG), bw, Math.max(1, hG));
      ctx.fillStyle = grad;
      ctx.fillRect(cx + 2, padT + ih - Math.max(1, hN), bw, Math.max(1, hN));
      ctx.fillStyle = muted; ctx.textAlign = 'center';
      if (n <= 12) ctx.fillText((i + 1) + '회', cx, padT + ih + 13);
    }
    if (n > 12) { ctx.fillStyle = muted; ctx.fillText('1회', padL, padT + ih + 13); }
    ctx.fillStyle = muted; ctx.textAlign = 'left';
    ctx.fillText(labels[divState.freq] + ' 지급 기준', padL, padT + 6);
  }

  function drawAll() {
    try { drawCompound(); } catch (e) {}
    try { drawDividend(); } catch (e) {}
  }
  window.addEventListener('resize', function () {
    clearTimeout(window.__rt);
    window.__rt = setTimeout(drawAll, 120);
  });
  // 폰트/레이아웃 준비 후 한 번 더
  window.addEventListener('load', drawAll);
  setTimeout(drawAll, 60);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAll);

  /* 딥링크(#tax/#compound/#dividend)는 모든 계산기가 준비된 뒤에 적용 */
  var applyHash = function () {
    var h = (location.hash || '').replace('#', '');
    if (['tax', 'compound', 'dividend'].indexOf(h) >= 0) {
      try { showTab(h, false); } catch (e) {}
    }
  };
  applyHash();
  window.addEventListener('hashchange', applyHash);
})();

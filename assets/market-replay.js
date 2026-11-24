/* 개미일지 — 어제 장 실전 트레이딩 게임 (실제 5분봉 리플레이)
   데이터: data/market-replay.json (Yahoo Finance 실제 시세, 100% 실데이터)
   계좌: 원화 1,000만 원 시작 · 정수 주 매매 · 실제 수수료·증권거래세 반영 */
(function () {
  'use strict';
  var K = window.KIT;
  var $ = function (id) { return document.getElementById(id); };

  var DATA = null;
  var S = null;          // 진행 중 게임 상태
  var pick = { session: null, sym: null, blind: false };
  var raf = 0, acc = 0, lastTs = 0, toastTimer = 0;

  var SPEEDS = [1, 5, 15, 30];
  var BASE_MS = 1000; // 1배속 = 봉당 1초

  /* ---------------- 숫자·문자 ---------------- */
  function comma(n) {
    if (!isFinite(n)) n = 0;
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function won(n) { return comma(n) + '원'; }
  function usd(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pct(n, d) {
    if (!isFinite(n)) n = 0;
    var s = Math.abs(n).toFixed(d == null ? 2 : d);
    return (n > 0 ? '+' : n < 0 ? '-' : '') + s + '%';
  }
  function volTxt(v) {
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '억';
    if (v >= 1e4) return (v / 1e4).toFixed(0) + '만';
    return comma(v);
  }
  function cls(n) { return n > 0 ? 'up' : n < 0 ? 'dn' : 'flat'; }
  function hhmm(t, off) {
    var d = new Date((t + off * 60) * 1000);
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function weekday(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return '일월화수목금토'.charAt(d.getUTCDay());
  }
  function shortDate(dateStr) {
    var p = dateStr.split('-');
    return +p[1] + '/' + +p[2];
  }
  function sessionLabel(s) {
    return (s.market === 'KR' ? '한국장' : '미국장') + ' · ' + shortDate(s.date) + '(' + weekday(s.date) + ')';
  }
  function toast(msg) {
    var t = $('mr-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function css(name) { return K.cssVar(name) || '#888'; }

  /* ---------------- 계좌(localStorage) ---------------- */
  var ACCT_KEY = 'ant-market-replay-v1';
  var BASE_CASH = 10000000;
  function loadAcct() {
    var a = null;
    try { a = JSON.parse(localStorage.getItem(ACCT_KEY) || 'null'); } catch (e) { a = null; }
    if (!a || typeof a !== 'object') a = {};
    a.start = BASE_CASH;
    a.equity = isFinite(a.equity) ? a.equity : BASE_CASH;
    a.games = a.games || 0;
    a.wins = a.wins || 0;
    a.best = isFinite(a.best) ? a.best : 0;
    a.bestLabel = a.bestLabel || '';
    a.history = Array.isArray(a.history) ? a.history : [];
    return a;
  }
  function saveAcct(a) {
    try { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); } catch (e) {}
  }
  function paintAcct() {
    var a = loadAcct();
    var ret = (a.equity / a.start - 1) * 100;
    $('acct-equity').textContent = won(a.equity);
    $('acct-ret').textContent = pct(ret);
    $('acct-ret').className = cls(ret);
    $('acct-record').textContent = a.games ? a.games + '전 ' + a.wins + '승' : '첫 도전 전';
    $('acct-best').textContent = a.games ? pct(a.best) : '—';
    $('acct-best').className = a.games ? cls(a.best) : '';
    $('acct-best').title = a.games ? (a.bestLabel || '') : '';
  }

  /* ---------------- 화면 ---------------- */
  function screen(name) {
    ['mr-lobby', 'mr-play', 'mr-result'].forEach(function (id) {
      var n = $(id);
      if (n) n.classList.toggle('show', id === 'mr-' + name);
    });
    if (name !== 'play') stopLoop();
    window.scrollTo({ top: Math.max(0, $('mr-app').offsetTop - 70), behavior: 'smooth' });
  }

  /* ---------------- 로비 ---------------- */
  function renderLobby() {
    if (!DATA) return;
    var sess = DATA.sessions.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.market === 'KR' ? -1 : 1;
    });
    pick.session = pick.session || sess[0];
    pick.sym = null;

    var box = $('mr-sessions');
    box.innerHTML = sess.map(function (s, i) {
      var on = pick.session && pick.session.id === s.id;
      var lab = pick.blind ? '비공개 세션 ' + (i + 1) : sessionLabel(s);
      return '<button type="button" class="mr-chip' + (on ? ' on' : '') + '" data-sid="' + s.id + '">' +
        '<b>' + lab + '</b><span>' + (pick.blind ? '종목·날짜 비공개' : s.open + '–' + s.close + ' · ' + s.symbols.length + '종목') + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.mr-chip'), function (b) {
      b.addEventListener('click', function () {
        pick.session = DATA.sessions.filter(function (s) { return s.id === b.getAttribute('data-sid'); })[0];
        pick.sym = null;
        renderLobby();
      });
    });

    var syms = pick.session.symbols.slice().sort(function (a, b) {
      var ca = (a.day.close / a.day.prevClose - 1), cb = (b.day.close / b.day.prevClose - 1);
      return Math.abs(cb) - Math.abs(ca);
    });
    var g = $('mr-symbols');
    g.innerHTML = syms.map(function (s, i) {
      var chg = s.day.prevClose ? (s.day.close / s.day.prevClose - 1) * 100 : 0;
      var priceK = s.day.close * pick.session.fx;
      if (pick.blind) {
        return '<button type="button" class="mr-sym blind" data-sym="' + s.sym + '">' +
          '<span class="si">🕶</span><b>비공개 종목 ' + (i + 1) + '</b>' +
          '<span class="sp">종목·날짜는 장 마감 후 공개</span></button>';
      }
      return '<button type="button" class="mr-sym" data-sym="' + s.sym + '">' +
        '<b>' + s.name + '</b>' +
        '<span class="sk">' + (s.ex || '') + ' · ' + s.sym.replace(/\.(KS|KQ)$/, '') + '</span>' +
        '<span class="sp">' + won(priceK) + '</span>' +
        '<span class="sc ' + cls(chg) + '">' + pct(chg) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(g.querySelectorAll('.mr-sym'), function (b) {
      b.addEventListener('click', function () {
        pick.sym = pick.session.symbols.filter(function (s) { return s.sym === b.getAttribute('data-sym'); })[0];
        Array.prototype.forEach.call(g.querySelectorAll('.mr-sym'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        $('mr-start').disabled = false;
        $('mr-start').textContent = pick.blind ? '🕶 블라인드로 1,000만 원 시작' :
          '▶ ' + pick.sym.name + ' · 1,000만 원으로 시작';
      });
    });
    $('mr-start').disabled = !pick.sym;
    if (!pick.sym) $('mr-start').textContent = '종목을 고르면 시작할 수 있어요';
    $('mr-data-note').textContent = DATA.sessions.length + '개 실제 거래일 · ' +
      DATA.interval + '봉 · 갱신 ' + (DATA.generatedAt || '').replace('T', ' ').slice(0, 16);
  }

  /* ---------------- 게임 시작 ---------------- */
  function startGame(session, sym) {
    var fee = DATA.fees[session.market] || { buy: 0, sell: 0, tax: 0 };
    S = {
      session: session, sym: sym, fee: fee, fx: session.fx,
      bars: sym.bars, idx: 0, total: sym.bars.length,
      cash: BASE_CASH, shares: 0, cost: 0, realized: 0, feesPaid: 0,
      sells: 0, wins: 0, trades: [], eq: [BASE_CASH], playing: true,
      speed: 1, ended: false, frac: 0.1, startCash: BASE_CASH
    };
    $('mr-play').innerHTML = playHTML();
    bindPlay();
    screen('play');
    drawChart();
    paintHUD();
    stopLoop();
    startLoop();
  }

  function playHTML() {
    var s = S, sym = s.sym;
    return '' +
      '<div class="mr-head">' +
        '<div class="mr-headtop">' +
          '<div class="mr-id">' +
            '<div class="mr-name">' + (pick.blind ? '🕶 비공개 종목' : sym.name) + '</div>' +
            '<div class="mr-ticker">' + (pick.blind ? '장 마감 후 공개' : (sym.ex || '') + ' · ' + sym.sym.replace(/\.(KS|KQ)$/, '') + ' · ' + sessionLabel(s.session)) + '</div>' +
          '</div>' +
          '<div class="mr-time"><b id="p-clock">--:--</b><span id="p-session">' + s.session.open + '–' + s.session.close + '</span></div>' +
        '</div>' +
        '<div class="mr-price"><b id="p-price">—</b><span id="p-chg" class="mr-chg flat">—</span></div>' +
        '<div class="mr-sub" id="p-sub"></div>' +
        '<div class="mr-bars"><span id="p-bar">1 / ' + s.total + '</span><span class="mr-prog"><i id="p-prog"></i></span><span id="p-pct">0%</span></div>' +
      '</div>' +
      '<div class="mr-chartbox"><canvas id="mr-chart" aria-label="실제 5분봉 차트"></canvas></div>' +
      '<div class="mr-ctl">' +
        '<button type="button" class="mr-pause" id="p-pause">⏸ 일시정지</button>' +
        '<div class="mr-speed" id="p-speed">' +
          SPEEDS.map(function (v) { return '<button type="button" data-sp="' + v + '" class="' + (v === 1 ? 'on' : '') + '">' + v + 'x</button>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="mr-panel">' +
        '<div class="mr-cashrow"><span>주문 가능 금액</span><b id="p-cash">' + won(s.cash) + '</b></div>' +
        '<div class="mr-hold" id="p-hold"></div>' +
        '<div class="mr-frac" id="p-frac">' +
          [['10%', 0.1], ['25%', 0.25], ['50%', 0.5], ['최대', 1]].map(function (f, i) {
            return '<button type="button" data-frac="' + f[1] + '" class="' + (i === 0 ? 'on' : '') + '">' + f[0] + '</button>';
          }).join('') +
        '</div>' +
        '<div class="mr-preview" id="p-preview">—</div>' +
        '<div class="mr-actions">' +
          '<button type="button" class="mr-buy" id="btn-buy">구매하기</button>' +
          '<button type="button" class="mr-sell" id="btn-sell">판매하기</button>' +
        '</div>' +
      '</div>' +
      '';
  }

  function bindPlay() {
    $('p-pause').addEventListener('click', function () {
      if (S.ended) return;
      S.playing = !S.playing;
      this.textContent = S.playing ? '⏸ 일시정지' : '▶ 재생';
      if (S.playing) startLoop(); else stopLoop();
    });
    Array.prototype.forEach.call($('p-speed').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        S.speed = +b.getAttribute('data-sp');
        Array.prototype.forEach.call($('p-speed').querySelectorAll('button'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
    });
    Array.prototype.forEach.call($('p-frac').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        S.frac = +b.getAttribute('data-frac');
        Array.prototype.forEach.call($('p-frac').querySelectorAll('button'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        paintHUD();
      });
    });
    $('btn-buy').addEventListener('click', function () { buy(S.frac); });
    $('btn-sell').addEventListener('click', function () { sell(S.frac); });
  }

  /* ---------------- 매매 ---------------- */
  function px() { return S.bars[S.idx][4]; }
  function unitCost(p) { return p * S.fx * (1 + S.fee.buy); }
  function unitNet(p) { return p * S.fx * (1 - S.fee.sell - (S.fee.tax || 0)); }

  function buyQty(p, frac) {
    var uc = unitCost(p);
    var n = Math.floor((S.cash * (frac >= 1 ? 1 : frac)) / (uc + 1e-9));
    while (n > 0 && n * uc > S.cash + 1e-6) n -= 1;
    return Math.max(0, n);
  }
  function sellQty(frac) {
    if (!S.shares) return 0;
    var n = frac >= 1 ? S.shares : Math.floor(S.shares * frac);
    if (n <= 0) n = 1;
    return Math.min(S.shares, n);
  }

  function buy(frac) {
    if (!S || S.ended) return;
    var p = px(), uc = unitCost(p);
    var want = S.cash * (frac >= 1 ? 1 : frac);
    var n = Math.floor(want / (uc + 1e-9));
    if (frac >= 1) n = Math.floor(S.cash / (uc + 1e-9));
    if (n <= 0) { toast('1주도 살 수 없는 금액이에요'); return; }
    var gross = n * p * S.fx, fee = gross * S.fee.buy;
    if (gross + fee > S.cash + 1e-6) { n -= 1; gross = n * p * S.fx; fee = gross * S.fee.buy; }
    if (n <= 0) { toast('잔액이 부족해요'); return; }
    S.cash -= gross + fee;
    S.feesPaid += fee;
    S.cost += gross + fee;
    S.shares += n;
    S.trades.push({ i: S.idx, side: 'B', n: n, p: p, krw: gross });
    toast(n + '주 구매 · ' + won(gross + fee));
    paintHUD(); drawChart();
  }

  function sell(frac) {
    if (!S || S.ended) return;
    if (S.shares <= 0) { toast('보유한 주식이 없어요'); return; }
    var n = frac >= 1 ? S.shares : Math.floor(S.shares * frac);
    if (n <= 0) n = 1;
    if (n > S.shares) n = S.shares;
    var p = px(), gross = n * p * S.fx;
    var fee = gross * S.fee.sell, tax = gross * (S.fee.tax || 0);
    var net = gross - fee - tax;
    var avg = S.cost / S.shares;
    var pnl = net - avg * n;
    S.cash += net;
    S.feesPaid += fee + tax;
    S.realized += pnl;
    S.cost -= avg * n;
    S.shares -= n;
    if (S.shares === 0) S.cost = 0;
    S.sells += 1;
    if (pnl > 0) S.wins += 1;
    S.trades.push({ i: S.idx, side: 'S', n: n, p: p, krw: net, pnl: pnl });
    toast(n + '주 판매 · ' + won(net) + ' (' + (pnl >= 0 ? '+' : '') + won(pnl) + ')');
    paintHUD(); drawChart();
  }

  /* ---------------- 진행 ---------------- */
  function startLoop() {
    stopLoop();
    lastTs = 0; acc = 0;
    raf = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function tick(ts) {
    if (!S || S.ended) return;
    if (!S.playing) { raf = 0; return; }
    if (!lastTs) lastTs = ts;
    var dt = ts - lastTs;
    lastTs = ts;
    var interval = BASE_MS / S.speed;
    acc += dt;
    var advanced = false;
    while (acc >= interval) {
      acc -= interval;
      if (S.idx < S.total - 1) { S.idx += 1; advanced = true; }
      else { finish(); return; }
      S.eq.push(equity());
      if (S.eq.length > 4000) S.eq.shift();
    }
    if (advanced) { paintHUD(); drawChart(); }
    raf = requestAnimationFrame(tick);
  }
  function equity() { return S.cash + S.shares * px() * S.fx; }

  function paintHUD() {
    if (!S) return;
    var s = S, bar = s.bars[s.idx], p = bar[4], prev = s.sym.day.prevClose;
    var pKr = p * s.fx;
    $('p-price').textContent = won(pKr);
    var chgPct = prev ? (p / prev - 1) * 100 : 0;
    var chgKrw = prev ? pKr - prev * s.fx : 0;
    var ce = $('p-chg');
    ce.className = 'mr-chg ' + cls(chgPct);
    ce.textContent = (chgKrw >= 0 ? '▲ ' : '▼ ') + won(Math.abs(chgKrw)) + '  ' + pct(chgPct) + (prev ? ' (전일대비)' : '');
    $('p-sub').innerHTML = s.session.currency === 'USD'
      ? usd(p) + ' × 환율 ' + comma(s.fx) + '원'
      : (s.sym.ex || '') + ' 정규장 · 원화';
    $('p-clock').textContent = hhmm(bar[0], s.session.tzOffset);
    $('p-bar').textContent = (s.idx + 1) + ' / ' + s.total + '봉';
    var prog = (s.idx + 1) / s.total * 100;
    $('p-prog').style.width = prog.toFixed(1) + '%';
    $('p-pct').textContent = Math.round(prog) + '%';

    $('p-cash').textContent = won(s.cash);
    var val = s.shares * pKr;
    var invested = s.cost;
    var unreal = val - invested;
    var hpr = invested > 0 ? (unreal / invested) * 100 : 0;
    $('p-hold').innerHTML =
      row('보유 수량', s.shares ? comma(s.shares) + '주' : '0주') +
      row('평균 단가', s.shares ? won(invested / s.shares) : '—') +
      row('평가 금액', won(val)) +
      row('평가 손익', s.shares ? (unreal >= 0 ? '+' : '') + won(unreal) + ' (' + pct(hpr) + ')' : '—', s.shares ? cls(unreal) : '') +
      row('실현 손익', (s.realized >= 0 ? '+' : '') + won(s.realized), cls(s.realized)) +
      row('총 자산', won(equity()), 'strong');

    var bq = buyQty(p, s.frac), sq = sellQty(s.frac);
    $('p-preview').innerHTML = '구매 <b>' + comma(bq) + '주</b> ' + won(bq * unitCost(p)) +
      ' · 판매 <b>' + comma(sq) + '주</b> ' + won(sq * unitNet(p));
  }
  function row(a, b, c) {
    return '<div class="mr-irow"><span>' + a + '</span><b class="' + (c || '') + '">' + b + '</b></div>';
  }

  /* ---------------- 차트 ---------------- */
  function drawChart() {
    var cv = $('mr-chart');
    if (!cv || !S) return;
    var dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth || 640, H = cv.clientHeight || 320;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px -apple-system,"Pretendard","Noto Sans KR",sans-serif';
    ctx.textBaseline = 'middle';

    var bars = S.bars, n = bars.length, last = S.idx;
    var padT = 12, padB = 20;
    var narrow = W < 480;
    var padR = narrow ? 46 : 76;
    var volH = Math.max(34, H * 0.16), gap = 12;
    var priceH = H - padT - padB - volH - gap;
    var padL = 2;
    var iw = W - padL - padR;
    var slot = iw / n;

    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i <= last; i++) {
      if (bars[i][3] < lo) lo = bars[i][3];
      if (bars[i][2] > hi) hi = bars[i][2];
    }
    var prev = S.sym.day.prevClose;
    if (prev) { lo = Math.min(lo, prev); hi = Math.max(hi, prev); }
    if (S.shares > 0) { var ap = (S.cost / S.shares) / S.fx; lo = Math.min(lo, ap); hi = Math.max(hi, ap); }
    var pad = (hi - lo) * 0.12 || hi * 0.01 || 1;
    lo -= pad; hi += pad;
    var y = function (v) { return padT + priceH - (v - lo) / (hi - lo) * priceH; };
    var xAt = function (i) { return padL + slot * (i + 0.5); };

    var UP = css('--g-up'), DN = css('--g-dn'), LINE = css('--g-line'), MUT = css('--g-mut'), TXT = css('--g-text');

    // 그리드
    ctx.strokeStyle = LINE; ctx.lineWidth = 1;
    ctx.fillStyle = MUT; ctx.textAlign = 'left';
    for (var k = 0; k <= 4; k++) {
      var v = lo + (hi - lo) * k / 4;
      var yy = Math.round(y(v)) + 0.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + iw, yy); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(axisFmt(v * S.fx, narrow), padL + iw + 6, y(v));
    }

    // 전일 종가 점선
    if (prev) {
      ctx.save();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = MUT; ctx.globalAlpha = 0.75;
      ctx.beginPath(); ctx.moveTo(padL, y(prev)); ctx.lineTo(padL + iw, y(prev)); ctx.stroke();
      ctx.restore();
    }

    // 봉 또는 라인
    var candle = slot >= 4.2;
    if (candle) {
      var bw = Math.max(1.5, slot * 0.66);
      for (var i2 = 0; i2 <= last; i2++) {
        var b = bars[i2], up = b[4] >= b[1];
        ctx.strokeStyle = up ? UP : DN; ctx.fillStyle = up ? UP : DN;
        var cx = xAt(i2);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(cx) + 0.5, y(b[2])); ctx.lineTo(Math.round(cx) + 0.5, y(b[3])); ctx.stroke();
        var yo = y(b[1]), yc = y(b[4]);
        var top = Math.min(yo, yc), hgt = Math.max(1.2, Math.abs(yc - yo));
        ctx.fillRect(cx - bw / 2, top, bw, hgt);
      }
    } else {
      // 좁은 화면: 종가 라인 + 그라데이션
      var grad = ctx.createLinearGradient(0, padT, 0, padT + priceH);
      var lastClose = bars[last][4], firstClose = bars[0][1];
      var col = lastClose >= firstClose ? UP : DN;
      grad.addColorStop(0, hexA(col, 0.28));
      grad.addColorStop(1, hexA(col, 0.02));
      ctx.beginPath();
      ctx.moveTo(xAt(0), y(bars[0][4]));
      for (var i3 = 1; i3 <= last; i3++) ctx.lineTo(xAt(i3), y(bars[i3][4]));
      ctx.lineTo(xAt(last), y(lo)); ctx.lineTo(xAt(0), y(lo)); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(xAt(0), y(bars[0][4]));
      for (var i4 = 1; i4 <= last; i4++) ctx.lineTo(xAt(i4), y(bars[i4][4]));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    }

    // 5봉 이동평균
    ctx.beginPath();
    var started = false;
    for (var i5 = 0; i5 <= last; i5++) {
      if (i5 < 4) continue;
      var sum = 0;
      for (var j = i5 - 4; j <= i5; j++) sum += bars[j][4];
      var v5 = sum / 5;
      if (!started) { ctx.moveTo(xAt(i5), y(v5)); started = true; } else ctx.lineTo(xAt(i5), y(v5));
    }
    if (started) { ctx.strokeStyle = '#C9A227'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1; }

    // 평단가
    if (S.shares > 0) {
      var avgK = (S.cost / S.shares) / S.fx;
      ctx.save();
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#FFB020'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, y(avgK)); ctx.lineTo(padL + iw, y(avgK)); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#FFB020'; ctx.textAlign = 'right';
      ctx.fillText('평단', padL + iw - 4, y(avgK) - 8);
    }

    // 현재가 라벨
    var pNow = bars[last][4];
    var lab = won(pNow * S.fx).replace('원', '');
    var lw = ctx.measureText(lab).width + 12;
    var ly = Math.min(padT + priceH - 9, Math.max(padT + 9, y(pNow)));
    ctx.fillStyle = pNow >= (prev || pNow) ? UP : DN;
    ctx.fillRect(padL + iw + 2, ly - 9, lw, 18);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    ctx.fillText(lab, padL + iw + 8, ly);

    // 거래량
    var vmax = 0;
    for (var i6 = 0; i6 <= last; i6++) vmax = Math.max(vmax, bars[i6][5]);
    var vy0 = padT + priceH + gap;
    for (var i7 = 0; i7 <= last; i7++) {
      var vb = bars[i7], vh = vmax ? (vb[5] / vmax) * volH : 0;
      ctx.fillStyle = hexA(vb[4] >= vb[1] ? UP : DN, 0.55);
      var vx = xAt(i7);
      var wv = candle ? Math.max(1.2, slot * 0.62) : Math.max(1, slot * 0.9);
      ctx.fillRect(vx - wv / 2, vy0 + volH - vh, wv, vh);
    }
    ctx.fillStyle = MUT; ctx.textAlign = 'left';
    ctx.fillText('거래량 ' + volTxt(bars[last][5]), padL + 2, vy0 - 6);

    // 매매 표시
    S.trades.forEach(function (t) {
      if (t.i > last) return;
      var tx = xAt(t.i);
      var ty = t.side === 'B' ? y(bars[t.i][3]) + 9 : y(bars[t.i][2]) - 9;
      ctx.fillStyle = t.side === 'B' ? UP : DN;
      ctx.beginPath();
      if (t.side === 'B') {
        ctx.moveTo(tx, ty - 6); ctx.lineTo(tx - 4.5, ty + 2); ctx.lineTo(tx + 4.5, ty + 2);
      } else {
        ctx.moveTo(tx, ty + 6); ctx.lineTo(tx - 4.5, ty - 2); ctx.lineTo(tx + 4.5, ty - 2);
      }
      ctx.closePath(); ctx.fill();
    });

    // 시간축
    ctx.fillStyle = MUT; ctx.textAlign = 'center';
    var step = Math.max(1, Math.ceil(n / 5));
    for (var i8 = 0; i8 <= last; i8 += step) {
      ctx.fillText(hhmm(bars[i8][0], S.session.tzOffset), xAt(i8), H - 8);
    }
    ctx.textAlign = 'right';
    ctx.fillText(hhmm(bars[last][0], S.session.tzOffset), padL + iw, H - 8);
  }
  function axisFmt(v, narrow) {
    if (narrow) {
      if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + '억';
      if (Math.abs(v) >= 1e4) return Math.round(v / 1e4) + '만';
      return comma(v);
    }
    return comma(v);
  }
  function hexA(hex, a) {
    if (!hex || hex.charAt(0) !== '#') return hex;
    var h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ---------------- 종료·결과 ---------------- */
  function bench() {
    var s = S, open = s.sym.day.open, close = s.sym.day.close;
    var uc = open * s.fx * (1 + s.fee.buy);
    var n = Math.max(0, Math.floor(s.startCash / (uc + 1e-9)));
    var spent = n * uc;
    var left = s.startCash - spent;
    var net = n * close * s.fx * (1 - s.fee.sell - (s.fee.tax || 0));
    var profit = net + left - s.startCash;
    var fees = spent - n * open * s.fx + (n * close * s.fx - net);
    return { n: n, value: net + left, profit: profit, ret: profit / s.startCash * 100, fees: fees };
  }

  function mdd(series) {
    var peak = 0, worst = 0;
    series.forEach(function (v) {
      if (v > peak) peak = v;
      if (peak > 0) { var d = (v / peak - 1) * 100; if (d < worst) worst = d; }
    });
    return worst;
  }

  function grade(ret, excess) {
    if (ret <= -15) return { g: 'F', t: '퇴출 위기 — 오늘은 시장이 이겼어요' };
    if (excess >= 8 && ret > 0) return { g: 'S', t: '존버를 압도했어요. 이게 실력입니다' };
    if (excess >= 3) return { g: 'A', t: '존버보다 잘했어요. 판단이 좋았습니다' };
    if (excess >= -3) return { g: 'B', t: '존버와 비슷하게 갔어요. 나쁘지 않습니다' };
    if (excess >= -8) return { g: 'C', t: '존버보다 조금 못했어요' };
    if (excess >= -15) return { g: 'D', t: '존버보다 꽤 못했어요. 매매 타이밍을 돌아봐요' };
    return { g: 'F', t: '존버보다 크게 못했어요. 오늘은 손절이 늦었습니다' };
  }

  function finish() {
    S.ended = true;
    S.playing = false;
    stopLoop();
    S.eq.push(equity());
    var finalEq = equity();
    var myRet = (finalEq / S.startCash - 1) * 100;
    var bh = bench();
    var g = grade(myRet, myRet - bh.ret);
    var winRate = S.sells ? (S.wins / S.sells * 100) : null;
    var dd = mdd(S.eq.length ? S.eq : [S.startCash]);

    var acct = loadAcct();
    acct.equity = acct.equity * (1 + myRet / 100);
    acct.games += 1;
    if (myRet > 0) acct.wins += 1;
    if (myRet > acct.best || acct.games === 1) { acct.best = myRet; acct.bestLabel = shortDate(S.session.date) + ' ' + S.sym.name + ' ' + pct(myRet); }
    acct.history.unshift({ d: S.session.date, s: S.sym.name, m: S.session.market, r: Math.round(myRet * 100) / 100, g: g.g, blind: pick.blind });
    acct.history = acct.history.slice(0, 12);
    saveAcct(acct);

    var bhCurve = [], bs = S.bars;
    var bshares = bh.n, bopen = S.sym.day.open;
    var bleft = S.startCash - bshares * bopen * S.fx * (1 + S.fee.buy);
    for (var i = 0; i < bs.length; i++) bhCurve.push(bleft + bshares * bs[i][4] * S.fx);

    $('mr-result').innerHTML =
      '<div class="mr-rescard">' +
        '<div class="mr-restop"><span class="mr-grade g-' + g.g + '">' + g.g + '</span>' +
          '<div><div class="mr-restitle">' + g.t + '</div>' +
          '<div class="mr-ressym">' + (pick.blind ? '🕶 공개 · ' : '') + S.sym.name + ' · ' + sessionLabel(S.session) + ' 마감</div></div>' +
        '</div>' +
        '<div class="mr-bigret ' + cls(myRet) + '">' + pct(myRet) + '<span>수익률</span></div>' +
        '<div class="mr-vs">존버(시초가 매수→종가 매도) ' + pct(bh.ret) + ' · <b class="' + cls(myRet - bh.ret) + '">' + (myRet - bh.ret >= 0 ? '+' : '') + (myRet - bh.ret).toFixed(2) + '%p</b></div>' +
        '<div class="mr-chartbox small"><canvas id="mr-rchart" aria-label="내 자산 곡선과 존버 곡선"></canvas></div>' +
        '<div class="mr-legend"><span><i style="background:var(--g-up)"></i>내 자산</span><span><i style="background:var(--g-mut)"></i>존버</span></div>' +
        '<div class="mr-grid2">' +
          stat('최종 자산', won(finalEq)) +
          stat('존버 최종', won(bh.value)) +
          stat('승률', winRate == null ? '—' : winRate.toFixed(0) + '% (' + S.wins + '/' + S.sells + ')') +
          stat('최대 낙폭', pct(dd)) +
          stat('매매', (S.trades.filter(function (t) { return t.side === 'B'; }).length) + '매수 · ' + S.sells + '매도') +
          stat('수수료·세금', won(S.feesPaid)) +
        '</div>' +
        '<div class="mr-acctline">내 계좌 <b>' + won(acct.equity) + '</b> · ' + acct.games + '전 ' + acct.wins + '승 · 최고 ' + pct(acct.best) + '</div>' +
        '<div class="mr-actions3">' +
          '<button type="button" class="mr-ghost" id="r-again">같은 종목 다시</button>' +
          '<button type="button" class="mr-ghost" id="r-other">다른 종목</button>' +
          '<button type="button" class="mr-primary" id="r-next">다음 장 도전</button>' +
        '</div>' +
      '</div>';
    screen('result');
    drawResultChart(bhCurve);
    $('r-again').addEventListener('click', function () { startGame(S.session, S.sym); });
    $('r-other').addEventListener('click', function () { paintAcct(); renderLobby(); screen('lobby'); });
    $('r-next').addEventListener('click', function () {
      var list = DATA.sessions.filter(function (s) { return s.market === S.session.market; })
        .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var i = list.findIndex(function (s) { return s.id === S.session.id; });
      var next = list[i + 1] || list[0];
      pick.session = next;
      var s2 = next.symbols[Math.floor(Math.random() * next.symbols.length)];
      startGame(next, s2);
    });
    paintAcct();
    window.scrollTo({ top: Math.max(0, $('mr-app').offsetTop - 70), behavior: 'smooth' });
  }

  function stat(k, v) { return '<div class="mr-stat"><span>' + k + '</span><b>' + v + '</b></div>'; }

  function drawResultChart(bhCurve) {
    var cv = $('mr-rchart');
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth || 600, H = cv.clientHeight || 180;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var mine = S.eq.slice();
    if (mine.length < 2) mine.push(mine[0] || S.startCash);
    var n = mine.length;
    var lo = Math.min.apply(null, mine.concat(bhCurve)), hi = Math.max.apply(null, mine.concat(bhCurve));
    var pad = (hi - lo) * 0.1 || 1;
    lo -= pad; hi += pad;
    var pT = 10, pB = 16, pR = 56, pL = 2;
    var iw = W - pL - pR, ih = H - pT - pB;
    var y = function (v) { return pT + ih - (v - lo) / (hi - lo) * ih; };
    var x = function (i) { return pL + iw * (i / (n - 1)); };
    ctx.strokeStyle = css('--g-line'); ctx.fillStyle = css('--g-mut');
    ctx.font = '10px -apple-system,"Pretendard",sans-serif'; ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    [0, 0.5, 1].forEach(function (f) {
      var v = lo + (hi - lo) * f;
      ctx.globalAlpha = .5;
      ctx.beginPath(); ctx.moveTo(pL, y(v)); ctx.lineTo(pL + iw, y(v)); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(comma(v), pL + iw + 5, y(v));
    });
    ctx.strokeStyle = css('--g-mut'); ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (var i = 0; i < n; i++) { var v2 = bhCurve[Math.min(i, bhCurve.length - 1)]; if (i === 0) ctx.moveTo(x(i), y(v2)); else ctx.lineTo(x(i), y(v2)); }
    ctx.stroke(); ctx.setLineDash([]);
    var col = mine[n - 1] >= mine[0] ? css('--g-up') : css('--g-dn');
    var g2 = ctx.createLinearGradient(0, pT, 0, pT + ih);
    g2.addColorStop(0, hexA(col, .3)); g2.addColorStop(1, hexA(col, .02));
    ctx.beginPath(); ctx.moveTo(x(0), y(mine[0]));
    for (var j = 1; j < n; j++) ctx.lineTo(x(j), y(mine[j]));
    ctx.lineTo(x(n - 1), pT + ih); ctx.lineTo(x(0), pT + ih); ctx.closePath();
    ctx.fillStyle = g2; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x(0), y(mine[0]));
    for (var k = 1; k < n; k++) ctx.lineTo(x(k), y(mine[k]));
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = css('--g-mut'); ctx.textAlign = 'left';
    ctx.fillText(hhmm(S.bars[0][0], S.session.tzOffset), pL + 2, H - 6);
    ctx.textAlign = 'right';
    ctx.fillText(hhmm(S.bars[S.bars.length - 1][0], S.session.tzOffset), pL + iw, H - 6);
  }

  /* ---------------- 초기화 ---------------- */
  function boot() {
    K.theme(function () { if (S && !S.ended) drawChart(); });
    paintAcct();
    $('mr-blind').addEventListener('click', function () {
      pick.blind = !pick.blind;
      this.classList.toggle('on', pick.blind);
      this.setAttribute('aria-pressed', pick.blind ? 'true' : 'false');
      $('mr-blind-txt').textContent = pick.blind ? '블라인드 모드 켜짐 — 종목·날짜를 가립니다' : '블라인드 모드 — 종목·날짜를 가리고 거래';
      pick.sym = null;
      renderLobby();
    });
    $('mr-start').addEventListener('click', function () { if (pick.sym) startGame(pick.session, pick.sym); });
    $('mr-reset').addEventListener('click', function () {
      if (!window.confirm('내 계좌 기록(누적 자산·전적)을 초기화할까요?')) return;
      try { localStorage.removeItem(ACCT_KEY); } catch (e) {}
      paintAcct(); toast('계좌를 1,000만 원으로 초기화했어요');
    });
    var v = new Date();
    var stamp = v.getUTCFullYear() + ('0' + (v.getUTCMonth() + 1)).slice(-2) + ('0' + v.getUTCDate()).slice(-2) + ('0' + v.getUTCHours()).slice(-2);
    fetch('data/market-replay.json?v=' + stamp, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        DATA = d;
        if (!DATA.sessions || !DATA.sessions.length) throw new Error('no sessions');
        $('mr-loading').style.display = 'none';
        $('mr-lobby').classList.add('show');
        renderLobby();
      })
      .catch(function (e) {
        $('mr-loading').innerHTML = '<b>시세 데이터를 불러오지 못했어요.</b><span>잠시 뒤 새로고침해 주세요. (' + e.message + ')</span>';
      });
    K.eachResize(function () { if (S && !S.ended) drawChart(); });
  }

  function showFatal(msg) {
    var l = $('mr-loading');
    if (!l) return;
    l.style.display = '';
    l.innerHTML = '';
    var b = document.createElement('b');
    b.textContent = '게임을 불러오지 못했어요';
    var sp = document.createElement('span');
    sp.textContent = String(msg || '') + ' — 새로고침하면 다시 시도합니다.';
    var d = document.createElement('div');
    d.appendChild(b); d.appendChild(sp);
    l.appendChild(d);
  }
  window.addEventListener('error', function (e) { showFatal(e.message); });
  window.addEventListener('unhandledrejection', function (e) {
    showFatal((e.reason && e.reason.message) || e.reason);
  });

  function safeBoot() {
    try { boot(); } catch (e) { showFatal(e && e.message); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeBoot);
  else safeBoot();
})();

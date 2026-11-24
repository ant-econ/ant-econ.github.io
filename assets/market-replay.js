/* 개미일지 — 국장·미장 통합 실전 트레이딩 게임
   · 한국시간(KST) 단일 타임라인 하나에서 국내 78 + 미국 68 = 146종목을 동시에 보유·매매
   · 5분봉은 확장장(프리마켓·애프터마켓)까지 실제 수신한 봉만 사용 (가짜·랜덤 없음)
   · 봉이 있는 동안만 그 종목을 매매할 수 있고, 장이 아닐 때는 직전 종가 + '거래시간 외'
   · 1x = 현실 1:1 (5분봉 1개 = 300초), 최대 20배속 · 구간 이동
   · 계좌(cash + holdings)는 localStorage에 영구 저장 → 보유 주식은 팔기 전까지 다음 날도 이월
   데이터: data/market-replay.json (Yahoo Finance 실제 시세) */
(function () {
  'use strict';
  var K = window.KIT;
  var $ = function (id) { return document.getElementById(id); };

  var DATA = null;
  var U = null;                                  // 통합 장 (KST 단일 타임라인)
  var S = null;                                  // 진행 중 게임 상태
  var pick = { sym: null, q: '', grp: 'ALL', startAt: null };
  var raf = 0, lastReal = 0, toastTimer = 0;
  var SPEEDS = [1, 2, 5, 10, 20];
  var BAR_SEC = 300;
  var KST = 540;                                 // 표시 시간대(분) — 데이터의 kstOffset

  var TABS = [
    { id: 'ALL', label: '전체' },
    { id: 'MKT:KR', label: '🇰🇷 국장' },
    { id: 'MKT:US', label: '🇺🇸 미장' },
    { id: 'KOSPI', label: '코스피' },
    { id: 'KOSDAQ', label: '코스닥' },
    { id: 'NASDAQ', label: '나스닥' },
    { id: 'NYSE', label: '뉴욕' },
    { id: 'SP500', label: 'S&P500' },
    { id: 'DJIA', label: '다우존스' },
    { id: 'ETF', label: 'ETF' }
  ];

  var ICON_COLORS = ['#3182F6', '#F04452', '#00B37E', '#FFB020', '#7A5AF8', '#F76E4D',
    '#0FB5BA', '#E84E8A', '#5A6CF3', '#2AC1BC', '#D97706', '#8B95A1'];

  /* ---------------- 숫자·문자 ---------------- */
  function comma(n) {
    if (!isFinite(n)) n = 0;
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function won(n) { return comma(n) + '원'; }
  function usd(n) {
    if (!isFinite(n)) n = 0;
    var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-$' : '$') + s;
  }
  function pct(n, d) {
    if (!isFinite(n)) n = 0;
    return (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toFixed(d == null ? 2 : d) + '%';
  }
  function cls(n) { return n > 0.0000001 ? 'up' : n < -0.0000001 ? 'dn' : 'flat'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shortSym(sym) { return String(sym == null ? '' : sym).replace(/\.(KS|KQ)$/, ''); }

  /* ---------------- KST 시각 ---------------- */
  function kst(epoch) { return new Date((epoch + KST * 60) * 1000); }
  function hmText(epoch) {
    var d = kst(epoch);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
  function clockText(epoch) {
    var d = kst(epoch);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  }
  function dayText(epoch) {
    var d = kst(epoch);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + '일월화수목금토'.charAt(d.getUTCDay()) + ')';
  }
  function shortDate(dateStr) {
    var p = String(dateStr || '').split('-');
    return (+p[1] || 0) + '/' + (+p[2] || 0);
  }
  function weekday(dateStr) {
    var p = String(dateStr || '').split('-');
    var d = new Date(Date.UTC(+p[0] || 1970, (+p[1] || 1) - 1, +p[2] || 1));
    return '일월화수목금토'.charAt(d.getUTCDay());
  }
  function marketName(m) { return m === 'KR' ? '한국장' : '미국장'; }
  function marketFlag(m) { return m === 'KR' ? '🇰🇷' : '🇺🇸'; }

  function css(name) { return K.cssVar(name) || '#888'; }
  function toast(msg) {
    var t = $('mr-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); t.textContent = ''; }, 2200);
  }
  function hashStr(s) {
    var str = String(s == null ? '' : s);
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  /** 종목 아이콘 — 원형 배지 + 우하단 국기 */
  function iconHTML(sym, market, id) {
    var key = id || (sym && sym.sym) || '';
    var name = String((sym && sym.name) || '');
    var ini = market === 'KR' ? name.replace(/\s/g, '').slice(0, 1) || '•' : shortSym(key).slice(0, 2);
    var c = ICON_COLORS[hashStr(key) % ICON_COLORS.length];
    return '<span class="mr-ic" style="background:' + c + '" aria-hidden="true"><i>' + esc(ini) + '</i>' +
      '<em>' + marketFlag(market) + '</em></span>';
  }

  /* ---------------- 결과 공유(클립보드) ---------------- */
  function legacyCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      if (ta.setSelectionRange) ta.setSelectionRange(0, txt.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(function () { return true; }, function () { return legacyCopy(txt); });
    }
    return new Promise(function (res) { res(legacyCopy(txt)); });
  }
  function wireShare(btn, txt) {
    var timer = 0, label = btn.textContent;
    btn.addEventListener('click', function () {
      copyText(txt).then(function (ok) {
        if (!ok) {
          btn.textContent = '복사가 안 됐어요';
          window.prompt('아래 문구를 복사해 붙여넣어 주세요', txt);
        } else {
          btn.classList.add('ok');
          btn.textContent = '✓ 복사 완료!';
          toast('결과를 복사했어요 · 원하는 곳에 붙여넣기 하세요');
        }
        clearTimeout(timer);
        timer = setTimeout(function () { btn.classList.remove('ok'); btn.textContent = label; }, 2000);
      });
    });
  }

  /* ---------------- 계좌(localStorage) ----------------
     cash(현금) + holdings(종목별 보유)를 영구 저장한다.
     보유 주식은 '판매하기'를 누르기 전까지 다음 날 장에도 그대로 남는다. */
  var ACCT_KEY = 'ant-market-replay-v1';
  function baseCash() { return (DATA && DATA.startCash) || 10000000; }

  function loadAcct() {
    var a = null;
    try { a = JSON.parse(localStorage.getItem(ACCT_KEY) || 'null'); } catch (e) { a = null; }
    if (!a || typeof a !== 'object') a = {};
    if (!a.holdings || typeof a.holdings !== 'object') a.holdings = {};
    if (!isFinite(a.cash)) a.cash = isFinite(a.eq) ? a.eq : (isFinite(a.equity) ? a.equity : baseCash());
    a.cash = Math.max(0, Math.round(a.cash));
    a.games = a.games || 0;
    a.wins = a.wins || 0;
    a.best = isFinite(a.best) ? a.best : 0;
    a.bestLabel = a.bestLabel || '';
    a.busts = a.busts || 0;
    a.history = Array.isArray(a.history) ? a.history : [];
    for (var id in a.holdings) {
      var h = a.holdings[id];
      if (!h || !isFinite(h.qty) || Math.round(h.qty) <= 0) { delete a.holdings[id]; continue; }
      h.qty = Math.round(h.qty);
      h.paid = isFinite(h.paid) ? h.paid : 0;
      h.avgOrig = isFinite(h.avgOrig) ? h.avgOrig : 0;
      h.market = h.market === 'US' ? 'US' : 'KR';
      h.name = h.name || id;
      h.ex = h.ex || (h.market === 'KR' ? '한국' : '미국');
      if (!isFinite(h.lastPx)) h.lastPx = null;
      if (!isFinite(h.lastFx)) h.lastFx = null;
      h.lastDate = typeof h.lastDate === 'string' ? h.lastDate : '';
    }
    delete a.eq;
    delete a.equity;
    return a;
  }
  function saveAcct(a) {
    a.cash = Math.max(0, Math.round(a.cash));
    try { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); } catch (e) {}
  }

  /* ---------------- 통합 장 만들기 ----------------
     시장별 '가장 최근에 마감한 거래일'을 그대로 가져와
     절대 시각(에폭) 기준으로 한 줄에 늘어놓는다. 두 시장의 시계를 따로 두지 않는다. */
  function feeOf(market) { return (DATA && DATA.fees && DATA.fees[market]) || { buy: 0, sell: 0, tax: 0 }; }

  function latestSession(market) {
    var best = null;
    if (!DATA) return null;
    DATA.sessions.forEach(function (s) {
      if (s.market !== market) return;
      if (!best || s.date > best.date) best = s;
    });
    return best;
  }

  /** 예전 형식 JSON도 받아들이도록(구간 정보가 없으면 실제 봉으로 계산) 세션 값을 채운다 */
  function normPart(ss) {
    if (!isFinite(ss.extStart)) {
      ss.extStart = Infinity;
      ss.symbols.forEach(function (x) { if (x.bars[0][0] < ss.extStart) ss.extStart = x.bars[0][0]; });
    }
    if (!isFinite(ss.extEnd)) {
      ss.extEnd = -Infinity;
      ss.symbols.forEach(function (x) {
        var e = x.bars[x.bars.length - 1][0] + BAR_SEC;
        if (e > ss.extEnd) ss.extEnd = e;
      });
    }
    if (!isFinite(ss.regStart)) ss.regStart = ss.extStart;
    if (!isFinite(ss.regEnd)) ss.regEnd = ss.extEnd;
    return ss;
  }

  function buildUnified() {
    var parts = [];
    ['KR', 'US'].forEach(function (m) {
      var s = latestSession(m);
      if (s && s.symbols && s.symbols.length) parts.push(s);
    });
    if (!parts.length) return null;
    parts.forEach(normPart);
    parts.sort(function (a, b) { return a.extStart - b.extStart; });

    var start = Infinity, end = -Infinity, syms = [], bySym = {};
    parts.forEach(function (ss) {
      ss.fee = feeOf(ss.market);
      ss.symbols.forEach(function (x) {
        var e = {
          sym: x.sym, name: x.name, ex: x.ex, tags: x.tags || [], market: ss.market,
          bars: x.bars, day: x.day,
          reg: x.reg || [x.bars[0][0], x.bars[x.bars.length - 1][0] + BAR_SEC],
          fx: ss.fx, fee: ss.fee, cur: ss.currency, sess: ss
        };
        e.win = { start: e.bars[0][0], end: e.bars[e.bars.length - 1][0] + BAR_SEC };
        if (e.win.start < start) start = e.win.start;
        if (e.win.end > end) end = e.win.end;
        syms.push(e);
        bySym[e.sym] = e;
      });
    });

    syms.sort(function (a, b) {
      if (a.market !== b.market) return a.market === 'KR' ? -1 : 1;
      return a.name.localeCompare(b.name, 'ko');
    });

    return {
      parts: parts,
      symbols: syms,
      bySym: bySym,
      span: { start: start, end: end, dur: Math.max(BAR_SEC, end - start) },
      rangeText: dayText(start) + ' ' + hmText(start) + ' → ' + dayText(end) + ' ' + hmText(end)
    };
  }

  /* ---------------- 봉 시각·가격·거래 가능 여부 ---------------- */
  /** now보다 먼저 '완료'된 마지막 봉의 인덱스 (없으면 -1) */
  function lastClosedIdx(e, now) {
    var bars = e.bars, lo = 0, hi = bars.length - 1, ans = -1;
    while (lo <= hi) {
      var m = (lo + hi) >> 1;
      if (bars[m][0] + BAR_SEC <= now) { ans = m; lo = m + 1; } else hi = m - 1;
    }
    return ans;
  }
  /** 현재가 — 완료된 봉이 없으면 진행 중인 첫 봉의 시가, 장 밖이면 그 종목의 직전 종가 */
  function priceOf(e, now) {
    var i = lastClosedIdx(e, now);
    if (i >= 0) return e.bars[i][4];
    if (isLive(e, now)) return e.bars[0][1];      // 첫 봉이 진행 중 → 그 봉의 시가(그 시각의 실제 가격)
    if (isFinite(e.day && e.day.prevClose)) return e.day.prevClose;
    return e.bars[0][1];
  }
  function isLive(e, now) { return now >= e.win.start && now < e.win.end; }
  function priceInfo(e, now) {
    var p = priceOf(e, now);
    var prev = (e.day && isFinite(e.day.prevClose)) ? e.day.prevClose : null;
    return { px: p, fx: e.fx, live: isLive(e, now), prevClose: prev, chg: prev ? (p / prev - 1) * 100 : 0 };
  }
  /** 종목의 현재 평가 기준 (보유 종목 평가·포트폴리오 공용) */
  function markFor(id, h) {
    var e = U && U.bySym[id];
    if (e) {
      var pi = priceInfo(e, nowEpoch());
      return { px: pi.px, fx: e.fx, live: pi.live, prevClose: pi.prevClose };
    }
    if (h && isFinite(h.lastPx)) {
      return { px: h.lastPx, fx: isFinite(h.lastFx) ? h.lastFx : 1, live: false, prevClose: null };
    }
    return { px: (h && h.avgOrig) || 0, fx: 1, live: false, prevClose: null };
  }
  /** 게임 중이면 재생 시계, 아니면 통합 장의 마지막 봉(종가) 기준 */
  function nowEpoch() {
    if (S) return S.span.start + S.elapsed;
    return U ? U.span.end : 0;
  }

  function acctEquity(a) {
    var eq = a.cash;
    for (var id in a.holdings) {
      var h = a.holdings[id], m = markFor(id, h);
      eq += h.qty * m.px * m.fx;
    }
    return eq;
  }
  function holdCount(a) {
    var n = 0;
    for (var id in a.holdings) if (a.holdings[id].qty > 0) n++;
    return n;
  }
  function paintAcct() {
    var a = loadAcct();
    var eq = acctEquity(a);
    var ret = (eq / baseCash() - 1) * 100;
    var e1 = $('acct-equity');
    if (!e1) return;
    e1.textContent = won(eq);
    var r1 = $('acct-ret');
    r1.textContent = pct(ret);
    r1.className = cls(ret);
    r1.title = '첫 시드 1,000만 원 대비';
    $('acct-record').textContent = a.games ? a.games + '전 ' + a.wins + '승' : '첫 도전 전';
    $('acct-best').textContent = a.games ? pct(a.best) : '—';
    $('acct-best').className = a.games ? cls(a.best) : '';
    $('acct-best').title = a.games ? (a.bestLabel || '') : '';
    var hc = holdCount(a);
    var note = $('acct-holds');
    if (note) {
      note.textContent = hc ? '보유 ' + hc + '종목 · 평가 ' + won(eq - a.cash) + ' · 현금 ' + won(a.cash)
        : '현금 ' + won(a.cash);
    }
  }

  /* ---------------- 시작 지점 ---------------- */
  function autoOffset() {
    if (!U) return 0;
    var now = Math.floor(Date.now() / 1000);
    if (now > U.span.start && now < U.span.end - 120) return now - U.span.start;
    return 0;
  }
  function startOptions() {
    var out = [{ off: 0, label: '처음부터', sub: hmText(U.span.start) }];
    U.parts.forEach(function (ss) {
      if (ss.extStart < ss.regStart - 60) {
        out.push({ off: ss.extStart - U.span.start, label: marketFlag(ss.market) + ' 프리', sub: hmText(ss.extStart) });
      }
      out.push({ off: ss.regStart - U.span.start, label: marketFlag(ss.market) + ' 정규장', sub: hmText(ss.regStart) });
    });
    var ao = autoOffset();
    if (ao > 300) out.push({ off: ao, label: '지금', sub: hmText(U.span.start + ao) });
    out.sort(function (a, b) { return a.off - b.off; });
    var seen = {}, uniq = [];
    out.forEach(function (o) { if (!seen[o.off]) { seen[o.off] = 1; uniq.push(o); } });
    return uniq;
  }
  function currentOffset() {
    if (pick.startAt != null) return pick.startAt;
    var ao = autoOffset();
    return ao > 300 ? ao : 0;
  }
  /** 지금(KST) 두 시장이 각각 어느 단계인지 */
  function phaseOf(ss, now) {
    if (now >= ss.regStart && now < ss.regEnd) return { k: 'reg', t: '정규장' };
    if (now >= ss.extStart && now < ss.regStart) return { k: 'pre', t: ss.market === 'US' ? '프리마켓' : '장전' };
    if (now >= ss.regEnd && now < ss.extEnd) return { k: 'post', t: '애프터마켓' };
    return { k: 'off', t: '휴장' };
  }
  /** 그 종목을 지금 매매할 수 있는가 + 안 되는 이유 */
  function tradeState(e, now) {
    if (isLive(e, now)) return { ok: true, txt: '' };
    var ss = e.sess;
    if (now < e.win.start) {
      return { ok: false, txt: marketName(e.market) + ' ' + hmText(e.win.start) + ' 개장 전' };
    }
    return { ok: false, txt: marketName(e.market) + ' ' + hmText(e.win.start) + '–' + hmText(e.win.end) + ' 마감' };
  }

  /* ---------------- 1주 최소 매수 금액 ---------------- */
  function minTicket() {
    var m = Infinity;
    U.symbols.forEach(function (e) {
      var c = priceOf(e, U.span.start) * e.fx * (1 + e.fee.buy);
      if (c < m) m = c;
    });
    return isFinite(m) ? m : Infinity;
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
  function dayCardHTML() {
    var rows = U.parts.map(function (ss) {
      var pre = ss.extStart < ss.regStart - 60
        ? hmText(ss.extStart) + ' 프리 · ' : '';
      var post = ss.extEnd > ss.regEnd + 60
        ? ' · ' + hmText(ss.extEnd) + ' 애프터 종료' : '';
      return '<div class="mr-dayrow ' + ss.market.toLowerCase() + '">' +
        '<span class="fl">' + marketFlag(ss.market) + '</span>' +
        '<div><b>' + marketName(ss.market) + ' ' + shortDate(ss.date) + '(' + weekday(ss.date) + ')</b>' +
        '<span>' + pre + hmText(ss.regStart) + ' 정규장 시작 · ' + hmText(ss.regEnd) + ' 마감' + post + '</span></div>' +
        '<em>' + ss.symbols.length + '종목</em></div>';
    }).join('');
    return '<div class="mr-dayhead"><b>국장·미장 통합장</b>' +
      '<span>한국시간(KST) ' + esc(U.rangeText) + '</span></div>' + rows +
      '<p class="mr-daynote">두 시장의 실제 5분봉을 한국시간 한 줄에 늘어놓았습니다. 봉이 흐르는 종목은 실시간으로 사고팔 수 있고, ' +
      '장이 아닌 종목은 직전 종가로 평가되며 <b>거래시간 외</b>로 표시됩니다. ' +
      U.symbols.length + '종목을 한 판에 동시에 보유할 수 있습니다.</p>';
  }

  function renderLobby() {
    if (!U) return;
    if (pick.sym && !U.bySym[pick.sym.sym]) pick.sym = null;
    var card = $('mr-daycard');
    if (card) card.innerHTML = dayCardHTML();
    renderStartPick();
    renderTabs();
    renderSymbols();
    updateStart();
    var note = $('mr-data-note');
    if (note) {
      note.innerHTML = '실제 ' + (DATA.interval || '5m') + '봉(확장장 포함) · ' + U.symbols.length + '종목 · ' +
        '한국시간 ' + esc(U.rangeText) + ' · 갱신 ' + String(DATA.generatedAt || '').replace('T', ' ').slice(0, 16) +
        (autoOffset() > 300 ? ' · <b>지금 시각(' + hmText(Date.now() / 1000) + ')부터 시작할 수 있습니다</b>' : '');
    }
  }

  function renderStartPick() {
    var box = $('mr-startpick');
    if (!box) return;
    var opts = startOptions();
    var cur = currentOffset();
    box.innerHTML = opts.map(function (o) {
      return '<button type="button" data-off="' + o.off + '" class="' + (Math.abs(o.off - cur) < 1 ? 'on' : '') + '">' +
        o.label + ' <b>' + o.sub + '</b></button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        pick.startAt = +b.getAttribute('data-off');
        renderStartPick();
        renderSymbols();
        updateStart();
      });
    });
  }

  function renderTabs() {
    var box = $('mr-tabs');
    if (!box) return;
    box.innerHTML = TABS.map(function (t) {
      var n = U.symbols.filter(function (s) { return inTab(s, t.id); }).length;
      if (t.id !== 'ALL' && !n) return '';
      return '<button type="button" data-grp="' + t.id + '" class="' + (pick.grp === t.id ? 'on' : '') + '">' + t.label + '</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        pick.grp = b.getAttribute('data-grp');
        Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        renderSymbols();
      });
    });
  }
  function inTab(s, id) {
    if (id === 'ALL') return true;
    if (id.indexOf('MKT:') === 0) return s.market === id.slice(4);
    return (s.tags || []).indexOf(id) >= 0;
  }

  function filtered() {
    var q = (pick.q || '').trim().toLowerCase();
    return U.symbols.filter(function (s) {
      if (!inTab(s, pick.grp)) return false;
      return !q || matchSym(s, q);
    });
  }
  function matchSym(s, q) {
    return s.name.toLowerCase().indexOf(q) >= 0 || shortSym(s.sym).toLowerCase().indexOf(q) >= 0;
  }

  function renderSymbols() {
    var g = $('mr-symbols');
    if (!g) return;
    var list = filtered();
    var now = U.span.start + currentOffset();
    var acct = loadAcct();
    g.innerHTML = list.map(function (s) {
      var on = pick.sym && pick.sym.sym === s.sym;
      var h = acct.holdings[s.sym];
      var right = h && h.qty ? '<b class="hold">보유 ' + comma(h.qty) + '주</b>'
        : (on ? '<b class="sel">선택됨</b>' : '<b class="go">›</b>');
      return '<button type="button" class="mr-row mr-lobbyrow' + (on ? ' on' : '') + '" data-sym="' + esc(s.sym) + '">' +
        iconHTML(s, s.market) +
        '<span class="mr-rowmid"><b class="nm">' + esc(s.name) + '</b>' +
        '<span class="sub">' + marketFlag(s.market) + ' ' + esc(s.ex || '') + ' · ' + esc(shortSym(s.sym)) +
        ' · ' + (isLive(s, now) ? '<i class="on">거래 중</i>' : '<i class="off">거래시간 외</i>') + '</span></span>' +
        '<span class="mr-rowright">' + right + '</span></button>';
    }).join('');
    $('mr-empty').hidden = list.length > 0;
    $('mr-count').textContent = list.length + '개';
    Array.prototype.forEach.call(g.querySelectorAll('.mr-lobbyrow'), function (b) {
      b.addEventListener('click', function () {
        pick.sym = U.bySym[b.getAttribute('data-sym')];
        Array.prototype.forEach.call(g.querySelectorAll('.mr-lobbyrow'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        var r = b.querySelector('.mr-rowright');
        if (r && !r.querySelector('.sel') && !r.querySelector('.hold')) r.innerHTML = '<b class="sel">선택됨</b>';
        updateStart();
      });
    });
  }

  function updateStart() {
    if (!U) return;
    var a = loadAcct();
    var btn = $('mr-start');
    var eq = acctEquity(a);
    var bust = eq < minTicket();
    $('mr-bust').hidden = !bust;
    $('mr-bust-eq').textContent = won(eq);
    if (bust) {
      btn.disabled = true;
      btn.textContent = '총 자산이 1주 값보다 적어요 — 계좌를 초기화하세요';
      return;
    }
    if (!pick.sym) {
      btn.disabled = true;
      btn.textContent = '종목을 고르면 시작할 수 있어요';
      return;
    }
    var e = U.bySym[pick.sym.sym];
    var p = priceOf(e, U.span.start + currentOffset());
    if (p * e.fx * (1 + e.fee.buy) > eq) {
      btn.disabled = true;
      btn.textContent = '이 종목은 1주도 살 수 없어요 · 다른 종목을 고르세요';
      return;
    }
    btn.disabled = false;
    btn.textContent = '▶ ' + e.name + '부터 · ' + won(eq) + '으로 시작';
  }

  /* ---------------- 게임 시작 ---------------- */
  function startGame(sym) {
    if (!U) return;
    var acct = loadAcct();
    var off = currentOffset();
    S = null;                       // 이전 판 기준가가 섞이지 않도록
    if (!(acct.cash > 0 || holdCount(acct) > 0)) { toast('계좌 잔고가 없어요'); return; }

    S = {
      acct: acct,
      span: U.span,
      elapsed: Math.max(0, Math.min(off, U.span.dur - 1)),
      startOffset: Math.max(0, Math.min(off, U.span.dur - 1)),
      speed: 5, playing: true, ended: false,
      startCash: 0,
      bySym: U.bySym, px: {},
      view: sym ? 'sym:' + sym.sym : 'pf',
      active: sym ? sym.sym : null,
      open: sym ? [sym.sym] : [],
      pfFilter: 'hold', pfQ: '',
      frac: 0.1,
      trades: [], realized: 0, feesPaid: 0, sells: 0, wins: 0,
      peak: 0, dd: 0, curve: [], curveAt: 0
    };
    pick.sym = sym || null;
    updatePrices();
    // 시작 총 자산은 '실제 시작 시각의 가격'으로 매긴다
    S.startCash = Math.round(totalEquity());
    S.peak = S.startCash;
    S.curve = [S.startCash];
    if (!(S.startCash > 0)) { S = null; toast('계좌 잔고가 없어요'); return; }
    $('mr-play').innerHTML = playHTML();
    bindPlay();
    screen('play');
    renderBody();
    paint(true);
    lastReal = 0;
    startLoop();
  }

  function playHTML() {
    var s = S;
    var chips = U.parts.map(function (ss, i) {
      return '<span class="mr-mkchip" id="p-mk-' + i + '">' + marketFlag(ss.market) + ' <b>—</b></span>';
    }).join('');
    var jumps = U.parts.map(function (ss) {
      var b = '<button type="button" class="mr-jumpbtn" data-jump="' + (ss.regStart - U.span.start) + '">' +
        marketFlag(ss.market) + ' 정규장 <b>' + hmText(ss.regStart) + '</b></button>';
      if (ss.extStart < ss.regStart - 60) {
        b = '<button type="button" class="mr-jumpbtn" data-jump="' + (ss.extStart - U.span.start) + '">' +
          marketFlag(ss.market) + ' 프리 <b>' + hmText(ss.extStart) + '</b></button>' + b;
      }
      return b;
    }).join('');
    return '' +
      '<div class="mr-live">' +
        '<div class="mkt"><span>국장·미장 통합장 · 한국시간 ' + esc(U.rangeText) + '</span>' +
          '<b class="mr-mkrow">' + chips + '</b></div>' +
        '<div class="clk"><b id="p-clock">--:--:--</b><span id="p-phase">재생 중 · KST</span></div>' +
      '</div>' +
      '<div class="mr-eqcard" id="p-eqcard">' +
        '<div class="mr-eqmain"><span>총 자산</span><b id="p-eq">—</b><i id="p-eqr" class="flat">0.00%</i></div>' +
        '<div class="mr-eqgrid">' +
          '<div><span>투자 원금</span><b id="p-prin">—</b></div>' +
          '<div><span>총 평가손익</span><b id="p-pnl">—</b><i id="p-pnlpct">—</i></div>' +
          '<div><span>주문 가능 현금</span><b id="p-cashh">—</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="mr-daybar"><i id="p-dayprog"></i></div>' +
      '<div class="mr-daymeta"><span id="p-barin">—</span><span id="p-daypct">0%</span></div>' +
      '<div class="mr-ctl">' +
        '<button type="button" class="mr-pause" id="p-pause">⏸ 일시정지</button>' +
        '<div class="mr-speed" id="p-speed">' +
          SPEEDS.map(function (v) { return '<button type="button" data-sp="' + v + '" class="' + (v === s.speed ? 'on' : '') + '">' + v + 'x</button>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="mr-jumps">' + jumps + '</div>' +
      '<div class="mr-vtabs" id="p-vtabs"></div>' +
      '<div id="p-body"></div>';
  }

  function bindPlay() {
    $('p-pause').addEventListener('click', function () {
      if (!S || S.ended) return;
      S.playing = !S.playing;
      lastReal = 0;
      this.textContent = S.playing ? '⏸ 일시정지' : '▶ 재생';
      if (S.playing) startLoop(); else stopLoop();
      paint(true);
    });
    $('p-speed').addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-sp]') : null;
      if (!b || !S) return;
      S.speed = +b.getAttribute('data-sp');
      Array.prototype.forEach.call($('p-speed').querySelectorAll('button'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      lastReal = 0;
    });
    $('p-vtabs').addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-view]') : null;
      if (!b || !S) return;
      var v = b.getAttribute('data-view');
      if (v === 'add') { S.pfFilter = 'all'; setView('pf'); return; }
      if (v === 'pf') S.pfFilter = 'hold';
      setView(v);
    });
    var jumps = document.querySelector('.mr-jumps');
    if (jumps) {
      jumps.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('button[data-jump]') : null;
        if (!b || !S || S.ended) return;
        var off = +b.getAttribute('data-jump');
        if (!isFinite(off)) return;
        S.elapsed = Math.max(0, Math.min(off, S.span.dur - 1));
        S.curveAt = Math.floor(S.elapsed / BAR_SEC);
        lastReal = 0;
        updatePrices();
        paint(true);
        toast('한국시간 ' + hmText(S.span.start + S.elapsed) + '으로 이동했어요');
      });
    }
    var body = $('p-body');
    body.addEventListener('click', function (ev) {
      if (!S || S.ended) return;
      var t = ev.target;
      var row = t.closest ? t.closest('.mr-row[data-sym]') : null;
      if (row) { openSym(row.getAttribute('data-sym')); return; }
      var pf = t.closest ? t.closest('button[data-pf]') : null;
      if (pf) { S.pfFilter = pf.getAttribute('data-pf'); renderBody(); return; }
      if (t.closest && t.closest('#p-add')) { S.pfFilter = 'all'; renderBody(); return; }
      var fr = t.closest ? t.closest('button[data-frac]') : null;
      if (fr && S.active) {
        S.frac = +fr.getAttribute('data-frac');
        Array.prototype.forEach.call(body.querySelectorAll('button[data-frac]'), function (x) { x.classList.remove('on'); });
        fr.classList.add('on');
        paint(true);
        return;
      }
      if (t.closest && t.closest('#p-buy')) { buy(S.active, S.frac); return; }
      if (t.closest && t.closest('#p-sell')) { sell(S.active, S.frac); return; }
    }, false);
    body.addEventListener('input', function (ev) {
      if (ev.target && ev.target.id === 'p-q2' && S) {
        S.pfQ = ev.target.value;
        renderRows();
      }
    });
  }

  function openSym(id) {
    if (!S.bySym[id]) return;
    if (S.open.indexOf(id) < 0) S.open.push(id);
    S.active = id;
    S.view = 'sym:' + id;
    renderBody();
  }

  function setView(v) {
    if (!S) return;
    S.view = v;
    if (v.indexOf('sym:') === 0) S.active = v.slice(4);
    renderBody();
  }

  function renderTopTabs() {
    var box = $('p-vtabs');
    if (!box || !S) return;
    var eq = totalEquity();
    var html = '<button type="button" class="mr-vtab' + (S.view === 'pf' ? ' on' : '') + '" data-view="pf">' +
      '<b>내 포트폴리오</b><small id="tab-eq">' + won(eq) + '</small></button>';
    S.open.forEach(function (id) {
      var e = S.bySym[id];
      if (!e) return;
      var h = S.acct.holdings[id];
      var lab = h && h.qty ? pct(holdRet(id)) : '보기';
      html += '<button type="button" class="mr-vtab' + (S.view === 'sym:' + id ? ' on' : '') + '" data-view="sym:' + id + '">' +
        '<b>' + esc(e.name) + '</b><small class="' + (h && h.qty ? cls(holdRet(id)) : '') + '">' + lab + '</small></button>';
    });
    html += '<button type="button" class="mr-vtab add" data-view="add"><b>＋ 종목</b><small>추가하기</small></button>';
    box.innerHTML = html;
  }

  function renderBody() {
    var box = $('p-body');
    if (!box || !S) return;
    if (S.view === 'pf' || !S.bySym[S.active]) {
      box.innerHTML = pfHTML();
      renderTopTabs();
      renderRows();
    } else {
      box.innerHTML = symHTML();
      renderTopTabs();
      paintSym(nowEpoch());
    }
    paint(true);
  }

  /* ---------------- 내 포트폴리오 ---------------- */
  function holdIds() {
    var ids = [];
    for (var id in S.acct.holdings) if (S.acct.holdings[id].qty > 0) ids.push(id);
    return ids.sort(function (a, b) { return holdValue(b) - holdValue(a); });
  }
  function holdValue(id) {
    var h = S.acct.holdings[id];
    if (!h) return 0;
    var m = markFor(id, h);
    return h.qty * m.px * m.fx;
  }
  function holdRet(id) {
    var h = S.acct.holdings[id];
    if (!h || !h.paid) return 0;
    return (holdValue(id) - h.paid) / h.paid * 100;
  }
  function allIds() {
    var q = (S.pfQ || '').trim().toLowerCase();
    return U.symbols.filter(function (s) { return !q || matchSym(s, q); }).map(function (s) { return s.sym; });
  }

  function pill(v, label, n) {
    return '<button type="button" data-pf="' + v + '" class="' + (S.pfFilter === v ? 'on' : '') + '">' +
      label + ' <b>' + n + '</b></button>';
  }

  function pfHTML() {
    var held = holdIds();
    var kr = held.filter(function (id) { var h = S.acct.holdings[id]; return h && h.market === 'KR'; }).length;
    var all = U.symbols.length;
    return '' +
      '<div class="mr-pills">' + pill('hold', '내 포트폴리오', held.length) + pill('all', '전체 종목', all) + '</div>' +
      (S.pfFilter === 'all'
        ? '<div class="mr-searchwrap"><input type="search" id="p-q2" placeholder="종목명·티커 검색 (삼성전자, NVDA)" autocomplete="off" value="' + esc(S.pfQ || '') + '"></div>'
        : '') +
      '<div class="mr-pfheadline"><b>' + (S.pfFilter === 'all' ? '전체 종목' : '보유 종목') + '</b>' +
        '<span>' + (S.pfFilter === 'all' ? '이름을 눌러 차트 열기' : held.length ? '🇰🇷 ' + kr + ' · 🇺🇸 ' + (held.length - kr) : '') + '</span></div>' +
      '<div class="mr-pflist" id="p-rows"></div>' +
      '<button type="button" class="mr-addrow" id="p-add"><i>＋</i>종목 추가하기</button>' +
      '<p class="mr-fine">보유 종목은 <b>팔기 전까지 다음 날 장에도 그대로</b> 이어집니다. 지금 장이 아닌 종목은 직전 종가로 평가하고 <b>거래시간 외</b>로 표시합니다. 총 평가손익 = 총 자산 − 투자 원금.</p>';
  }

  function renderRows() {
    var box = $('p-rows');
    if (!box || !S) return;
    var ids = S.pfFilter === 'all' ? allIds() : holdIds();
    if (!ids.length) {
      box.innerHTML = '<p class="mr-empty2">' +
        (S.pfFilter === 'all' ? '검색 결과가 없어요.' : '아직 보유한 종목이 없어요. 아래 <b>＋ 종목 추가하기</b>로 종목을 열고 구매해 보세요.') +
        '</p>';
      S.rowRefs = {};
      return;
    }
    var now = nowEpoch();
    box.innerHTML = ids.map(function (id) {
      var e = S.bySym[id];
      var h = S.acct.holdings[id];
      if (S.pfFilter === 'all') {
        return '<button type="button" class="mr-row" data-sym="' + esc(id) + '">' +
          iconHTML(e, e.market, id) +
          '<span class="mr-rowmid"><b class="nm">' + esc(e.name) + '</b>' +
          '<span class="sub">' + marketFlag(e.market) + ' ' + esc(e.ex || '') + ' · ' + esc(shortSym(id)) + '</span></span>' +
          '<span class="mr-rowright">' + (h && h.qty ? '<b class="hold">보유 ' + comma(h.qty) + '주</b>' : '<b class="go">›</b>') + '</span></button>';
      }
      var m = markFor(id, h);
      var val = h.qty * m.px * m.fx;
      var pnl = val - h.paid;
      var dayPct = m.prevClose ? (m.px / m.prevClose - 1) * 100 : 0;
      var ts = tradeState(e, now);
      return '<button type="button" class="mr-row" data-sym="' + esc(id) + '">' +
        iconHTML(e, h.market, id) +
        '<span class="mr-rowmid"><b class="nm">' + esc(h.name) + '</b>' +
        '<span class="sub">' + comma(h.qty) + '주 · 평단 ' + avgText(h) + ' · ' + marketFlag(h.market) + ' ' + esc(shortSym(id)) + '</span>' +
        '<span class="sub2">현재 <i class="cur">' + curText(m, e) + '</i> · 평가손익 <i class="pnl ' + cls(pnl) + '">' +
          (pnl >= 0 ? '+' : '') + won(pnl) + '</i> · 오늘 <i class="day ' + cls(dayPct) + '">' + pct(dayPct) + '</i>' +
          (ts.ok ? '' : ' <i class="oth">거래시간 외</i>') + '</span></span>' +
        '<span class="mr-rowright"><b class="rt ' + cls(holdRet(id)) + '">' + pct(holdRet(id)) + '</b>' +
        '<span class="amt">' + won(val) + '</span></span></button>';
    }).join('');
    S.rowRefs = {};
    Array.prototype.forEach.call(box.querySelectorAll('.mr-row'), function (b) {
      var id = b.getAttribute('data-sym');
      var h = S.acct.holdings[id];
      if (!h) return;
      S.rowRefs[id] = {
        rt: b.querySelector('.rt'),
        amt: b.querySelector('.amt'),
        pnl: b.querySelector('.pnl'),
        day: b.querySelector('.day'),
        cur: b.querySelector('.cur')
      };
    });
  }

  function avgText(h) {
    if (!h || !h.qty) return '—';
    var native = h.avgOrig || 0;
    if (h.market === 'US') return usd(native);
    return won(native);
  }
  function curText(m, e) {
    if (!m) return '—';
    var usdSym = e && e.cur === 'USD';
    return (usdSym ? usd(m.px) + ' · ' : '') + won(m.px * m.fx);
  }

  function paintRows() {
    if (!S || !S.rowRefs) return;
    for (var id in S.rowRefs) {
      var r = S.rowRefs[id];
      var h = S.acct.holdings[id];
      if (!r || !h) continue;
      var m = markFor(id, h);
      var val = h.qty * m.px * m.fx;
      var pnl = val - h.paid;
      var ret = h.paid ? pnl / h.paid * 100 : 0;
      var dayPct = m.prevClose ? (m.px / m.prevClose - 1) * 100 : 0;
      if (r.rt) { r.rt.textContent = pct(ret); r.rt.className = 'rt ' + cls(ret); }
      if (r.amt) r.amt.textContent = won(val);
      if (r.cur) r.cur.textContent = curText(m, S.bySym[id]);
      if (r.pnl) {
        r.pnl.textContent = (pnl >= 0 ? '+' : '') + won(pnl);
        r.pnl.className = 'pnl ' + cls(pnl);
      }
      if (r.day) { r.day.textContent = pct(dayPct); r.day.className = 'day ' + cls(dayPct); }
    }
  }

  /* ---------------- 종목 매매 화면 ---------------- */
  function symHTML() {
    var e = S.bySym[S.active];
    if (!e) return pfHTML();
    return '' +
      '<div class="mr-symhead">' +
        '<div class="id">' + iconHTML(e, e.market) +
          '<div><div class="nm">' + esc(e.name) + '</div>' +
          '<div class="meta">' + marketFlag(e.market) + ' ' + esc(e.ex || '') + ' · ' + esc(shortSym(e.sym)) +
            ' · ' + marketName(e.market) + ' ' + shortDate(e.sess.date) + '(' + weekday(e.sess.date) + ')</div></div>' +
        '</div>' +
        '<div class="px"><b id="p-price">—</b><span id="p-chg">—</span></div>' +
      '</div>' +
      '<div class="mr-status" id="p-status">—</div>' +
      '<div class="mr-chartbox"><canvas id="mr-chart" aria-label="실제 5분봉 차트"></canvas></div>' +
      '<div class="mr-chartfoot"><span id="p-barprog">—</span>' +
        '<span class="bar"><i id="p-brief"></i></span><span id="p-countdown">—</span></div>' +
      '<div class="mr-panel">' +
        '<div class="mr-panelhead">내 보유 <b id="p-own">0주</b></div>' +
        '<div class="mr-hold" id="p-hold"></div>' +
        '<div class="mr-cashrow"><span>주문 가능 현금</span><b id="p-cash">—</b></div>' +
        '<div class="mr-frac" id="p-frac">' +
          [['10%', 0.1], ['25%', 0.25], ['50%', 0.5], ['최대', 1]].map(function (f) {
            return '<button type="button" data-frac="' + f[1] + '" class="' + (Math.abs(S.frac - f[1]) < 1e-9 ? 'on' : '') + '">' + f[0] + '</button>';
          }).join('') +
        '</div>' +
        '<div class="mr-preview" id="p-preview">—</div>' +
        '<div class="mr-actions">' +
          '<button type="button" class="mr-buy" id="p-buy">구매하기</button>' +
          '<button type="button" class="mr-sell" id="p-sell">판매하기</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 가격 ---------------- */
  function updatePrices() {
    if (!S) return;
    var now = nowEpoch();
    var px = {};
    for (var id in S.bySym) px[id] = priceOf(S.bySym[id], now);
    S.px = px;
  }
  function totalEquity() {
    if (!S) return 0;
    var eq = S.acct.cash;
    for (var id in S.acct.holdings) {
      var h = S.acct.holdings[id];
      if (!(h.qty > 0)) continue;
      var m = markFor(id, h);
      eq += h.qty * m.px * m.fx;
    }
    return eq;
  }

  /* ---------------- 진행 ---------------- */
  function startLoop() {
    stopLoop();
    raf = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function tick() {
    if (!S || S.ended) return;
    var t = Date.now();
    if (!lastReal) lastReal = t;
    var dt = (t - lastReal) / 1000;
    lastReal = t;
    if (dt < 0) dt = 0;
    if (dt > 2) dt = 2;            // 탭 전환 등으로 크게 벌어지면 그만큼만 흘린다
    if (S.playing) S.elapsed += dt * S.speed;
    if (S.elapsed >= S.span.dur) { S.elapsed = S.span.dur; paint(true); finish(); return; }
    paint(false);
    raf = requestAnimationFrame(tick);
  }

  function paint(force) {
    if (!S) return;
    var t = performance.now();
    if (!force && t - (S.lastPaint || 0) < 170) return;
    S.lastPaint = t;
    updatePrices();

    var s = S, span = s.span;
    var now = nowEpoch();

    $('p-clock').textContent = clockText(now);
    $('p-phase').textContent = !s.playing ? '일시정지 · KST'
      : (s.startOffset > 0 ? hmText(span.start + s.startOffset) + '부터 · KST' : '재생 중 · KST');

    // 두 시장의 지금 단계
    U.parts.forEach(function (ss, i) {
      var el = $('p-mk-' + i);
      if (!el) return;
      var ph = phaseOf(ss, now);
      el.className = 'mr-mkchip ' + ph.k;
      el.innerHTML = marketFlag(ss.market) + ' <b>' + ph.t + '</b>';
    });

    var pr = Math.min(100, s.elapsed / span.dur * 100);
    $('p-dayprog').style.width = pr.toFixed(2) + '%';
    $('p-daypct').textContent = Math.round(pr) + '%';
    $('p-barin').textContent = dayText(span.start) + ' ' + hmText(span.start) + ' → ' + hmText(span.end) + ' (KST)';

    var eq = totalEquity();
    if (eq > s.peak) s.peak = eq;
    var dd = s.peak > 0 ? (eq / s.peak - 1) * 100 : 0;
    if (dd < s.dd) s.dd = dd;
    var ret = (eq / s.startCash - 1) * 100;
    $('p-eq').textContent = won(eq);
    $('p-eqr').textContent = pct(ret);
    $('p-eqr').className = cls(ret);
    $('p-prin').textContent = won(s.startCash);
    var pnl = eq - s.startCash;
    $('p-pnl').textContent = (pnl >= 0 ? '+' : '') + won(pnl);
    $('p-pnl').className = cls(pnl);
    var pp = $('p-pnlpct');
    if (pp) { pp.textContent = pct(ret); pp.className = cls(ret); }
    $('p-cashh').textContent = won(s.acct.cash);
    $('p-eqcard').className = 'mr-eqcard' + (s.view === 'pf' ? '' : ' compact');

    var bi = Math.floor(s.elapsed / BAR_SEC);
    if (bi > s.curveAt) { s.curveAt = bi; s.curve.push(eq); if (s.curve.length > 900) s.curve.shift(); }

    var tabEq = $('tab-eq');
    if (tabEq) tabEq.textContent = won(eq);

    if (s.view === 'pf') paintRows();
    else paintSym(now);
  }

  function paintSym(now) {
    var s = S, e = s.bySym[s.active];
    if (!e) return;
    var i = lastClosedIdx(e, now);
    var pi = priceInfo(e, now);
    var p = pi.px;
    var prev = pi.prevClose;
    var chPct = pi.chg;
    var chKrw = prev ? (p - prev) * e.fx : 0;
    $('p-price').textContent = won(p * e.fx);
    var ce = $('p-chg');
    ce.className = cls(chPct);
    ce.innerHTML = (chKrw >= 0 ? '▲ ' : '▼ ') + won(Math.abs(chKrw)) + ' ' + pct(chPct) +
      (e.cur === 'USD' ? ' · ' + usd(p) : '');

    // 거래 가능 상태
    var st = tradeState(e, now);
    var stEl = $('p-status');
    if (stEl) {
      if (st.ok) {
        stEl.className = 'mr-status on';
        stEl.innerHTML = '● 지금 ' + marketName(e.market) + ' ' + phaseOf(e.sess, now).t + ' · 실시간 매매 가능';
      } else {
        stEl.className = 'mr-status';
        stEl.innerHTML = '○ 지금은 <b>거래시간 외</b> — ' + esc(st.txt) + ' · 직전 종가 ' + won(p * e.fx) + '로 평가';
      }
    }
    var buyBtn = $('p-buy'), sellBtn = $('p-sell');
    if (buyBtn) buyBtn.disabled = !st.ok;
    if (sellBtn) sellBtn.disabled = !st.ok;

    $('p-barprog').textContent = (i + 1) + '/' + e.bars.length + '봉';
    var frac = 0;
    if (i < 0) frac = now < e.win.start ? 0 : 1;
    else frac = Math.min(1, Math.max(0, (now - (e.bars[i][0] + BAR_SEC)) / BAR_SEC));
    $('p-brief').style.width = Math.round(frac * 100) + '%';
    var nextAt = (i + 1 < e.bars.length ? e.bars[i + 1][0] + BAR_SEC : e.win.end);
    var left = Math.max(0, Math.round(nextAt - now));
    var cd = $('p-countdown');
    if (!st.ok && now < e.win.start) cd.textContent = '개장까지 ' + Math.floor(left / 60) + ':' + pad2(left % 60);
    else if (!st.ok) cd.textContent = '거래 종료';
    else if (i + 1 >= e.bars.length) cd.textContent = '마지막 봉';
    else cd.textContent = '다음 봉 ' + Math.floor(left / 60) + ':' + pad2(left % 60);

    var h = s.acct.holdings[s.active];
    var qty = h ? h.qty : 0;
    $('p-own').textContent = comma(qty) + '주';
    $('p-cash').textContent = won(s.acct.cash);
    var val = qty * p * e.fx;
    var paid = h ? h.paid : 0;
    var upl = val - paid;
    var ur = paid > 0 ? upl / paid * 100 : 0;
    $('p-hold').innerHTML =
      row('보유 수량', qty ? comma(qty) + '주' : '0주') +
      row('평균 단가', qty ? avgText(h) : '—') +
      row('현재가', e.cur === 'USD' ? won(p * e.fx) + ' (' + usd(p) + ')' : won(p)) +
      row('평가 금액', won(val)) +
      row('평가 손익', qty ? (upl >= 0 ? '+' : '') + won(upl) + ' (' + pct(ur) + ')' : '—', qty ? cls(upl) : '') +
      row('오늘 등락률', pct(chPct), cls(chPct));

    var bq = 0, uc = p * e.fx * (1 + e.fee.buy);
    if (uc > 0) bq = Math.floor((s.acct.cash * Math.min(1, s.frac)) / uc);
    while (bq > 0 && bq * uc > s.acct.cash + 1e-6) bq--;
    var sq = qty ? Math.max(1, Math.floor(qty * Math.min(1, s.frac))) : 0;
    if (sq > qty) sq = qty;
    $('p-preview').innerHTML = '구매 <b>' + comma(bq) + '주</b> ' + won(bq * uc) +
      ' · 판매 <b>' + comma(sq) + '주</b> ' + won(sq * p * e.fx * (1 - e.fee.sell - (e.fee.tax || 0))) +
      (st.ok ? '' : ' · <b>거래시간 외</b>');

    drawChart();
  }
  function row(a, b, c) {
    return '<div class="mr-irow"><span>' + a + '</span><b class="' + (c || '') + '">' + b + '</b></div>';
  }

  /* ---------------- 매매 ---------------- */
  function buy(id, frac) {
    if (!S || S.ended || !id) return;
    var e = S.bySym[id];
    var st = tradeState(e, nowEpoch());
    if (!st.ok) { toast(e.name + ' · ' + st.txt + ' — 거래시간 외에는 살 수 없어요'); return; }
    var p = S.px[id], uc = p * e.fx * (1 + e.fee.buy);
    var n = Math.floor((S.acct.cash * Math.min(1, frac)) / uc + 1e-9);
    while (n > 0 && n * uc > S.acct.cash + 1e-6) n--;
    if (n <= 0) { toast('1주도 살 수 없는 금액이에요'); return; }
    var gross = n * p * e.fx, fee = gross * e.fee.buy;
    S.acct.cash -= gross + fee;
    S.feesPaid += fee;
    var h = S.acct.holdings[id];
    if (!h) {
      h = S.acct.holdings[id] = {
        qty: 0, paid: 0, avgOrig: 0, market: e.market,
        name: e.name, ex: e.ex || '', lastPx: p, lastFx: e.fx
      };
    }
    var unitNative = p * (1 + e.fee.buy);
    h.avgOrig = (h.avgOrig * h.qty + unitNative * n) / (h.qty + n);
    h.qty += n;
    h.paid += gross + fee;
    h.lastPx = p;
    h.lastFx = e.fx;
    h.lastDate = e.sess.date;
    S.trades.push({ i: Math.max(0, lastClosedIdx(e, nowEpoch())), id: id, side: 'B', n: n, p: p, amt: gross + fee });
    saveAcct(S.acct);
    toast(e.name + ' ' + n + '주 구매 · ' + won(gross + fee) + ' (' + marketFlag(e.market) + ')');
    renderBody();
  }

  function sell(id, frac) {
    if (!S || S.ended || !id) return;
    var h = S.acct.holdings[id];
    if (!h || !(h.qty > 0)) { toast('보유한 주식이 없어요'); return; }
    var e = S.bySym[id];
    var st = tradeState(e, nowEpoch());
    if (!st.ok) { toast(e.name + ' · ' + st.txt + ' — 거래시간 외에는 팔 수 없어요'); return; }
    var n = frac >= 1 ? h.qty : Math.max(1, Math.floor(h.qty * frac));
    if (n > h.qty) n = h.qty;
    var p = S.px[id], gross = n * p * e.fx;
    var fee = gross * e.fee.sell, tax = gross * (e.fee.tax || 0);
    var net = gross - fee - tax;
    var avgPaid = h.paid / h.qty;
    var pnl = net - avgPaid * n;
    S.acct.cash += net;
    S.feesPaid += fee + tax;
    S.realized += pnl;
    h.paid -= avgPaid * n;
    h.qty -= n;
    h.lastPx = p;
    h.lastFx = e.fx;
    h.lastDate = e.sess.date;
    if (h.qty <= 0) delete S.acct.holdings[id];
    S.sells += 1;
    if (pnl > 0) S.wins += 1;
    S.trades.push({ i: Math.max(0, lastClosedIdx(e, nowEpoch())), id: id, side: 'S', n: n, p: p, amt: net });
    saveAcct(S.acct);
    toast(n + '주 판매 · ' + won(net) + ' (' + (pnl >= 0 ? '+' : '') + won(pnl) + ')');
    renderBody();
  }

  /* ---------------- 차트 ---------------- */
  function drawChart() {
    var cv = $('mr-chart');
    if (!cv || !S || !S.active) return;
    var e = S.bySym[S.active];
    if (!e) return;
    var dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth || 640, H = cv.clientHeight || 320;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px -apple-system,"Pretendard","Noto Sans KR",sans-serif';
    ctx.textBaseline = 'middle';

    var bars = e.bars, n = bars.length, now = nowEpoch();
    var last = lastClosedIdx(e, now);
    var shown = Math.max(0, last);
    var narrow = W < 480;
    var padT = 14, padB = 20, padR = narrow ? 46 : 76;
    var volH = Math.max(32, H * 0.15), gap = 12;
    var priceH = H - padT - padB - volH - gap;
    var padL = narrow ? 4 : 8;
    var iw = W - padL - padR;
    var slot = iw / n;

    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i <= shown; i++) {
      if (bars[i][3] < lo) lo = bars[i][3];
      if (bars[i][2] > hi) hi = bars[i][2];
    }
    if (!isFinite(lo)) { lo = bars[0][3]; hi = bars[0][2]; }
    var prev = e.day.prevClose;
    var band = (hi - lo) || hi * 0.01 || 1;
    var prevIn = prev && prev > lo - band * 0.6 && prev < hi + band * 0.6;
    if (prevIn) { lo = Math.min(lo, prev); hi = Math.max(hi, prev); }
    var h = S.acct.holdings[e.sym];
    if (h && h.qty > 0 && h.avgOrig) { lo = Math.min(lo, h.avgOrig); hi = Math.max(hi, h.avgOrig); }
    var pad = (hi - lo) * 0.12 || hi * 0.01 || 1;
    lo -= pad; hi += pad;
    var y = function (v) { return padT + priceH - (v - lo) / (hi - lo) * priceH; };
    var xAt = function (k) { return padL + slot * (k + 0.5); };

    var UP = css('--g-up'), DN = css('--g-dn'), LINE = css('--g-line'), MUT = css('--g-mut');

    // 확장장 구간 음영 (프리 / 애프터)
    var regS = -1, regE = -1;
    for (var r = 0; r < n; r++) {
      if (regS < 0 && bars[r][0] >= e.reg[0]) regS = r;
      if (bars[r][0] < e.reg[1]) regE = r;
    }
    if (regS > 0) {
      ctx.fillStyle = hexA(MUT, 0.07);
      ctx.fillRect(padL, padT, slot * regS, priceH + gap + volH);
      ctx.fillStyle = hexA(MUT, 0.85);
      ctx.textAlign = 'left';
      ctx.fillText(e.market === 'US' ? '프리' : '장전', padL + 4, padT + 10);
    }
    if (regE >= 0 && regE < n - 1) {
      var px0 = padL + slot * (regE + 1);
      ctx.fillStyle = hexA(MUT, 0.07);
      ctx.fillRect(px0, padT, padL + iw - px0, priceH + gap + volH);
      ctx.fillStyle = hexA(MUT, 0.85);
      ctx.textAlign = 'right';
      ctx.fillText('애프터', padL + iw - 4, padT + 10);
    }
    if (regS > 0) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = hexA(MUT, 0.6);
      ctx.beginPath(); ctx.moveTo(padL + slot * regS, padT); ctx.lineTo(padL + slot * regS, padT + priceH + gap + volH); ctx.stroke();
      ctx.restore();
    }

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.fillStyle = MUT;
    ctx.textAlign = 'left';
    for (var k = 0; k <= 4; k++) {
      var v = lo + (hi - lo) * k / 4;
      var yy = Math.round(y(v)) + 0.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + iw, yy); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(axisFmt(v * e.fx, narrow), padL + iw + 6, y(v));
    }
    if (prevIn) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = MUT;
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(padL, y(prev)); ctx.lineTo(padL + iw, y(prev)); ctx.stroke();
      ctx.restore();
    }

    var candle = slot >= 4.2;
    if (candle) {
      var bw = Math.max(1.5, slot * 0.66);
      for (var i2 = 0; i2 <= shown; i2++) {
        var b = bars[i2], up = b[4] >= b[1];
        ctx.strokeStyle = up ? UP : DN;
        ctx.fillStyle = up ? UP : DN;
        var cx = xAt(i2);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(cx) + 0.5, y(b[2])); ctx.lineTo(Math.round(cx) + 0.5, y(b[3])); ctx.stroke();
        var yo = y(b[1]), yc = y(b[4]);
        var top = Math.min(yo, yc), hgt = Math.max(1.2, Math.abs(yc - yo));
        ctx.fillRect(cx - bw / 2, top, bw, hgt);
      }
    } else {
      var grad = ctx.createLinearGradient(0, padT, 0, padT + priceH);
      var col = bars[shown][4] >= bars[0][1] ? UP : DN;
      grad.addColorStop(0, hexA(col, 0.28));
      grad.addColorStop(1, hexA(col, 0.02));
      ctx.beginPath();
      ctx.moveTo(xAt(0), y(bars[0][4]));
      for (var i3 = 1; i3 <= shown; i3++) ctx.lineTo(xAt(i3), y(bars[i3][4]));
      ctx.lineTo(xAt(shown), y(lo)); ctx.lineTo(xAt(0), y(lo)); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(xAt(0), y(bars[0][4]));
      for (var i4 = 1; i4 <= shown; i4++) ctx.lineTo(xAt(i4), y(bars[i4][4]));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    }

    ctx.beginPath();
    var started = false;
    for (var i5 = 0; i5 <= shown; i5++) {
      if (i5 < 4) continue;
      var sum = 0;
      for (var j = i5 - 4; j <= i5; j++) sum += bars[j][4];
      var v5 = sum / 5;
      if (!started) { ctx.moveTo(xAt(i5), y(v5)); started = true; } else ctx.lineTo(xAt(i5), y(v5));
    }
    if (started) { ctx.strokeStyle = '#C9A227'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1; }

    if (h && h.qty > 0 && h.avgOrig) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#FFB020';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, y(h.avgOrig)); ctx.lineTo(padL + iw, y(h.avgOrig)); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#FFB020';
      ctx.textAlign = 'right';
      ctx.fillText('평단', padL + iw - 4, y(h.avgOrig) - 8);
    }

    // 재생 헤드(지금 시각)
    var xf = padL + slot * Math.max(0, Math.min(n, (now - bars[0][0]) / BAR_SEC));
    ctx.save();
    ctx.strokeStyle = css('--g-text');
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xf, padT - 6); ctx.lineTo(xf, padT + priceH + gap + volH); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = MUT;
    ctx.textAlign = 'center';
    ctx.fillText(hmText(now), Math.min(padL + iw - 12, Math.max(padL + 12, xf)), padT - 8);

    var pNow = last < 0 ? bars[0][1] : bars[last][4];
    var lab = comma(pNow * e.fx);
    var lw = padR - 6;
    var ly = Math.min(padT + priceH - 9, Math.max(padT + 9, y(pNow)));
    ctx.fillStyle = pNow >= (prev || pNow) ? UP : DN;
    ctx.fillRect(padL + iw + 2, ly - 9, lw, 18);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(lab, padL + iw + 8, ly);

    var vmax = 0;
    for (var i6 = 0; i6 <= shown; i6++) vmax = Math.max(vmax, bars[i6][5]);
    var vy0 = padT + priceH + gap;
    for (var i7 = 0; i7 <= shown; i7++) {
      var vb = bars[i7], vh = vmax ? (vb[5] / vmax) * volH : 0;
      ctx.fillStyle = hexA(vb[4] >= vb[1] ? UP : DN, 0.55);
      var vx = xAt(i7);
      var wv = candle ? Math.max(1.2, slot * 0.62) : Math.max(1, slot * 0.9);
      ctx.fillRect(vx - wv / 2, vy0 + volH - vh, wv, vh);
    }
    ctx.fillStyle = MUT;
    ctx.textAlign = 'left';
    ctx.fillText('거래량 ' + volTxt(bars[shown][5]), padL + 2, vy0 - 6);

    S.trades.forEach(function (t) {
      if (t.id !== S.active || t.i > last) return;
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

    ctx.fillStyle = MUT;
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.ceil(n / 5));
    for (var i8 = 0; i8 < n; i8 += step) {
      if (xAt(i8) > xf + 2) break;
      ctx.fillText(hmText(bars[i8][0]), xAt(i8), H - 8);
    }
  }
  function axisFmt(v, narrow) {
    if (narrow) {
      if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + '억';
      if (Math.abs(v) >= 1e4) return Math.round(v / 1e4) + '만';
      return comma(v);
    }
    return comma(v);
  }
  function volTxt(v) {
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '억';
    if (v >= 1e4) return (v / 1e4).toFixed(0) + '만';
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
    var ids = [];
    S.trades.forEach(function (t) { if (t.side === 'B' && ids.indexOf(t.id) < 0) ids.push(t.id); });
    if (!ids.length && S.open[0]) ids.push(S.open[0]);
    if (!ids.length && S.active) ids.push(S.active);
    if (!ids.length) return { ret: 0, ids: [] };
    var each = S.startCash / ids.length;
    var value = S.startCash;
    ids.forEach(function (id) {
      var e = S.bySym[id];
      if (!e) return;
      var uc = e.day.open * e.fx * (1 + e.fee.buy);
      var n = Math.max(0, Math.floor(each / (uc + 1e-9)));
      if (!n) return;
      value += -(n * uc) + n * e.day.close * e.fx * (1 - e.fee.sell - (e.fee.tax || 0));
    });
    return { ret: (value / S.startCash - 1) * 100, ids: ids };
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
    if (!S) return;
    S.ended = true;
    S.playing = false;
    stopLoop();
    S.elapsed = S.span.dur;
    updatePrices();

    var finalEq = totalEquity();
    var myRet = (finalEq / S.startCash - 1) * 100;
    var bh = bench();
    var g = grade(myRet, myRet - bh.ret);
    var winRate = S.sells ? (S.wins / S.sells * 100) : null;

    // 보유 종목은 그대로 두고, 마지막 평가 기준만 남긴다 (다음 날 이월)
    for (var id in S.acct.holdings) {
      var hh = S.acct.holdings[id];
      var m = markFor(id, hh);
      hh.lastPx = m.px;
      hh.lastFx = m.fx;
      hh.lastDate = S.bySym[id] ? S.bySym[id].sess.date : hh.lastDate;
    }
    var acct = S.acct;
    acct.games += 1;
    if (myRet > 0) acct.wins += 1;
    if (myRet > acct.best || acct.games === 1) {
      acct.best = myRet;
      acct.bestLabel = '통합장 ' + dayText(S.span.end) + ' ' + pct(myRet);
    }
    acct.history.unshift({
      d: dayText(S.span.end), m: '통합', s: S.trades.length ? S.trades.length + '건' : '거래 없음',
      r: Math.round(myRet * 100) / 100, g: g.g, eq: Math.round(finalEq), h: holdCount(acct)
    });
    acct.history = acct.history.slice(0, 12);
    saveAcct(acct);

    var cumRet = (finalEq / baseCash() - 1) * 100;
    var busted = finalEq < minTicket();
    var held = holdCount(acct);
    var krHeld = 0;
    for (var hid in acct.holdings) if (acct.holdings[hid].market === 'KR') krHeld++;

    $('mr-result').innerHTML =
      '<div class="mr-rescard">' +
        '<div class="mr-restop"><span class="mr-grade g-' + g.g + '">' + g.g + '</span>' +
          '<div><div class="mr-restitle">' + g.t + '</div>' +
          '<div class="mr-ressym">국장·미장 통합장 · ' + esc(U.rangeText) + ' 마감</div></div>' +
        '</div>' +
        '<div class="mr-bigret ' + cls(myRet) + '">' + pct(myRet) + '<span>이번 판 수익률</span></div>' +
        '<div class="mr-vs">존버(내가 산 종목 동일 비중, 시초가→종가) ' + pct(bh.ret) +
          ' · <b class="' + cls(myRet - bh.ret) + '">' + (myRet - bh.ret >= 0 ? '+' : '') + (myRet - bh.ret).toFixed(2) + '%p</b></div>' +
        '<div class="mr-grid2">' +
          stat('시작 총 자산', won(S.startCash)) +
          stat('마감 총 자산', won(finalEq)) +
          stat('주문 가능 현금', won(acct.cash)) +
          stat('보유 평가', won(finalEq - acct.cash)) +
          stat('매매', S.trades.filter(function (t) { return t.side === 'B'; }).length + '매수 · ' + S.sells + '매도') +
          stat('승률', winRate == null ? '—' : winRate.toFixed(0) + '% (' + S.wins + '/' + S.sells + ')') +
          stat('수수료·세금', won(S.feesPaid)) +
          stat('최대 낙폭', pct(S.dd)) +
          stat('보유 종목', held + '종목 (🇰🇷 ' + krHeld + ' · 🇺🇸 ' + (held - krHeld) + ')') +
          stat('내 계좌', won(finalEq) + ' (' + pct(cumRet) + ')') +
        '</div>' +
        '<div class="mr-acctline">보유 ' + held + '종목은 <b>팔지 않았으므로 그대로 계좌에 남습니다</b>. 다음 통합 장에서도 이어서 거래할 수 있어요.</div>' +
        (busted ? '<div class="mr-bust on"><b>총 자산이 1주 값보다 적어요</b>' +
          '<span>이대로는 어떤 종목도 매수할 수 없습니다. 1,000만 원을 다시 지급받아 새로 시작할 수 있어요. (전적은 유지)</span>' +
          '<button type="button" id="r-bust-reset">1,000만 원으로 재출발</button></div>' : '') +
        '<div class="mr-actions3">' +
          '<button type="button" class="mr-ghost" id="r-again">같은 장 다시</button>' +
          '<button type="button" class="mr-ghost" id="r-other">다른 종목 보기</button>' +
          '<button type="button" class="mr-primary" id="r-next">포트폴리오 보기</button>' +
        '</div>' +
        '<button type="button" class="mr-share" id="r-share">결과 공유하기</button>' +
      '</div>';
    screen('result');
    var done = S;
    $('r-again').addEventListener('click', function () {
      pick.startAt = 0;
      var first = done.open[0] ? done.bySym[done.open[0]] : done.bySym[done.active] || U.symbols[0];
      startGame(first);
    });
    $('r-other').addEventListener('click', function () { paintAcct(); renderLobby(); screen('lobby'); });
    $('r-next').addEventListener('click', function () {
      pick.startAt = 0;
      startGame(done.open[0] ? done.bySym[done.open[0]] : U.symbols[0]);
      if (S) { S.view = 'pf'; S.pfFilter = 'hold'; renderBody(); }
    });
    var shareTxt = '[국장·미장 통합 트레이딩] ' + U.rangeText + ' ' + pct(myRet) + ' · 등급 ' + g.g +
      ' (존버 대비 ' + (myRet - bh.ret >= 0 ? '+' : '') + (myRet - bh.ret).toFixed(2) + '%p) · ' +
      holdCount(acct) + '종목 보유\n직접 거래해 보기 👉 https://ant-econ.github.io/market-replay.html';
    wireShare($('r-share'), shareTxt);
    var rb = $('r-bust-reset');
    if (rb) rb.addEventListener('click', function () { resetToSeed(); });
    paintAcct();
    window.scrollTo({ top: Math.max(0, $('mr-app').offsetTop - 70), behavior: 'smooth' });
  }

  function stat(k, v) { return '<div class="mr-stat"><span>' + k + '</span><b>' + v + '</b></div>'; }

  function resetToSeed() {
    var a = loadAcct();
    var msg = '계좌를 1,000만 원으로 다시 시작할까요?\n지금 현금(' + won(a.cash) + ')' +
      (holdCount(a) ? '과 보유 ' + holdCount(a) + '종목' : '') + '은 사라집니다.';
    if (!window.confirm(msg)) return;
    a.cash = baseCash();
    a.holdings = {};
    a.busts = (a.busts || 0) + 1;
    saveAcct(a);
    paintAcct();
    if (S) { screen('lobby'); S = null; }
    renderLobby();
    toast('1,000만 원을 다시 지급했어요 · 전적은 그대로');
  }

  /* ---------------- 초기화 ---------------- */
  function boot() {
    document.documentElement.setAttribute('data-mr', 'boot');
    K.theme(function () { drawChart(); });
    paintAcct();
    $('mr-q').addEventListener('input', function () {
      pick.q = this.value;
      renderSymbols();
    });
    $('mr-start').addEventListener('click', function () {
      if (U && pick.sym) startGame(pick.sym);
    });
    $('mr-reset').addEventListener('click', function () {
      if (!window.confirm('계좌 기록(현금·보유 종목·전적·최고 수익률)을 모두 초기화할까요? 첫 시드 1,000만 원부터 다시 시작합니다.')) return;
      try { localStorage.removeItem(ACCT_KEY); } catch (e) {}
      paintAcct();
      renderLobby();
      toast('계좌를 1,000만 원으로 초기화했어요');
    });
    $('mr-bust-reset').addEventListener('click', function () { resetToSeed(); });
    var v = new Date();
    var stamp = v.getUTCFullYear() + pad2(v.getUTCMonth() + 1) + pad2(v.getUTCDate()) + pad2(v.getUTCHours());
    fetch('data/market-replay.json?v=' + stamp, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        DATA = d;
        if (!DATA.sessions || !DATA.sessions.length) throw new Error('no sessions');
        KST = isFinite(DATA.kstOffset) ? DATA.kstOffset : 540;
        U = buildUnified();
        if (!U || !U.symbols.length) throw new Error('no symbols');
        document.documentElement.setAttribute('data-mr', 'ready');
        $('mr-loading').style.display = 'none';
        $('mr-lobby').classList.add('show');
        paintAcct();
        renderLobby();
      })
      .catch(function (e) {
        document.documentElement.setAttribute('data-mr', 'fetchfail:' + e.message);
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
    d.appendChild(b);
    d.appendChild(sp);
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

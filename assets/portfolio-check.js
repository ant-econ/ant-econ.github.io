/* 개미일지 계산기 — AI 포트폴리오 진단기 (서버·API 키 없이 브라우저에서만 동작) */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var el = function (id) { return document.getElementById(id); };

  var SECTOR = {
    IT:    { label: '정보기술',   color: '#2563eb' },
    COMM:  { label: '커뮤니케이션', color: '#0891b2' },
    CYC:   { label: '경기소비재', color: '#d97706' },
    CYD:   { label: '필수소비재', color: '#059669' },
    HLTH:  { label: '헬스케어',   color: '#db2777' },
    FIN:   { label: '금융',       color: '#7c3aed' },
    IND:   { label: '산업재',     color: '#64748b' },
    MAT:   { label: '소재',       color: '#ea580c' },
    ENR:   { label: '에너지',     color: '#ca8a04' },
    UTIL:  { label: '유틸리티',   color: '#0284c7' },
    RE:    { label: '부동산',     color: '#a855f7' },
    ETF:   { label: 'ETF·지수',   color: '#475569' },
    BOND:  { label: '채권',       color: '#94a3b8' },
    ETC:   { label: '기타',       color: '#94a3b8' }
  };

  var PRESETS = [
    {
      id: 'bigtech',
      icon: '🚀',
      name: '미장 빅테크 몰빵형',
      desc: '애플·엔비디아·MS 중심 6종목',
      items: [['AAPL', 25], ['MSFT', 20], ['NVDA', 25], ['GOOGL', 15], ['META', 10], ['AMZN', 5]]
    },
    {
      id: 'mix',
      icon: '⚖️',
      name: '국장+미장 배당·성장 혼합형',
      desc: '삼전·하이닉스 + 배당 ETF·코카콜라',
      items: [['005930', 20], ['000660', 10], ['005380', 5], ['105560', 5], ['AAPL', 15], ['MSFT', 15], ['SCHD', 15], ['KO', 5], ['JPM', 5], ['TLT', 5]]
    },
    {
      id: 'semi',
      icon: '🧠',
      name: '반도체 집중형',
      desc: '삼전·하이닉스·엔비디아·TSMC',
      items: [['005930', 30], ['000660', 25], ['NVDA', 20], ['TSM', 10], ['ASML', 5], ['AMD', 5], ['AVGO', 5]]
    }
  ];

  var state = {
    stocks: [], bySym: {}, holdings: [], mode: 'pct',
    fx: 1342.77, bm: null, asOf: '', lastReport: null
  };

  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[,\s%$원]/g, '')); return isFinite(n) ? n : 0; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pct(v, d) { return (v * 100).toFixed(d == null ? 1 : d) + '%'; }
  function pctx(v) { var n = Math.round(v * 1000) / 10; return (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + '%'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function won(v) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원'; }
  function num3(v, d) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d == null ? 1 : d); }

  /* ---------- data ---------- */
  function load() {
    fetch('data/portfolio-stocks.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        state.stocks = d.stocks || [];
        state.bySym = {};
        state.stocks.forEach(function (s) { state.bySym[s.sym] = s; });
        state.bm = d.benchmarks;
        state.fx = (d.fx && d.fx.USDKRW) || 1342.77;
        state.asOf = d.asOf || '';
        el('pcDataNote').textContent = '기준일 ' + state.asOf + ' · 수록 종목 ' + state.stocks.length + '개 · 환율 ' + num3(state.fx, 2) + '원/$';
        el('pcCount').textContent = state.stocks.length;
        wire();
        var fromUrl = readHash();
        if (fromUrl) { state.holdings = fromUrl; render(); run(); }
        else { restore(); render(); }
      })
      .catch(function (e) {
        el('pcDataNote').innerHTML = '<span class="warn">데이터를 불러오지 못했습니다 (' + esc(e.message) + '). 잠시 후 새로고침해 주세요.</span>';
      });
  }

  function stockByCode(code) {
    if (state.bySym[code]) return state.bySym[code];
    return null;
  }

  /* ---------- holdings model ---------- */
  // holding: {code, name, market, sector, theme, per, pbr, psr, div, beta, raw, unit, custom}
  function makeHolding(code, weight) {
    var s = stockByCode(code);
    if (!s) return null;
    var h = {
      code: s.sym, name: s.name, market: s.market, sector: s.sector, theme: s.theme,
      per: s.per, pbr: s.pbr, psr: s.psr, div: s.div, beta: s.beta, custom: false,
      raw: weight == null ? 10 : weight, unit: 'pct'
    };
    return h;
  }

  function existing(code) {
    for (var i = 0; i < state.holdings.length; i++) if (state.holdings[i].code === code) return i;
    return -1;
  }

  function defaultAmt(unit) {
    var base = moneyTotal() > 0 ? moneyTotal() : 10000000;
    var amt = base * 0.1;
    return Math.max(1, Math.round(unit === 'usd' ? amt / state.fx : amt / 10000));
  }

  function addStock(code, weight) {
    var s = stockByCode(code);
    if (!s) return;
    var i = existing(code);
    if (i >= 0) {
      var cur = state.holdings[i];
      if (state.mode === 'money') cur.raw = num(cur.raw) + defaultAmt(cur.unit);
      else cur.raw = Math.min(100, num(cur.raw) + (weight == null ? 10 : weight));
    } else {
      var h = makeHolding(code, weight);
      if (state.mode === 'money') { h.unit = (s.market === 'US' ? 'usd' : 'krw'); h.raw = defaultAmt(h.unit); }
      state.holdings.push(h);
    }
    clearSearch();
    render();
  }

  function removeHolding(i) {
    state.holdings.splice(i, 1);
    render();
  }

  // weights (sum 1)
  function weights() {
    var vals = state.holdings.map(function (h) {
      var r = num(h.raw);
      if (state.mode === 'pct' || h.unit === 'pct') return r;
      if (h.unit === 'usd') return r * state.fx;
      return r * 10000; // 만원
    });
    var sum = vals.reduce(function (a, b) { return a + b; }, 0);
    if (!(sum > 0)) return vals.map(function () { return 0; });
    return vals.map(function (v) { return v / sum; });
  }

  function moneyTotal() {
    var t = 0;
    state.holdings.forEach(function (h) {
      var r = num(h.raw);
      t += h.unit === 'usd' ? r * state.fx : (h.unit === 'pct' ? 0 : r * 10000);
    });
    return t;
  }

  /* ---------- rendering: holdings ---------- */
  function render() {
    var box = el('pcHoldings');
    var w = weights();
    if (!state.holdings.length) {
      box.innerHTML = '<div class="empty">아직 담은 종목이 없습니다. 위에서 검색하거나 <b>빠른 체험 프리셋</b>을 눌러 보세요.</div>';
    } else {
      box.innerHTML = state.holdings.map(function (h, i) {
        var sec = SECTOR[h.sector] || SECTOR.ETC;
        var badge = h.market === 'KR' ? '<span class="mkt kr">국내</span>' : (h.market === 'US' ? '<span class="mkt us">미국</span>' : '<span class="mkt etc">직접</span>');
        var unitSel = '';
        if (state.mode === 'pct') {
          unitSel = '<span class="unit">%</span>';
        } else {
          unitSel = '<select class="cur" data-i="' + i + '">' +
            '<option value="krw"' + (h.unit === 'krw' ? ' selected' : '') + '>만원</option>' +
            '<option value="usd"' + (h.unit === 'usd' ? ' selected' : '') + '>$</option></select>';
        }
        var secLabel = h.custom ? '직접 입력' : (SECTOR[h.sector] ? SECTOR[h.sector].label : '기타');
        var sub = secLabel + (h.theme && h.theme !== '기타' && h.theme !== secLabel ? ' · ' + h.theme : '');
        return '<div class="hrow" data-i="' + i + '">' +
          '<div class="hinfo">' + badge + '<b>' + esc(h.name) + '</b>' +
          '<span class="tick">' + esc(h.code) + '</span>' +
          '<span class="sec">' + esc(sub) + '</span></div>' +
          '<div class="hinput"><input class="w" type="text" inputmode="decimal" data-i="' + i + '" value="' + esc(h.raw) + '" aria-label="' + esc(h.name) + ' 비중 또는 금액">' + unitSel +
          '<span class="share">' + (w[i] ? pct(w[i]) : '0%') + '</span></div>' +
          '<button class="del" data-i="' + i + '" aria-label="' + esc(h.name) + ' 삭제">✕</button>' +
          '</div>';
      }).join('');
    }

    var totalTxt, warn = '';
    if (state.mode === 'pct') {
      var s = state.holdings.reduce(function (a, h) { return a + num(h.raw); }, 0);
      totalTxt = num3(s, 1) + '%';
      if (state.holdings.length && Math.abs(s - 100) > 0.05) warn = '<span class="warn">합계 ' + num3(s, 1) + '% → 진단 시 100%로 자동 환산합니다</span>';
    } else {
      totalTxt = won(moneyTotal());
    }
    el('pcTotal').innerHTML = '<span>총 ' + state.holdings.length + '종목</span><b>' + totalTxt + '</b>' + warn;
    el('pcRun').disabled = !state.holdings.length;
    save();
    if (!el('pcReport').hidden && state.holdings.length) queueRerun();
  }

  /* ---------- search ---------- */
  var aliasMap = {
    '삼전': '005930', '하이닉스': '000660', '닉스': '000660', '엔비': 'NVDA', '테슬': 'TSLA',
    '구글': 'GOOGL', '알파벳': 'GOOGL', '마소': 'MSFT', '애플': 'AAPL', '아마존': 'AMZN',
    '메타': 'META', '브로드컴': 'AVGO', '티에스엠씨': 'TSM', '코카콜라': 'KO', '제이피': 'JPM'
  };

  function search(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return [];
    var key = null;
    Object.keys(aliasMap).some(function (a) { if (q.indexOf(a) >= 0) { key = aliasMap[a]; return true; } return false; });
    var out = state.stocks.filter(function (s) {
      return (s.name || '').toLowerCase().indexOf(q) >= 0 ||
        (s.sym || '').toLowerCase().indexOf(q) >= 0 ||
        (s.ticker || '').toLowerCase().indexOf(q) >= 0 ||
        (key && s.sym === key);
    });
    out.sort(function (a, b) {
      var an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
      var ai = an.indexOf(q) === 0 ? 0 : (an.indexOf(q) > 0 ? 1 : 2);
      var bi = bn.indexOf(q) === 0 ? 0 : (bn.indexOf(q) > 0 ? 1 : 2);
      if (ai !== bi) return ai - bi;
      return an.length - bn.length;
    });
    return out.slice(0, 8);
  }

  function showResults(q) {
    var box = el('pcResults');
    if (!q.trim()) { box.innerHTML = ''; box.classList.remove('open'); return; }
    var res = search(q);
    if (!res.length) {
      box.innerHTML = '<div class="nores">검색 결과가 없습니다. <button type="button" class="linkbtn" id="pcGoCustom">직접 입력으로 추가 →</button></div>';
      box.classList.add('open');
      var b = el('pcGoCustom');
      if (b) b.onclick = function () { openCustom(q); };
      return;
    }
    box.innerHTML = res.map(function (s) {
      var sec = SECTOR[s.sector] || SECTOR.ETC;
      return '<button type="button" class="sres" data-code="' + esc(s.sym) + '">' +
        '<span class="mkt ' + (s.market === 'KR' ? 'kr' : 'us') + '">' + (s.market === 'KR' ? '국내' : '미국') + '</span>' +
        '<b>' + esc(s.name) + '</b><span class="tick">' + esc(s.sym) + '</span>' +
        '<span class="sec">' + sec.label + (s.theme && s.theme !== '기타' ? ' · ' + s.theme : '') + '</span>' +
        '<span class="pers">' + (s.per ? 'PER ' + num3(s.per) : 'PER —') + '</span></button>';
    }).join('') + '<div class="sres hint">＋ 목록에 없으면 <button type="button" class="linkbtn" id="pcGoCustom2">직접 입력</button></div>';
    box.classList.add('open');
    var b2 = el('pcGoCustom2');
    if (b2) b2.onclick = function () { openCustom(q); };
  }

  function clearSearch() {
    el('pcSearch').value = '';
    el('pcResults').innerHTML = '';
    el('pcResults').classList.remove('open');
  }

  /* ---------- custom stock ---------- */
  function openCustom(q) {
    var box = el('pcCustom');
    box.hidden = false;
    el('pcCustomName').value = q || '';
    el('pcCustomName').focus();
    el('pcResults').classList.remove('open');
  }

  function addCustom() {
    var name = el('pcCustomName').value.trim();
    if (!name) { el('pcCustomName').focus(); return; }
    var market = el('pcCustomMarket').value;
    var sector = el('pcCustomSector').value;
    var h = {
      code: 'C' + (state.holdings.length + 1) + '-' + name.slice(0, 6),
      name: name, market: market, sector: sector, theme: '직접 입력',
      per: num(el('pcCustomPer').value) || null,
      pbr: num(el('pcCustomPbr').value) || null,
      psr: num(el('pcCustomPsr').value) || null,
      div: num(el('pcCustomDiv').value) || null,
      beta: null, custom: true, raw: 10, unit: 'pct'
    };
    if (state.mode === 'money') { h.unit = (market === 'US' ? 'usd' : 'krw'); h.raw = defaultAmt(h.unit); }
    state.holdings.push(h);
    ['pcCustomName', 'pcCustomPer', 'pcCustomPbr', 'pcCustomPsr', 'pcCustomDiv'].forEach(function (id) { el(id).value = ''; });
    el('pcCustom').hidden = true;
    clearSearch();
    render();
  }

  /* ---------- diagnosis ---------- */
  function gradeOf(p) {
    if (p == null) return { key: 'na', label: '판단불가', cls: 'na' };
    if (p <= -0.25) return { key: 'low', label: '저평가', cls: 'low' };
    if (p <= 0.15) return { key: 'fair', label: '적정', cls: 'fair' };
    if (p <= 0.5) return { key: 'high', label: '다소 고평가', cls: 'high' };
    return { key: 'hot', label: '과열', cls: 'hot' };
  }

  function diagnose() {
    var w = weights();
    var H = state.holdings.map(function (h, i) { return { h: h, w: w[i] }; }).filter(function (x) { return x.w > 0; });
    if (!H.length) return null;

    var n = H.length;
    var hhi = H.reduce(function (a, x) { return a + x.w * x.w; }, 0);
    var effN = hhi > 0 ? 1 / hhi : 0;

    var sorted = H.slice().sort(function (a, b) { return b.w - a.w; });
    function sumTop(k) { return sorted.slice(0, k).reduce(function (a, x) { return a + x.w; }, 0); }

    var krW = H.filter(function (x) { return x.h.market === 'KR'; }).reduce(function (a, x) { return a + x.w; }, 0);
    var usW = H.filter(function (x) { return x.h.market === 'US'; }).reduce(function (a, x) { return a + x.w; }, 0);

    // sectors & themes
    var secW = {}, thW = {};
    H.forEach(function (x) {
      var s = x.h.sector || 'ETC';
      secW[s] = (secW[s] || 0) + x.w;
      var t = x.h.theme || '기타';
      thW[t] = (thW[t] || 0) + x.w;
    });
    var secList = Object.keys(secW).map(function (k) {
      return { key: k, label: (SECTOR[k] || SECTOR.ETC).label, color: (SECTOR[k] || SECTOR.ETC).color, w: secW[k] };
    }).sort(function (a, b) { return b.w - a.w; });
    var thList = Object.keys(thW).map(function (k) { return { key: k, w: thW[k] }; }).sort(function (a, b) { return b.w - a.w; });

    // valuation (weighted, renormalised by coverage)
    // 조화평균(총 투자금 ÷ 총 이익) — 시장 지수 PER·PBR·PSR 집계와 같은 방식
    function wavg(key) {
      var inv = 0, c = 0;
      H.forEach(function (x) { var v = x.h[key]; if (v != null && isFinite(v) && v > 0) { inv += x.w / v; c += x.w; } });
      return (c > 0 && inv > 0) ? { v: 1 / inv, cov: c } : { v: null, cov: 0 };
    }
    var mPer = wavg('per'), mPbr = wavg('pbr'), mPsr = wavg('psr');
    var regionSum = (krW + usW) || 1;
    var bk = state.bm || { KR: {}, US: {} };
    function blend(key) {
      var kr = (bk.KR && bk.KR[key]) || null, us = (bk.US && bk.US[key]) || null;
      if (kr == null && us == null) return null;
      if (kr == null) return us;
      if (us == null) return kr;
      return (kr * krW + us * usW) / regionSum;
    }
    var bPer = blend('per'), bPbr = blend('pbr'), bPsr = blend('psr');
    var metrics = [
      { key: 'per', label: 'PER', unit: '배', mine: mPer.v, cov: mPer.cov, bench: bPer },
      { key: 'pbr', label: 'PBR', unit: '배', mine: mPbr.v, cov: mPbr.cov, bench: bPbr },
      { key: 'psr', label: 'PSR', unit: '배', mine: mPsr.v, cov: mPsr.cov, bench: bPsr }
    ].map(function (m) {
      m.premium = (m.mine != null && m.bench) ? (m.mine / m.bench - 1) : null;
      m.grade = gradeOf(m.premium);
      return m;
    });
    var withP = metrics.filter(function (m) { return m.premium != null; });
    var avgPrem = withP.length ? withP.reduce(function (a, m) { return a + m.premium; }, 0) / withP.length : null;
    var valGrade = gradeOf(avgPrem);

    // dividend / beta
    var divW = H.reduce(function (a, x) { return a + x.w * (x.h.div || 0); }, 0); // 단위: % (예: 2.5 = 2.5%)
    var betaS = 0, betaC = 0;
    H.forEach(function (x) { if (x.h.beta != null) { betaS += x.w * x.h.beta; betaC += x.w; } });
    var betaW = betaC > 0 ? betaS / betaC : null;
    var betaLabel = betaW == null ? '—' : (betaW < 0.8 ? '저변동' : betaW < 1.2 ? '시장 평균' : betaW < 1.8 ? '고변동' : '초고변동');

    // sector balance (ETF·채권 제외)
    var coreSec = secList.filter(function (s) { return s.key !== 'ETF' && s.key !== 'BOND'; });
    var topSec = coreSec[0] || secList[0];
    var defensive = ['CYD', 'HLTH', 'UTIL', 'BOND'].reduce(function (a, k) { return a + (secW[k] || 0); }, 0);
    var etfW = (secW['ETF'] || 0) + (secW['BOND'] || 0);
    var topTheme = thList[0];

    // ---- score ----
    var dScore = clamp((effN - 1) / 9, 0, 1) * 100;
    if (sumTop(1) > 0.5) dScore *= 0.65;
    else if (sumTop(1) > 0.4) dScore *= 0.85;
    if (n <= 2) dScore = Math.min(dScore, 35);
    var vScore = avgPrem == null ? 50 : clamp(50 - 55 * avgPrem, 0, 100);
    var topShare = topSec ? topSec.w : 1;
    var bScore = clamp(100 - Math.max(0, topShare - 0.25) * 150, 10, 100);
    if (krW > 0.99 || usW > 0.99) bScore -= 8;
    if (defensive >= 0.15) bScore = Math.min(100, bScore + 8);
    bScore = clamp(bScore, 0, 100);
    var total = Math.round(0.4 * dScore + 0.35 * vScore + 0.25 * bScore);

    // ---- personality ----
    var itW = (secW['IT'] || 0) + (secW['COMM'] || 0);
    var techTheme = ['반도체', 'AI반도체', '파운드리', '반도체장비', 'IT하드웨어', '소프트웨어', 'AI인프라', '플랫폼'];
    var techThemeW = thList.filter(function (t) { return techTheme.indexOf(t.key) >= 0; }).reduce(function (a, t) { return a + t.w; }, 0);
    var chipW = thList.filter(function (t) { return ['반도체', 'AI반도체', '파운드리', '반도체장비'].indexOf(t.key) >= 0; }).reduce(function (a, t) { return a + t.w; }, 0);
    var regionWord = usW >= 0.65 ? '미국 ' : (krW >= 0.65 ? '국장 ' : '국장+미장 ');
    var p;
    if (etfW >= 0.6) p = { name: '지수·패시브 코어형', desc: 'ETF·지수 상품이 절반 이상입니다. 개별 종목 리스크는 낮지만, 지수 전체가 빠지면 같이 빠집니다.' };
    else if (chipW >= 0.55) p = { name: regionWord + '반도체 집중형', desc: '반도체·장비 테마가 절반 이상입니다. 메모리 업황과 AI 설비투자 사이클이 수익률을 거의 전부 결정하는 구조입니다.' };
    else if (itW >= 0.6 && techThemeW >= 0.45) p = { name: regionWord + '기술주 성장형', desc: '정보기술·플랫폼이 대부분입니다. 성장 기대가 큰 만큼 금리와 실적 전망에 민감하게 반응합니다.' };
    else if (divW >= 2.5 && (betaW || 1) < 1.1) p = { name: regionWord + '배당·방어형', desc: '배당수익률이 높고 변동성이 낮은 구성입니다. 지수 하락기에 상대적으로 버티며 현금 흐름을 만듭니다.' };
    else if (sumTop(1) >= 0.4) p = { name: '한 종목 의존형', desc: '상위 한 종목이 포트폴리오의 절반 가까이를 차지합니다. 그 종목의 실적·악재가 전체 수익률을 좌우합니다.' };
    else if (effN >= 7 && topShare < 0.32 && (betaW || 1) <= 1.2) p = { name: '분산형 코어 포트폴리오', desc: '종목 수와 섹터가 고르게 퍼져 있고 변동성도 시장 수준입니다. 오래 들고 가기 좋은 구조입니다.' };
    else p = { name: '균형 성장형', desc: '성장주와 방어주, 국내와 미국이 섞여 있습니다. 어느 한쪽으로 크게 치우치지 않은 중간 성격입니다.' };

    // ---- 3-line AI-style comments ----
    var c = [];
    c.push('종합 ' + total + '점 · ' + p.name + '. 실질 분산 종목 수는 ' + num3(effN) + '개로, 담은 ' + n + '종목보다 ' +
      (effN < n * 0.6 ? '적습니다(비중이 한쪽에 몰려 있음).' : '비슷합니다.'));
    if (avgPrem != null) {
      c.push('시장 대비 밸류에이션은 ' + (avgPrem > 0 ? '+' : '') + pct(avgPrem) + '로 ' + valGrade.label + ' 구간입니다. ' +
        (avgPrem > 0.5 ? '성장 기대가 이미 가격에 많이 반영돼 있어 실적이 어긋나면 조정 폭이 커질 수 있습니다.'
          : avgPrem > 0.15 ? '시장 평균보다 조금 비쌉니다. 이익 성장이 뒷받침되는지 확인하세요.'
          : avgPrem <= -0.25 ? '시장 평균보다 싸게 거래되고 있습니다. 다만 싼 데는 이유가 있는지(이익 감소·업황) 확인하세요.'
          : '시장 평균과 거의 같은 수준입니다. 밸류에이션 부담은 크지 않습니다.'));
    } else {
      c.push('밸류에이션 지표가 있는 종목이 적어 시장 비교는 생략했습니다. PER·PBR을 직접 입력하면 비교가 됩니다.');
    }
    c.push('가장 큰 비중은 ' + (topSec ? topSec.label + ' ' + pct(topSec.w) : '—') +
      (topTheme ? ' · 테마로는 ' + topTheme.key + ' ' + pct(topTheme.w) : '') +
      '. ' + (defensive < 0.1 ? '방어 섹터(필수소비재·헬스케어·유틸리티) 비중이 거의 없어 하락장에서 낙폭이 커질 수 있습니다.' : '방어 자산 ' + pct(defensive) + '를 갖추고 있어 하락장 완충이 일부 있습니다.'));

    // ---- warnings & suggestions ----
    var warn = [];
    if (sumTop(1) >= 0.4) warn.push({ t: '단일 종목 집중', d: sorted[0].h.name + ' 한 종목이 ' + pct(sumTop(1)) + '입니다. 보통 한 종목은 20~25% 이하로 두는 것이 안전합니다.' });
    if (topSec && topSec.w >= 0.45 && topSec.key !== 'ETF') warn.push({ t: '섹터 쏠림', d: topSec.label + ' 섹터가 ' + pct(topSec.w) + '입니다. 같은 업황을 공유해 함께 움직일 가능성이 큽니다.' });
    if (topTheme && topTheme.w >= 0.45) warn.push({ t: '테마 중복', d: topTheme.key + ' 테마가 ' + pct(topTheme.w) + '입니다. 종목 수가 많아도 같은 재료로 같이 흔들립니다.' });
    if (krW >= 0.85) warn.push({ t: '국내 단일 시장', d: '국내 비중 ' + pct(krW) + '. 원화 자산만 있으면 환율·정책 리스크를 분산할 수 없습니다.' });
    if (usW >= 0.85) warn.push({ t: '해외 단일 시장', d: '미국 비중 ' + pct(usW) + '. 달러 자산만 있으면 환율 하락 시 원화 평가액이 줄어듭니다.' });
    if ((betaW || 0) >= 1.5) warn.push({ t: '변동성 높음', d: '가중 베타 ' + num3(betaW, 2) + '. 시장이 10% 빠지면 이 포트폴리오는 그보다 더 크게 흔들릴 수 있습니다.' });
    if ((secW['IT'] || 0) >= 0.5) warn.push({ t: '기술주 편중', d: '정보기술 비중 ' + pct(secW['IT']) + '. 금리 상승 국면에서 가장 먼저 조정을 받는 영역입니다.' });

    var gaps = [];
    [['CYD', '필수소비재'], ['HLTH', '헬스케어'], ['UTIL', '유틸리티'], ['BOND', '채권·금리']].forEach(function (g) {
      if ((secW[g[0]] || 0) < 0.05) gaps.push(g[1]);
    });
    if ((secW['FIN'] || 0) < 0.05 && krW > 0.3) gaps.push('금융');

    return {
      n: n, hhi: hhi, effN: effN, top1: sumTop(1), top3: sumTop(3), sorted: sorted,
      krW: krW, usW: usW, secList: secList, thList: thList, topSec: topSec, topTheme: topTheme,
      metrics: metrics, avgPrem: avgPrem, valGrade: valGrade,
      divW: divW, betaW: betaW, betaLabel: betaLabel, defensive: defensive, etfW: etfW,
      scores: { total: total, d: Math.round(dScore), v: Math.round(vScore), b: Math.round(bScore) },
      personality: p, comments: c, warns: warn, gaps: gaps, techThemeW: techThemeW, itW: itW
    };
  }

  function run(scroll) { var r = diagnose(); if (r) renderReport(r, scroll); }
  var rerunTimer = null;
  function queueRerun() {
    clearTimeout(rerunTimer);
    rerunTimer = setTimeout(function () { var r = diagnose(); if (r) renderReport(r, false); }, 280);
  }

  /* ---------- report rendering ---------- */
  function gaugeSvg(score) {
    var r = 68, c = 2 * Math.PI * r, off = c * (1 - clamp(score, 0, 100) / 100);
    var band = score >= 70 ? ['#10b981', '#047857'] : score >= 55 ? ['#3b82f6', '#1d4ed8'] : score >= 40 ? ['#f59e0b', '#d97706'] : ['#f43f5e', '#be123c'];
    return '<svg class="gauge" viewBox="0 0 160 160" role="img" aria-label="종합 점수 ' + score + '점">' +
      '<defs><linearGradient id="pcGaugeGrad" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + band[0] + '"/><stop offset="1" stop-color="' + band[1] + '"/></linearGradient></defs>' +
      '<circle cx="80" cy="80" r="68" fill="none" stroke="var(--card-2)" stroke-width="14"/>' +
      '<circle cx="80" cy="80" r="68" fill="none" stroke="url(#pcGaugeGrad)" stroke-width="14" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 80 80)"/>' +
      '<text x="80" y="88" text-anchor="middle" class="gscore">' + score + '</text>' +
      '<text x="80" y="108" text-anchor="middle" class="gcap">/ 100점</text></svg>';
  }

  function donutSvg(items, size) {
    var r = 54, cx = 64, cy = 64, c = 2 * Math.PI * r, off = 0;
    var parts = items.map(function (it) {
      var frac = it.w;
      var seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + it.color + '" stroke-width="20" ' +
        'stroke-dasharray="' + (c * frac).toFixed(2) + ' ' + (c * (1 - frac)).toFixed(2) + '" ' +
        'stroke-dashoffset="' + (-c * off).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      off += frac;
      return seg;
    }).join('');
    return '<svg class="donut" viewBox="0 0 128 128" role="img" aria-label="섹터 비중 도넛 차트">' +
      '<circle cx="64" cy="64" r="54" fill="none" stroke="var(--line)" stroke-width="20" opacity=".45"/>' + parts + '</svg>';
  }

  function vbar(m) {
    if (m.mine == null || !m.bench) {
      return '<div class="vbar empty"><span>데이터 없음</span></div>';
    }
    var ratio = m.mine / m.bench;                 // 1 = 시장
    var left = clamp(ratio / 2 * 100, 1.5, 98.5); // 2배 = 100%
    var zone = m.grade.cls;
    return '<div class="vbar ' + zone + '">' +
      '<div class="ztrack"><i class="z low" style="width:37.5%"></i><i class="z fair" style="width:20%"></i><i class="z high" style="width:17.5%"></i><i class="z hot" style="width:25%"></i></div>' +
      '<b class="bmk" style="left:50%"></b><i class="mark" style="left:' + left.toFixed(1) + '%"></i></div>' +
      '<div class="vscale"><span>싸다</span><span>시장 평균</span><span>비싸다</span></div>';
  }

  function renderReport(r, scroll) {
    var valRows = r.metrics.map(function (m) {
      var val = m.mine == null ? '—' : num3(m.mine) + m.unit;
      var bench = m.bench == null ? '—' : num3(m.bench) + m.unit;
      return '<div class="vrow">' +
        '<div class="vhead"><span class="vlab">' + m.label + '</span><b>' + val + '</b>' +
        '<span class="vs">시장 ' + bench + (m.premium != null ? ' · ' + (m.premium > 0 ? '+' : '') + pct(m.premium) : '') + '</span>' +
        '<span class="chip ' + m.grade.cls + '">' + m.grade.label + '</span></div>' + vbar(m) +
        (m.cov < 0.95 ? '<div class="vnote">비중의 ' + pct(m.cov) + '만 반영(지표 없는 종목 제외)</div>' : '') +
        '</div>';
    }).join('');

    var secRows = r.secList.map(function (s) {
      return '<li><i style="background:' + s.color + '"></i><span class="nm">' + esc(s.label) + '</span>' +
        '<span class="bw"><b style="width:' + clamp(s.w * 100, 1, 100).toFixed(1) + '%;background:' + s.color + '"></b></span>' +
        '<span class="pctv">' + pct(s.w) + '</span></li>';
    }).join('');

    var themeChips = r.thList.slice(0, 7).map(function (t) {
      return '<span class="tchip">' + esc(t.key) + ' <b>' + pct(t.w) + '</b></span>';
    }).join('');

    var warnHtml = r.warns.length ? r.warns.map(function (w) {
      return '<li><b>' + esc(w.t) + '</b> ' + esc(w.d) + '</li>';
    }).join('') : '<li class="ok">눈에 띄는 쏠림은 없습니다. 지금 구성을 유지해도 좋습니다.</li>';

    var gapHtml = r.gaps.length
      ? '<p class="suggest"><b>보완하면 좋은 영역</b> ' + r.gaps.map(esc).join(' · ') + ' — 각 5~10%만 채워도 하락장 방어력이 달라집니다.</p>'
      : '<p class="suggest ok"><b>보완할 영역이 거의 없습니다.</b> 방어 섹터와 채권까지 갖춘 구성입니다.</p>';

    var topNames = r.sorted.slice(0, 3).map(function (x, i) {
      return (i + 1) + '. ' + esc(x.h.name) + ' ' + pct(x.w);
    }).join(' · ');

    // ---- 1초에 읽히는 핵심 결론 ----
    var bandKey = r.scores.total >= 70 ? 'good' : r.scores.total >= 55 ? 'mid' : r.scores.total >= 40 ? 'warn' : 'bad';
    var bandTxt = { good: '양호', mid: '보통', warn: '주의', bad: '취약' }[bandKey];
    var hhiPts = r.hhi * 10000;
    var disp = hhiPts < 1000 ? { t: '매우 분산', c: 'good' }
      : hhiPts < 1500 ? { t: '분산 양호', c: 'good' }
      : hhiPts < 2500 ? { t: '분산 보통', c: 'mid' }
      : hhiPts < 4000 ? { t: '분산 집중', c: 'warn' }
      : { t: '매우 집중', c: 'bad' };
    var valCls = r.valGrade.key === 'low' ? 'good' : r.valGrade.key === 'fair' ? 'mid'
      : r.valGrade.key === 'high' ? 'warn' : r.valGrade.key === 'hot' ? 'bad' : 'mid';
    var premTxt = r.avgPrem == null ? '—'
      : (Math.abs(r.avgPrem) < 0.005 ? '시장 평균 수준' : '시장 대비 ' + (r.avgPrem > 0 ? '+' : '−') + pct(Math.abs(r.avgPrem)));
    var valMain = r.avgPrem == null ? '밸류에이션 판단 불가' : premTxt + ' ' + r.valGrade.label;
    var valSub = r.metrics.filter(function (m) { return m.mine != null; })
      .map(function (m) { return m.label + ' ' + num3(m.mine) + m.unit; }).join(' · ') || 'PER·PBR이 있는 종목이 적습니다';
    var coreSecs = r.secList.filter(function (s) { return s.key !== 'ETF' && s.key !== 'BOND'; });
    var secTop3 = coreSecs.slice(0, 3).reduce(function (a, s) { return a + s.w; }, 0);
    var topW = r.topSec ? r.topSec.w : 0;
    var secCls = topW >= 0.6 ? 'bad' : topW >= 0.45 ? 'warn' : topW >= 0.3 ? 'mid' : 'good';
    var secWord = topW >= 0.6 ? '집중' : topW >= 0.45 ? '쏠림' : topW >= 0.3 ? '편중' : '고른 편';
    var secMain = r.topSec ? r.topSec.label + ' ' + pctx(topW) + ' ' + secWord : '섹터 정보 없음';
    var secSub = '상위 3개 섹터 ' + pctx(secTop3) + ' · 방어 자산 ' + pctx(r.defensive);
    var betaCls = r.betaW == null ? 'mid' : r.betaW < 0.8 ? 'good' : r.betaW < 1.2 ? 'mid' : r.betaW < 1.8 ? 'warn' : 'bad';
    var divMain = '배당 ' + num3(r.divW, 2) + '% · 변동성 ' + r.betaLabel;
    var divSub = '가중 베타 ' + (r.betaW == null ? '—' : num3(r.betaW, 2)) + ' · 방어 자산 ' + pctx(r.defensive);
    function scoreBar(label, v) {
      return '<div><span>' + label + '</span><b>' + v + '</b><i><u style="width:' + clamp(v, 0, 100) + '%"></u></i></div>';
    }

    var html =
      '<div class="card rep-card scorecard">' +
      '<div class="score-left"><div class="gaugewrap">' + gaugeSvg(r.scores.total) + '</div>' +
      '<div class="score-chip ' + bandKey + '">종합 ' + bandTxt + '</div></div>' +
      '<div class="score-right">' +
      '<div class="kicker">AI 진단 리포트</div>' +
      '<h2 class="pname"><span class="ptype">' + esc(r.personality.name) + '</span></h2>' +
      '<p class="pdesc">' + esc(r.personality.desc) + '</p>' +
      '<div class="summary"><div class="sumhead">3줄 요약</div><ul class="c3">' +
      r.comments.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="score-parts">' +
      scoreBar('분산 점수', r.scores.d) + scoreBar('밸류에이션', r.scores.v) + scoreBar('섹터 균형', r.scores.b) +
      '</div>' +
      '</div></div>' +

      '<div class="rep-grid">' +
      '<section class="card rep-card">' +
      '<h3><span class="h3badge">1</span>분산효과</h3>' +
      '<div class="keyline ' + disp.c + '"><b>' + disp.t + '</b><span>실질 ' + num3(r.effN) + '종목 · 상위 1종목 ' + pctx(r.top1) + '</span></div>' +
      '<div class="statgrid">' +
      '<div><span>종목 수</span><b>' + r.n + '개</b></div>' +
      '<div><span>실질 분산 종목 수</span><b>' + num3(r.effN) + '개</b></div>' +
      '<div><span>상위 1종목</span><b>' + pct(r.top1) + '</b></div>' +
      '<div><span>상위 3종목</span><b>' + pct(r.top3) + '</b></div>' +
      '<div><span>HHI 지수</span><b>' + Math.round(hhiPts).toLocaleString('ko-KR') + '</b></div>' +
      '<div><span>분산 등급</span><b class="' + (r.hhi < 0.15 ? 'good' : r.hhi < 0.25 ? 'mid' : 'bad') + '">' +
      (r.hhi < 0.10 ? '매우 분산' : r.hhi < 0.15 ? '양호' : r.hhi < 0.25 ? '보통' : r.hhi < 0.4 ? '집중' : '매우 집중') + '</b></div>' +
      '</div>' +
      '<div class="minihead">상위 종목</div><p class="miniline">' + topNames + '</p>' +
      '<div class="minihead">지역 비중</div>' +
      '<div class="regionbar"><i class="kr" style="width:' + (r.krW * 100).toFixed(1) + '%"></i><i class="us" style="width:' + (r.usW * 100).toFixed(1) + '%"></i></div>' +
      '<div class="regionlegend"><span><i class="kr"></i>국내 ' + pct(r.krW) + '</span><span><i class="us"></i>미국 ' + pct(r.usW) + '</span></div>' +
      '<div class="minihead">테마 노출</div><div class="tchips">' + themeChips + '</div>' +
      '<p class="miniline muted">허핀달 지수(HHI)는 비중을 제곱해 더한 값입니다. 1종목 100%면 10,000, 10종목 10%씩이면 1,000입니다. 숫자가 작을수록 분산이 잘 된 것입니다.</p>' +
      '</section>' +

      '<section class="card rep-card">' +
      '<h3><span class="h3badge">2</span>밸류에이션<span class="h3sub">시장 평균 대비</span></h3>' +
      '<div class="keyline ' + valCls + '"><b>' + valMain + '</b><span>' + valSub + '</span></div>' +
      valRows +
      '<p class="miniline muted">가중평균은 각 종목의 PER·PBR·PSR을 조화평균(총 투자금 ÷ 총 이익·순자산·매출)으로 합친 값입니다. 비교 기준은 국내·미국 비중으로 섞은 시장 평균(코스피 ' + num3(state.bm.KR.per, 2) + '배 · S&amp;P500 ' + num3(state.bm.US.per, 1) + '배)입니다.</p>' +
      '</section>' +

      '<section class="card rep-card wide">' +
      '<h3><span class="h3badge">3</span>섹터 치중도</h3>' +
      '<div class="keyline ' + secCls + '"><b>' + secMain + '</b><span>' + secSub + '</span></div>' +
      '<div class="secwrap"><div class="donutwrap">' + donutSvg(r.secList) +
      '<div class="donutc"><b>' + (r.topSec ? pct(r.topSec.w) : '—') + '</b><span>' + (r.topSec ? esc(r.topSec.label) : '') + '</span></div></div>' +
      '<ul class="seclist">' + secRows + '</ul></div>' +
      (r.etfW > 0 ? '<p class="miniline muted">ETF·채권 ' + pct(r.etfW) + '는 섹터가 분산된 상품이라 쏠림 계산에서 별도로 표시했습니다.</p>' : '') +
      '<div class="warnbox"><div class="minihead">경고 · 체크</div><ul>' + warnHtml + '</ul></div>' +
      gapHtml +
      '</section>' +

      '<section class="card rep-card wide">' +
      '<h3><span class="h3badge">4</span>배당과 변동성</h3>' +
      '<div class="keyline ' + betaCls + '"><b>' + divMain + '</b><span>' + divSub + '</span></div>' +
      '<div class="statgrid four">' +
      '<div><span>가중 배당수익률</span><b>' + num3(r.divW, 2) + '%</b></div>' +
      '<div><span>가중 베타</span><b>' + (r.betaW == null ? '—' : num3(r.betaW, 2)) + '</b></div>' +
      '<div><span>변동성 그룹</span><b>' + r.betaLabel + '</b></div>' +
      '<div><span>방어 자산 비중</span><b>' + pct(r.defensive) + '</b></div>' +
      '</div>' +
      '<p class="miniline muted">배당수익률은 연 100만 원 투자 시 세전 ' + Math.round(r.divW / 100 * 1000000).toLocaleString('ko-KR') + '원 수준입니다(세금·환전 비용 제외). 베타는 시장이 1% 움직일 때 이 포트폴리오가 평균 몇 % 움직이는지를 나타냅니다.</p>' +
      '</section>' +
      '</div>' +

      '<div class="card sharecard">' +
      '<h3>결과 공유하기</h3>' +
      '<p class="miniline">구성과 비중이 링크에 담깁니다. 받는 사람은 같은 화면에서 바로 진단 결과를 봅니다.</p>' +
      '<div class="sharebtns">' +
      '<button type="button" class="btn primary" id="pcCopyLink">🔗 링크 복사</button>' +
      '<button type="button" class="btn" id="pcCopyText">📝 텍스트 요약 복사</button>' +
      '<button type="button" class="btn ghost" id="pcReset">처음부터 다시</button>' +
      '</div>' +
      '<div class="toast" id="pcToast" role="status" aria-live="polite"></div>' +
      '</div>' +

      '<div class="ctagrid">' +
      '<a class="cta" href="market-replay.html"><span class="ic">🎮</span><div><b>어제 장 트레이딩 게임</b><p>오늘 진단한 종목으로 직전 거래일 5분봉을 그대로 다시 거래해 보세요.</p></div><span class="go">체험 →</span></a>' +
      '<a class="cta" href="index.html#calculators"><span class="ic">🧮</span><div><b>계산기 7종</b><p>양도세·배당·ISA·환율·평단가까지, 진단 후 실행은 계산기로.</p></div><span class="go">열기 →</span></a>' +
      '</div>';

    var box = el('pcReport');
    box.innerHTML = html;
    box.hidden = false;
    state.lastReport = r;
    wireShare();
    if (scroll !== false) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- share ---------- */
  function encodeState() {
    var w = weights();
    var parts = state.holdings.map(function (h, i) {
      var id = h.custom ? ('N' + encodeURIComponent(h.name) + '|' + h.sector + '|' + [h.per, h.pbr, h.psr].map(function (v) { return v == null ? '' : v; }).join(':') + '|' + (h.market)) : h.code;
      return id + ':' + (w[i] * 1000).toFixed(0);
    });
    try { return btoa(unescape(encodeURIComponent(parts.join(',')))).replace(/=+$/, ''); } catch (e) { return ''; }
  }

  function readHash() {
    var q = location.search || '';
    var m = /[?&]p=([^&]+)/.exec(q);
    if (!m) return null;
    try {
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var raw = decodeURIComponent(escape(atob(b)));
      var out = [];
      raw.split(',').forEach(function (tok) {
        try {
        var i = tok.lastIndexOf(':');
        if (i < 0) return;
        var id = tok.slice(0, i), wv = num(tok.slice(i + 1)) / 1000;
        if (id.charAt(0) === 'N') {
          var f = decodeURIComponent(id.slice(1)).split('|');
          var v = (f[2] || '').split(':');
          out.push({ code: 'C-' + f[0], name: f[0], market: f[3] || 'KR', sector: f[1] || 'ETC', theme: '직접 입력',
            per: num(v[0]) || null, pbr: num(v[1]) || null, psr: num(v[2]) || null, div: null, beta: null, custom: true, raw: wv * 100, unit: 'pct' });
        } else {
          var h = makeHolding(id, wv * 100);
          if (h) out.push(h);
        }
        } catch (e) {}
      });
      return out.length ? out : null;
    } catch (e) { return null; }
  }

  function reportText(r) {
    var L = [];
    L.push('[AI 포트폴리오 진단] 종합 ' + r.scores.total + '점 · ' + r.personality.name);
    L.push('· 분산: ' + r.n + '종목, 상위1 ' + pct(r.top1) + ', HHI ' + Math.round(r.hhi * 10000) + ' (' + (r.hhi < 0.15 ? '양호' : r.hhi < 0.25 ? '보통' : '집중') + ')');
    L.push('· 밸류에이션: ' + r.metrics.filter(function (m) { return m.mine != null; }).map(function (m) {
      return m.label + ' ' + num3(m.mine) + (m.premium != null ? '(' + (m.premium > 0 ? '+' : '') + pct(m.premium) + ')' : '');
    }).join(' / ') + ' → ' + r.valGrade.label);
    L.push('· 섹터: ' + (r.topSec ? r.topSec.label + ' ' + pct(r.topSec.w) : '—'));
    L.push('· 지역: 국내 ' + pct(r.krW) + ' / 미국 ' + pct(r.usW));
    L.push(location.origin + location.pathname + '?p=' + encodeState());
    return L.join('\n');
  }

  function copy(text, msg) {
    function done() { toast(msg || '복사했습니다'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('복사에 실패했습니다. 직접 선택해 복사해 주세요.'); }
      document.body.removeChild(ta);
    }
  }

  function toast(msg) {
    var t = el('pcToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function wireShare() {
    var l = el('pcCopyLink'), t = el('pcCopyText'), rs = el('pcReset');
    if (l) l.onclick = function () { copy(location.origin + location.pathname + '?p=' + encodeState(), '링크를 복사했습니다'); };
    if (t) t.onclick = function () { if (state.lastReport) copy(reportText(state.lastReport), '요약을 복사했습니다'); };
    if (rs) rs.onclick = function () {
      state.holdings = []; el('pcReport').hidden = true; el('pcReport').innerHTML = '';
      history.replaceState(null, '', location.pathname); clearSearch(); render(); el('pcSearch').focus();
    };
  }

  /* ---------- persistence ---------- */
  function save() {
    try {
      localStorage.setItem('ant-portfolio-check', JSON.stringify({
        mode: state.mode,
        h: state.holdings.map(function (h) { return { code: h.code, name: h.name, market: h.market, sector: h.sector, theme: h.theme, per: h.per, pbr: h.pbr, psr: h.psr, div: h.div, beta: h.beta, custom: h.custom, raw: h.raw, unit: h.unit }; })
      }));
    } catch (e) {}
  }

  function restore() {
    try {
      var raw = localStorage.getItem('ant-portfolio-check');
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.mode === 'money') state.mode = 'money';
      state.holdings = (d.h || []).filter(function (h) { return h && h.name; });
      if (state.holdings.length) render();
      syncModeBtns();
    } catch (e) {}
  }

  /* ---------- wiring ---------- */
  function syncModeBtns() {
    $$('[data-mode]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-mode') === state.mode);
      b.setAttribute('aria-pressed', b.getAttribute('data-mode') === state.mode ? 'true' : 'false');
    });
    var tot = el('pcTotalRow');
    if (tot) tot.textContent = state.mode === 'pct' ? '지금은 비중(%) 입력 모드입니다.' : '지금은 금액 입력 모드입니다. 원화·달러를 섞어도 자동으로 비중을 계산합니다.';
  }

  function switchMode(m) {
    if (m === state.mode) return;
    var w = weights();
    if (m === 'money') {
      state.holdings.forEach(function (h, i) {
        var share = w[i] || 0;
        if (h.market === 'US') { h.unit = 'usd'; h.raw = Math.max(0, Math.round(share * 1000 * 10000 / state.fx)); }
        else { h.unit = 'krw'; h.raw = Math.max(0, Math.round(share * 1000)); }
      });
    } else {
      state.holdings.forEach(function (h, i) { h.unit = 'pct'; h.raw = Math.round(w[i] * 1000) / 10; });
    }
    state.mode = m;
    syncModeBtns();
    render();
  }

  function wire() {
    el('pcSearch').addEventListener('input', function (e) { showResults(e.target.value); });
    el('pcSearch').addEventListener('focus', function (e) { if (e.target.value) showResults(e.target.value); });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.searchwrap')) {
        el('pcResults').classList.remove('open');
      }
    });
    el('pcResults').addEventListener('click', function (e) {
      var b = e.target.closest('.sres');
      if (!b || !b.getAttribute('data-code')) return;
      addStock(b.getAttribute('data-code'));
    });
    el('pcSearch').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = el('pcResults').querySelector('.sres[data-code]');
        if (first) { e.preventDefault(); addStock(first.getAttribute('data-code')); }
        else if (e.target.value.trim()) { openCustom(e.target.value.trim()); }
      } else if (e.key === 'Escape') { el('pcResults').classList.remove('open'); }
    });

    el('pcHoldings').addEventListener('input', function (e) {
      var i = e.target.getAttribute('data-i');
      if (i == null) return;
      if (e.target.classList.contains('w')) {
        state.holdings[+i].raw = e.target.value.replace(/[^0-9.]/g, '');
        var w = weights();
        $$('.hrow').forEach(function (row, idx) {
          var sh = row.querySelector('.share');
          if (sh) sh.textContent = w[idx] ? (w[idx] > 0 && w[idx] < 0.001 ? '<0.1%' : pct(w[idx])) : '0%';
        });
        var s = state.holdings.reduce(function (a, h) { return a + (state.mode === 'pct' ? num(h.raw) : 0); }, 0);
        if (state.mode === 'pct') {
          el('pcTotal').innerHTML = '<span>총 ' + state.holdings.length + '종목</span><b>' + num3(s, 1) + '%</b>' +
            (Math.abs(s - 100) > 0.05 ? '<span class="warn">합계 ' + num3(s, 1) + '% → 100%로 자동 환산</span>' : '');
        } else {
          el('pcTotal').innerHTML = '<span>총 ' + state.holdings.length + '종목</span><b>' + won(moneyTotal()) + '</b>';
        }
        save();
      }
    });
    el('pcHoldings').addEventListener('change', function (e) {
      if (e.target.classList.contains('cur')) {
        var i = +e.target.getAttribute('data-i');
        var h = state.holdings[i], old = h.unit, v = num(h.raw);
        h.unit = e.target.value;
        if (old !== h.unit) {
          // convert amount so the share stays similar
          if (h.unit === 'usd' && old === 'krw') h.raw = Math.round(v * 10000 / state.fx);
          if (h.unit === 'krw' && old === 'usd') h.raw = Math.round(v * state.fx / 10000);
        }
        render();
      }
    });
    el('pcHoldings').addEventListener('click', function (e) {
      var b = e.target.closest('.del');
      if (b) removeHolding(+b.getAttribute('data-i'));
    });

    $$('[data-mode]').forEach(function (b) {
      b.onclick = function () { switchMode(b.getAttribute('data-mode')); };
    });

    el('pcAddCustom').onclick = function () {
      if (el('pcCustom').hidden) openCustom(''); else el('pcCustom').hidden = true;
    };
    el('pcCustomSave').onclick = addCustom;
    el('pcCustomCancel').onclick = function () { el('pcCustom').hidden = true; };

    el('pcRun').onclick = function () { run(true); };

    el('pcPresets').addEventListener('click', function (e) {
      var b = e.target.closest('[data-preset]');
      if (!b) return;
      var p = PRESETS.filter(function (x) { return x.id === b.getAttribute('data-preset'); })[0];
      if (!p) return;
      state.holdings = [];
      p.items.forEach(function (it) { var h = makeHolding(it[0], it[1]); if (h) state.holdings.push(h); });
      state.mode = 'pct';
      syncModeBtns(); render();
      el('pcRun').focus();
    });

    syncModeBtns();
    // 초기 render()는 load()의 두 경로(URL 복원/기기 저장 복원)에서 호출한다.
    // 여기서 먼저 render()하면 save()가 빈 목록을 덮어써 저장된 구성이 사라진다.
  }

  document.addEventListener('DOMContentLoaded', function () {
    el('pcPresets').innerHTML = PRESETS.map(function (p) {
      return '<button type="button" class="preset" data-preset="' + p.id + '">' +
        '<span class="ptop"><span class="pic">' + (p.icon || '📊') + '</span><b>' + esc(p.name) + '</b></span>' +
        '<span>' + esc(p.desc) + '</span>' +
        '<i>' + p.items.length + '종목 · 3초 진단 →</i></button>';
    }).join('');
    load();
  });
})();

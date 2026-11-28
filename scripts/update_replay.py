#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
주식하는 개구리 계산기 — '어제 장 실전 트레이딩 게임' 데이터 갱신 스크립트

실제 시장 데이터만 사용합니다(가짜/랜덤 데이터 생성 없음).
  - Yahoo Finance 공개 차트 API (query1 / query2), 5분봉 + 일봉
  - 5분봉은 확장장 포함(includePrePost=true)으로 요청해 프리마켓·애프터마켓 실제 봉까지 받는다
  - 미국 주식은 해당 거래일 원/달러 환율(USDKRW=X) 일봉 종가로 원화 환산

대상: 코스피·코스닥·나스닥·뉴욕증권거래소(NYSE)·ETF 주요 종목 145개 (다우존스 30종목 전부 포함)

출력: data/market-replay.json
실행: python3 scripts/update_replay.py  [--keep 3] [--out data/market-replay.json]
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))

# (시장, 야후 티커, 표시 이름, 거래소 표시, 지수 태그)
#   시장: KR = 한국장 / US = 미국장 (게임 세션 구분)
#   태그: KOSPI·KOSDAQ·NASDAQ·NYSE·ETF / SP500·DJIA (지수 구성 종목)
KOSPI_TAGS = ["KOSPI"]
KOSDAQ_TAGS = ["KOSDAQ"]

SYMBOLS = [
    # ---- 코스피 ----
    ("KR", "005930.KS", "삼성전자", "코스피", KOSPI_TAGS),
    ("KR", "000660.KS", "SK하이닉스", "코스피", KOSPI_TAGS),
    ("KR", "373220.KS", "LG에너지솔루션", "코스피", KOSPI_TAGS),
    ("KR", "207940.KS", "삼성바이오로직스", "코스피", KOSPI_TAGS),
    ("KR", "005380.KS", "현대차", "코스피", KOSPI_TAGS),
    ("KR", "000270.KS", "기아", "코스피", KOSPI_TAGS),
    ("KR", "068270.KS", "셀트리온", "코스피", KOSPI_TAGS),
    ("KR", "035420.KS", "NAVER", "코스피", KOSPI_TAGS),
    ("KR", "035720.KS", "카카오", "코스피", KOSPI_TAGS),
    ("KR", "105560.KS", "KB금융", "코스피", KOSPI_TAGS),
    ("KR", "055550.KS", "신한지주", "코스피", KOSPI_TAGS),
    ("KR", "086790.KS", "하나금융지주", "코스피", KOSPI_TAGS),
    ("KR", "316140.KS", "우리금융지주", "코스피", KOSPI_TAGS),
    ("KR", "138040.KS", "메리츠금융지주", "코스피", KOSPI_TAGS),
    ("KR", "012330.KS", "현대모비스", "코스피", KOSPI_TAGS),
    ("KR", "005490.KS", "POSCO홀딩스", "코스피", KOSPI_TAGS),
    ("KR", "051910.KS", "LG화학", "코스피", KOSPI_TAGS),
    ("KR", "006400.KS", "삼성SDI", "코스피", KOSPI_TAGS),
    ("KR", "028260.KS", "삼성물산", "코스피", KOSPI_TAGS),
    ("KR", "032830.KS", "삼성생명", "코스피", KOSPI_TAGS),
    ("KR", "017670.KS", "SK텔레콤", "코스피", KOSPI_TAGS),
    ("KR", "030200.KS", "KT", "코스피", KOSPI_TAGS),
    ("KR", "015760.KS", "한국전력", "코스피", KOSPI_TAGS),
    ("KR", "033780.KS", "KT&G", "코스피", KOSPI_TAGS),
    ("KR", "003670.KS", "포스코퓨처엠", "코스피", KOSPI_TAGS),
    ("KR", "011200.KS", "HMM", "코스피", KOSPI_TAGS),
    ("KR", "096770.KS", "SK이노베이션", "코스피", KOSPI_TAGS),
    ("KR", "010130.KS", "고려아연", "코스피", KOSPI_TAGS),
    ("KR", "018260.KS", "삼성에스디에스", "코스피", KOSPI_TAGS),
    ("KR", "009150.KS", "삼성전기", "코스피", KOSPI_TAGS),
    ("KR", "066570.KS", "LG전자", "코스피", KOSPI_TAGS),
    ("KR", "036460.KS", "한국가스공사", "코스피", KOSPI_TAGS),
    ("KR", "000810.KS", "삼성화재", "코스피", KOSPI_TAGS),
    ("KR", "259960.KS", "크래프톤", "코스피", KOSPI_TAGS),
    ("KR", "352820.KS", "하이브", "코스피", KOSPI_TAGS),
    ("KR", "326030.KS", "SK바이오팜", "코스피", KOSPI_TAGS),
    ("KR", "000100.KS", "유한양행", "코스피", KOSPI_TAGS),
    ("KR", "128940.KS", "한미약품", "코스피", KOSPI_TAGS),
    ("KR", "271560.KS", "오리온", "코스피", KOSPI_TAGS),
    ("KR", "097950.KS", "CJ제일제당", "코스피", KOSPI_TAGS),
    ("KR", "004020.KS", "현대제철", "코스피", KOSPI_TAGS),
    ("KR", "011070.KS", "LG이노텍", "코스피", KOSPI_TAGS),
    ("KR", "010140.KS", "삼성중공업", "코스피", KOSPI_TAGS),
    ("KR", "009540.KS", "HD한국조선해양", "코스피", KOSPI_TAGS),
    ("KR", "042660.KS", "한화오션", "코스피", KOSPI_TAGS),
    ("KR", "012450.KS", "한화에어로스페이스", "코스피", KOSPI_TAGS),
    ("KR", "064350.KS", "현대로템", "코스피", KOSPI_TAGS),
    ("KR", "047810.KS", "한국항공우주", "코스피", KOSPI_TAGS),
    ("KR", "034020.KS", "두산에너빌리티", "코스피", KOSPI_TAGS),
    ("KR", "267260.KS", "HD현대일렉트릭", "코스피", KOSPI_TAGS),
    ("KR", "090430.KS", "아모레퍼시픽", "코스피", KOSPI_TAGS),
    ("KR", "051900.KS", "LG생활건강", "코스피", KOSPI_TAGS),
    ("KR", "161390.KS", "한국타이어앤테크놀로지", "코스피", KOSPI_TAGS),
    ("KR", "011170.KS", "롯데케미칼", "코스피", KOSPI_TAGS),
    ("KR", "004370.KS", "농심", "코스피", KOSPI_TAGS),
    ("KR", "023530.KS", "롯데쇼핑", "코스피", KOSPI_TAGS),
    ("KR", "034730.KS", "SK", "코스피", KOSPI_TAGS),
    ("KR", "272210.KS", "한화시스템", "코스피", KOSPI_TAGS),
    # ---- 코스닥 ----
    ("KR", "247540.KQ", "에코프로비엠", "코스닥", KOSDAQ_TAGS),
    ("KR", "086520.KQ", "에코프로", "코스닥", KOSDAQ_TAGS),
    ("KR", "196170.KQ", "알테오젠", "코스닥", KOSDAQ_TAGS),
    ("KR", "028300.KQ", "HLB", "코스닥", KOSDAQ_TAGS),
    ("KR", "058470.KQ", "리노공업", "코스닥", KOSDAQ_TAGS),
    ("KR", "095340.KQ", "ISC", "코스닥", KOSDAQ_TAGS),
    ("KR", "039030.KQ", "이오테크닉스", "코스닥", KOSDAQ_TAGS),
    ("KR", "240810.KQ", "원익IPS", "코스닥", KOSDAQ_TAGS),
    ("KR", "357780.KQ", "솔브레인", "코스닥", KOSDAQ_TAGS),
    ("KR", "036930.KQ", "주성엔지니어링", "코스닥", KOSDAQ_TAGS),
    ("KR", "145020.KQ", "휴젤", "코스닥", KOSDAQ_TAGS),
    ("KR", "214150.KQ", "클래시스", "코스닥", KOSDAQ_TAGS),
    ("KR", "041510.KQ", "에스엠", "코스닥", KOSDAQ_TAGS),
    ("KR", "035900.KQ", "JYP Ent.", "코스닥", KOSDAQ_TAGS),
    ("KR", "122870.KQ", "와이지엔터테인먼트", "코스닥", KOSDAQ_TAGS),
    ("KR", "293490.KQ", "카카오게임즈", "코스닥", KOSDAQ_TAGS),
    ("KR", "263750.KQ", "펄어비스", "코스닥", KOSDAQ_TAGS),
    ("KR", "112040.KQ", "위메이드", "코스닥", KOSDAQ_TAGS),
    ("KR", "030520.KQ", "한글과컴퓨터", "코스닥", KOSDAQ_TAGS),
    ("KR", "060720.KQ", "KH바텍", "코스닥", KOSDAQ_TAGS),
    # ---- 미국 (나스닥) ----
    ("US", "NVDA", "엔비디아", "나스닥", ["NASDAQ", "SP500", "DJIA"]),
    ("US", "TSLA", "테슬라", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "AAPL", "애플", "나스닥", ["NASDAQ", "SP500", "DJIA"]),
    ("US", "MSFT", "마이크로소프트", "나스닥", ["NASDAQ", "SP500", "DJIA"]),
    ("US", "AMZN", "아마존", "나스닥", ["NASDAQ", "SP500", "DJIA"]),
    ("US", "META", "메타", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "GOOGL", "알파벳(구글)", "나스닥", ["NASDAQ", "SP500", "DJIA"]),
    ("US", "AVGO", "브로드컴", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "AMD", "AMD", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "NFLX", "넷플릭스", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "COST", "코스트코", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "PLTR", "팔란티어", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "MU", "마이크론", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "INTC", "인텔", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "QCOM", "퀄컴", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "ADBE", "어도비", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "CSCO", "시스코", "나스닥", ["NASDAQ", "SP500", "DJIA"]),
    ("US", "PEP", "펩시코", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "TMUS", "T모바일", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "AMGN", "암젠", "나스닥", ["NASDAQ", "SP500", "DJIA"]),
    ("US", "ISRG", "인튜이티브서지컬", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "BKNG", "부킹홀딩스", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "LRCX", "램리서치", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "AMAT", "어플라이드머티어리얼즈", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "PANW", "팔로알토네트웍스", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "SMCI", "슈퍼마이크로", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "ARM", "ARM", "나스닥", ["NASDAQ"]),
    ("US", "ASML", "ASML", "나스닥", ["NASDAQ"]),
    ("US", "MSTR", "스트래티지", "나스닥", ["NASDAQ"]),
    ("US", "SBUX", "스타벅스", "나스닥", ["NASDAQ", "SP500"]),
    ("US", "WMT", "월마트", "나스닥", ["NASDAQ", "SP500", "DJIA"]),
    # ---- 미국 (뉴욕증권거래소) ----
    ("US", "TSM", "TSMC", "뉴욕", ["NYSE"]),
    ("US", "IONQ", "아이온큐", "뉴욕", ["NYSE"]),
    ("US", "BABA", "알리바바", "뉴욕", ["NYSE"]),
    ("US", "JPM", "JP모건", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "V", "비자", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "MA", "마스터카드", "뉴욕", ["NYSE", "SP500"]),
    ("US", "XOM", "엑슨모빌", "뉴욕", ["NYSE", "SP500"]),
    ("US", "CVX", "셰브론", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "JNJ", "존슨앤존슨", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "PG", "P&G", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "KO", "코카콜라", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "HD", "홈디포", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "DIS", "디즈니", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "BA", "보잉", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "CAT", "캐터필러", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "GS", "골드만삭스", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "MCD", "맥도날드", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "NKE", "나이키", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "PFE", "화이자", "뉴욕", ["NYSE", "SP500"]),
    ("US", "UNH", "유나이티드헬스", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "LLY", "일라이릴리", "뉴욕", ["NYSE", "SP500"]),
    ("US", "T", "AT&T", "뉴욕", ["NYSE", "SP500"]),
    ("US", "VZ", "버라이즌", "뉴욕", ["NYSE", "SP500"]),
    ("US", "ORCL", "오라클", "뉴욕", ["NYSE", "SP500"]),
    ("US", "IBM", "IBM", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "AXP", "아메리칸익스프레스", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "SHW", "셔윈윌리엄스", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "TRV", "트래블러스", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "MMM", "3M", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "MRK", "머크", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "CRM", "세일즈포스", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "HON", "허니웰", "뉴욕", ["NYSE", "SP500", "DJIA"]),
    ("US", "UPS", "UPS", "뉴욕", ["NYSE", "SP500"]),
    ("US", "RTX", "RTX", "뉴욕", ["NYSE", "SP500"]),
    # ---- ETF (지수 추종) ----
    ("US", "SPY", "S&P500 ETF", "ETF", ["ETF", "SP500ETF"]),
    ("US", "QQQ", "나스닥100 ETF", "ETF", ["ETF"]),
    ("US", "DIA", "다우존스 ETF", "ETF", ["ETF", "DJIAETF"]),
]

MARKET_META = {
    "US": {
        "tz": "America/New_York",
        "currency": "USD",
        "open": "09:30",
        "close": "16:00",
        "last_bar": "15:55",   # 야후 5분봉 마지막 라벨
        "startCash": 10000000,  # 원화 1,000만 원 (환율로 환산해 매매)
    },
    "KR": {
        "tz": "Asia/Seoul",
        "currency": "KRW",
        "open": "09:00",
        "close": "15:30",
        "last_bar": "15:00",
        "startCash": 10000000,
    },
}

# 실제 거래비용 (원 단위 반올림 없이 비율로 계산, 페이지에서도 같은 값 사용)
FEES = {
    "KR": {"buy": 0.00015, "sell": 0.00015, "tax": 0.0020},  # 위탁수수료 0.015%, 증권거래세 0.20%(2026년: 거래세 0.05%+농특세 0.15%, 매도)
    "US": {"buy": 0.001, "sell": 0.001, "tax": 0.0},          # 해외주식 수수료 0.1%(매수·매도)
}

UA = "Mozilla/5.0 (compatible; ant-econ-market-replay/1.0; +https://ant-econ.github.io/)"
WORKERS = 6
INCLUDE_PREPOST = True   # 확장장(프리마켓·애프터마켓) 실제 5분봉까지 수신


def fetch_json(path, tries=3):
    last = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = "https://%s%s" % (host, path)
        for attempt in range(tries):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=25) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:  # noqa: BLE001
                last = "%s: %s" % (url, e)
                time.sleep(1.0 + 0.9 * attempt + random.random() * 0.6)
    raise RuntimeError("fetch failed: %s" % last)


def chart(ticker, interval, rng):
    path = "/v8/finance/chart/%s?interval=%s&range=%s&includePrePost=%s&events=div%%2Csplit" % (
        urllib.parse.quote(ticker), interval, rng, "true" if INCLUDE_PREPOST else "false")
    return fetch_json(path)


def to_local(ts, offset_min):
    return datetime.fromtimestamp(ts + offset_min * 60, tz=timezone.utc).replace(tzinfo=None)


def hhmm(dt):
    return dt.strftime("%H:%M")


def parse_bars(ticker, interval="5m", rng="1mo"):
    d = chart(ticker, interval, rng)
    res = (d.get("chart") or {}).get("result") or []
    if not res:
        raise RuntimeError("no chart result for %s: %s" % (ticker, (d.get("chart") or {}).get("error")))
    r = res[0]
    meta = r["meta"]
    off = int(meta.get("gmtoffset") or 0) // 60
    ts = r.get("timestamp") or []
    q = (r.get("indicators") or {}).get("quote") or [{}]
    q = q[0]
    opens, highs, lows, closes, vols = (q.get(k) or [] for k in ("open", "high", "low", "close", "volume"))

    days = {}
    for i, t in enumerate(ts):
        if i >= len(closes):
            break
        o, h, l, c = opens[i], highs[i], lows[i], closes[i]
        if c is None or o is None or h is None or l is None:
            continue  # 거래 없음/데이터 없음 → 실제 값이 아니므로 채우지 않고 제외
        v = vols[i] if i < len(vols) and vols[i] is not None else 0
        dt = to_local(t, off)
        day = dt.strftime("%Y-%m-%d")
        days.setdefault(day, {"offset": off, "bars": []})
        days[day]["bars"].append([int(t), round(float(o), 3), round(float(h), 3),
                                  round(float(l), 3), round(float(c), 3), int(v)])
    # 같은 시각 봉이 두 번 오는 경우가 있어 시각 기준으로 정리(실제 값만 유지)
    for info in days.values():
        uniq = {}
        for b in info["bars"]:
            uniq[b[0]] = b
        info["bars"] = [uniq[k] for k in sorted(uniq)]
    return meta, days


def daily_map(ticker, rng="3mo"):
    d = chart(ticker, "1d", rng)
    res = (d.get("chart") or {}).get("result") or []
    if not res:
        return {}
    r = res[0]
    off = int(r["meta"].get("gmtoffset") or 0) // 60
    q = (r.get("indicators") or {}).get("quote") or [{}]
    q = q[0]
    out = {}
    for i, t in enumerate(r.get("timestamp") or []):
        c = (q.get("close") or [None])[i] if i < len(q.get("close") or []) else None
        if c is None:
            continue
        day = to_local(t, off).strftime("%Y-%m-%d")
        out[day] = {
            "open": round(float(q["open"][i]), 3) if q.get("open") and q["open"][i] is not None else None,
            "high": round(float(q["high"][i]), 3) if q.get("high") and q["high"][i] is not None else None,
            "low": round(float(q["low"][i]), 3) if q.get("low") and q["low"][i] is not None else None,
            "close": round(float(c), 3),
            "volume": int(q["volume"][i]) if q.get("volume") and q["volume"][i] is not None else 0,
        }
    return out


def fx_daily():
    """USDKRW=X 일봉 종가 → {날짜: 환율}"""
    try:
        return {k: v["close"] for k, v in daily_map("USDKRW=X", "3mo").items()}, "USDKRW=X daily close (Yahoo Finance)"
    except Exception as e:  # noqa: BLE001
        print("[warn] FX fetch failed: %s" % e, file=sys.stderr)
        return {}, None


def regular_bars(market, day, bars):
    """확장장 봉 중 정규장 시간대(현지 시각 기준 open~close)에 속한 봉만 고른다."""
    m = MARKET_META[market]
    o, c = hms(m["open"]), hms(m["close"])
    out = []
    for b in bars:
        t = to_local(b[0], day["offset"])
        sec = t.hour * 3600 + t.minute * 60
        if o <= sec < c:
            out.append(b)
    return out


def hms(txt):
    p = txt.split(":")
    return int(p[0]) * 3600 + int(p[1]) * 60


def session_complete(market, day, bars):
    """정규장 시작 봉과 마지막 봉이 모두 있고 봉 수가 충분한지(확장장 봉은 세지 않는다)"""
    m = MARKET_META[market]
    if not bars:
        return False, "empty"
    bars = regular_bars(market, day, bars)
    if not bars:
        return False, "no regular bars"
    first = hhmm(to_local(bars[0][0], day["offset"]))
    last = hhmm(to_local(bars[-1][0], day["offset"]))
    if first != m["open"]:
        return False, "open gap (first bar %s)" % first
    # 마지막 봉: 시장별 기대 라벨보다 10분 이상 이르면 장중(미완료)
    exp = m["last_bar"].split(":")
    lb = last.split(":")
    lag = (int(lb[0]) * 60 + int(lb[1])) - (int(exp[0]) * 60 + int(exp[1]))
    if lag < -10:
        return False, "incomplete (last bar %s)" % last
    # 봉 수 검증 (정규장 전체 대비 90% 이상)
    need = 70 if market == "KR" else 76
    if len(bars) < need:
        return False, "too few bars (%d)" % len(bars)
    return True, "ok"


def one_symbol(item):
    """종목 하나의 5분봉·일봉을 받아 (market, day, row) 목록과 note 목록을 만든다."""
    market, ticker, name, ex, tags = item
    notes, rows = [], []
    try:
        meta, days = parse_bars(ticker)
    except Exception as e:  # noqa: BLE001
        return [], ["%s(%s) 5분봉 조회 실패: %s" % (name, ticker, e)]
    try:
        daily = daily_map(ticker)
    except Exception as e:  # noqa: BLE001
        daily = {}
        notes.append("%s(%s) 일봉 조회 실패 — 시초가·종가 기준은 첫/마지막 봉 사용" % (name, ticker))
        print("[warn] daily %s failed: %s" % (ticker, e), file=sys.stderr)

    for day, info in days.items():
        ok, why = session_complete(market, info, info["bars"])
        if not ok:
            continue
        reg = regular_bars(market, info, info["bars"])
        dayrow = daily.get(day)
        if dayrow is None:
            # 야후 일봉이 아직 게시되지 않은 날 → 같은 날 실제 5분봉으로 시가·고가·저가·종가 구성
            bars = info["bars"]
            dayrow = {
                "open": bars[0][1],
                "high": max(b[2] for b in bars),
                "low": min(b[3] for b in bars),
                "close": bars[-1][4],
                "volume": sum(b[5] for b in bars),
                "fromBars": True,
            }
            notes.append("%s %s 일봉 미게시 → 5분봉으로 시가·종가 구성" % (ticker, day))
        else:
            dayrow = dict(dayrow)
        prev_days = [x for x in sorted(daily) if x < day]
        dayrow["prevClose"] = daily[prev_days[-1]]["close"] if prev_days else None
        row = {
            "sym": ticker,
            "name": name,
            "ex": ex,
            "tags": tags,
            "bars": info["bars"],
            "reg": [reg[0][0], reg[-1][0] + 300],   # 이 종목의 정규장 봉 구간(에폭 초)
            "day": dayrow,
        }
        rows.append((market, day, info["offset"], row))
    return rows, notes


def build(keep):
    fx, fx_source = fx_daily()
    notes = []
    by_market = {"US": {}, "KR": {}}

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(one_symbol, SYMBOLS))

    for rows, n in results:
        notes.extend(n)
        for market, day, offset, row in rows:
            bucket = by_market[market].setdefault(day, {"offset": offset, "symbols": []})
            bucket["symbols"].append(row)

    sessions = []
    for market in ("KR", "US"):
        m = MARKET_META[market]
        days = sorted(by_market[market].keys(), reverse=True)[:keep]
        for day in sorted(days):
            info = by_market[market][day]
            syms = sorted(info["symbols"], key=lambda s: s["name"])
            if len(syms) < 2:
                notes.append("%s %s: 유효 종목 부족(%d)으로 제외" % (market, day, len(syms)))
                continue
            rate = 1.0
            if m["currency"] != "KRW":
                rate = fx.get(day)
                if not rate:
                    # 휴장일 등 → 직전 영업일 환율
                    prev = [d for d in sorted(fx) if d <= day]
                    rate = fx[prev[-1]] if prev else None
                if not rate:
                    notes.append("%s %s: 환율 없음 → 세션 제외" % (market, day))
                    continue
            reg_start = min(x["reg"][0] for x in syms)
            reg_end = max(x["reg"][1] for x in syms)
            ext_start = min(x["bars"][0][0] for x in syms)
            ext_end = max(x["bars"][-1][0] + 300 for x in syms)
            sessions.append({
                "id": "%s-%s" % (market.lower(), day),
                "market": market,
                "date": day,
                "tz": m["tz"],
                "tzOffset": info["offset"],
                "open": m["open"],
                "close": m["close"],
                "currency": m["currency"],
                "fx": round(float(rate), 4),
                "extended": True,
                "extStart": ext_start,
                "extEnd": ext_end,
                "regStart": reg_start,
                "regEnd": reg_end,
                "openKst": datetime.fromtimestamp(reg_start, KST).strftime("%H:%M"),
                "closeKst": datetime.fromtimestamp(reg_end, KST).strftime("%H:%M"),
                "extStartKst": datetime.fromtimestamp(ext_start, KST).strftime("%H:%M"),
                "extEndKst": datetime.fromtimestamp(ext_end, KST).strftime("%H:%M"),
                "symbols": syms,
            })

    out = {
        "version": 3,
        "generatedAt": datetime.now(KST).isoformat(timespec="seconds"),
        "generatedBy": "scripts/update_replay.py",
        "source": "Yahoo Finance Chart API (v8/finance/chart), 확장장 포함 5분봉·일봉",
        "interval": "5m",
        "includePrePost": INCLUDE_PREPOST,
        "kstOffset": 540,
        "startCash": 10000000,
        "fees": FEES,
        "fxSource": fx_source,
        "universe": {
            "symbols": len(SYMBOLS),
            "note": "코스피·코스닥·나스닥·뉴욕증권거래소·ETF 주요 종목, 다우존스 30종목 전부 포함",
        },
        "sessions": sessions,
        "notes": notes,
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=3, help="시장별 보관할 최근 완료 거래일 수")
    ap.add_argument("--out", default="data/market-replay.json")
    args = ap.parse_args()

    data = build(args.keep)
    if not data["sessions"]:
        print("[error] 유효 세션 없음 — 파일을 쓰지 않습니다.", file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, args.out)
    for s in data["sessions"]:
        print("%-12s %s  종목 %d  봉 %d~%d" % (
            s["id"], s["currency"], len(s["symbols"]),
            min(len(x["bars"]) for x in s["symbols"]), max(len(x["bars"]) for x in s["symbols"])))
    print("wrote %s (%.1f KB)" % (args.out, os.path.getsize(args.out) / 1024))
    for n in data["notes"][:40]:
        print("note:", n)
    if len(data["notes"]) > 40:
        print("note: ... 외 %d건" % (len(data["notes"]) - 40))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
개미일지 계산기 — '어제 장 실전 트레이딩 게임' 데이터 갱신 스크립트

실제 시장 데이터만 사용합니다(가짜/랜덤 데이터 생성 없음).
  - Yahoo Finance 공개 차트 API (query1 / query2), 5분봉 + 일봉
  - 미국 주식은 해당 거래일 원/달러 환율(USDKRW=X) 일봉 종가로 원화 환산

출력: data/market-replay.json
실행: python3 scripts/update_replay.py  [--keep 3] [--out data/market-replay.json]
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))

SYMBOLS = [
    # market, yahoo ticker, 표시 이름, 거래소
    ("US", "NVDA", "엔비디아", "NASDAQ"),
    ("US", "TSLA", "테슬라", "NASDAQ"),
    ("US", "AAPL", "애플", "NASDAQ"),
    ("US", "MSFT", "마이크로소프트", "NASDAQ"),
    ("US", "QQQ", "나스닥100 ETF", "NASDAQ"),
    ("KR", "005930.KS", "삼성전자", "KOSPI"),
    ("KR", "000660.KS", "SK하이닉스", "KOSPI"),
    ("KR", "035420.KS", "NAVER", "KOSPI"),
    ("KR", "005380.KS", "현대차", "KOSPI"),
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
    "KR": {"buy": 0.00015, "sell": 0.00015, "tax": 0.0018},  # 위탁수수료 0.015%, 증권거래세 0.18%(매도)
    "US": {"buy": 0.001, "sell": 0.001, "tax": 0.0},          # 해외주식 수수료 0.1%(매수·매도)
}

UA = "Mozilla/5.0 (compatible; ant-econ-market-replay/1.0; +https://ant-econ.github.io/)"


def fetch_json(path, tries=4):
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
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("fetch failed: %s" % last)


def chart(ticker, interval, rng):
    path = "/v8/finance/chart/%s?interval=%s&range=%s&includePrePost=false&events=div%%2Csplit" % (
        urllib.parse.quote(ticker), interval, rng)
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


def session_complete(market, day, bars):
    """정규장 시작 봉과 마지막 봉이 모두 있고 봉 수가 충분한지"""
    m = MARKET_META[market]
    if not bars:
        return False, "empty"
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


def build(keep):
    fx, fx_source = fx_daily()
    notes = []
    by_market = {"US": {}, "KR": {}}

    for market, ticker, name, ex in SYMBOLS:
        try:
            meta, days = parse_bars(ticker)
        except Exception as e:  # noqa: BLE001
            notes.append("%s(%s) 5분봉 조회 실패: %s" % (name, ticker, e))
            print("[warn] intraday %s failed: %s" % (ticker, e), file=sys.stderr)
            continue
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
            prev_days = [x for x in sorted(daily) if x < day]
            if dayrow is not None and not dayrow.get("fromBars"):
                dayrow["prevClose"] = daily[prev_days[-1]]["close"] if prev_days else None
            else:
                dayrow["prevClose"] = daily[prev_days[-1]]["close"] if prev_days else None
                dayrow["fromBars"] = True
            row = {
                "sym": ticker,
                "name": name,
                "ex": ex,
                "bars": info["bars"],
                "day": dayrow,
            }
            by_market[market].setdefault(day, {"offset": info["offset"], "symbols": [], "skipped": []})["symbols"].append(row)

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
                "symbols": syms,
            })

    out = {
        "version": 1,
        "generatedAt": datetime.now(KST).isoformat(timespec="seconds"),
        "generatedBy": "scripts/update_replay.py",
        "source": "Yahoo Finance Chart API (v8/finance/chart), 정규장 5분봉·일봉",
        "interval": "5m",
        "startCash": 10000000,
        "fees": FEES,
        "fxSource": fx_source,
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
    for n in data["notes"]:
        print("note:", n)
    return 0


if __name__ == "__main__":
    sys.exit(main())

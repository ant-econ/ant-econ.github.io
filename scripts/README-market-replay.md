# 어제 장 실전 트레이딩 게임 — 데이터 파이프라인

`market-replay.html`은 `data/market-replay.json` 하나만 읽어서 동작합니다.
이 파일은 `scripts/update_replay.py`가 실제 시세로 만듭니다. (가짜·랜덤 데이터 없음)

화면은 이 JSON의 **시장별 최신 세션 두 개를 한국시간(KST) 단일 타임라인으로 이어 붙여** 국장·미장 통합 장 하나로 보여줍니다. 시장별 `sessions` 배열 구조는 그대로라서 `scheduled-actions/🎮-어제-장-리플레이-데이터-갱신/check.sh`(시장별 최신 `date` 비교)가 그대로 동작합니다.

## 데이터 출처

| 항목 | 출처 | 비고 |
| --- | --- | --- |
| 분봉(5분) 가격·거래량 | Yahoo Finance Chart API `v8/finance/chart/{티커}?interval=5m&range=1mo&includePrePost=true` | **확장장 포함**. 프리마켓·애프터마켓 실제 봉을 그대로 넣고, 받지 않은 봉은 만들지 않음 |
| 일봉(시초가·종가) | 같은 API `interval=1d&range=3mo` | 정규장 기준 OHLC. 일봉이 아직 게시되지 않은 날은 같은 날 정규장 5분봉으로 시가·종가 구성 |
| 원/달러 환율 | `USDKRW=X` 일봉 종가 | 미국 종목을 원화 계좌에서 환산할 때 사용 |

확장장 확인 결과(2026-11-25):

- 미국 종목은 `includePrePost=true`로 04:00~18:55 ET 봉이 내려옵니다(정규장 09:30~16:00 포함 15시간 = 180봉). 한국시간으로는 18:00~다음날 09:00입니다. 종목에 따라 확장장 봉이 일부만 오는 경우가 있어 **받은 봉만** 씁니다.
- 한국 종목(005930.KS 등)은 이 API가 프리·애프터마켓 봉을 주지 않아 정규장 봉만 들어갑니다(09:00~15:30 KST).
- 확장장 봉은 거래량이 0으로 오는 경우가 있습니다. 값을 고치지 않고 그대로 둡니다.
- 세션 유효성은 **정규장 봉만으로** 판정합니다(시작 봉이 정규장 개장 시각, 마지막 봉이 마감 10분 이내, 봉 수 70/76개 이상). 확장장 봉은 여기에 세지 않습니다.

거래비용 기본값: 국내 매수 수수료 0.015%, 국내 매도 수수료 0.015% + 증권거래세 0.20%(2026년 기준, 거래세 0.05% + 농어촌특별세 0.15%), 미국 매수·매도 각 0.1%.

- 대상 종목: 146개 — 코스피 58, 코스닥 20, 나스닥 31, 뉴욕증권거래소(NYSE) 34, 지수 ETF 3(SPY·QQQ·DIA). 다우존스 30종목과 S&P500 구성 종목 60개를 포함합니다. 목록은 스크립트의 `SYMBOLS`에 있고, 각 항목은 `(시장, 티커, 표시 이름, 거래소, 태그)`입니다. 태그 `KOSPI·KOSDAQ·NASDAQ·NYSE·ETF`는 게시판 필터, `SP500·DJIA`는 지수 구성 종목 표시입니다.
- 시장별로 **최근 3거래일**을 보관합니다(`--keep`으로 변경).
- 정규장 시작 봉과 마지막 봉이 모두 있고 봉 수가 충분한 날만 싣습니다. 시초가 데이터가 비어 있는 날(야후 데이터 공백)은 게임의 "존버" 비교가 왜곡되므로 제외하고, 제외 사유를 JSON `notes`에 남깁니다.
- 146종목 × 2회(분봉+일봉) 요청을 6개 스레드로 받아 약 12초면 끝납니다. 파일은 2.2MB, GitHub Pages가 gzip으로 내려 580KB 정도입니다(예약 작업 검사 스크립트가 읽는 4MB 한도 안).

## 왜 브라우저가 야후를 직접 부르지 않는가

"전 종목을 브라우저에서 온디맨드로 받아오기"를 먼저 시험했고, **실패**했습니다(2026-11-25 확인).

| 경로 | 결과 |
| --- | --- |
| `https://query1.finance.yahoo.com/v8/finance/chart/...` 직접 | CORS 헤더 없음 → 브라우저에서 읽을 수 없음 |
| `corsproxy.io` | HTTP 401 (API 키 없으면 거부) |
| `api.allorigins.win` | 3회 연속 요청에 1.4초·21초 성공, 522 실패 — 지연과 실패가 무작위 |
| `api.codetabs.com`, `thingproxy` | 522·연결 실패 |

무료 프록시는 게임 화면의 필수 경로로 삼기에 너무 불안정해서, 대신 이 스크립트가 146종목을 매일 미리 받아 정적 JSON으로 둡니다. 브라우저는 같은 출처의 `data/market-replay.json`만 읽습니다.

## 실행

```bash
python3 scripts/update_replay.py            # data/market-replay.json 갱신
python3 scripts/update_replay.py --keep 5   # 더 많은 거래일 보관
```

파이썬 표준 라이브러리만 사용합니다(별도 설치 없음). 네트워크는 HTTPS 443만 씁니다.

## 매일 자동 갱신

두 가지 중 하나를 쓰면 됩니다.

### 1) GitHub Actions (권장, 무료)

`.github/workflows/update-market-replay.yml`을 레포에 추가하면 평일 16:10 KST(한국장 마감 후)와
07:10 KST(미국장 마감 후)에 자동으로 데이터를 갱신·커밋합니다.

이 저장소에 붙이지 못한 이유: Pickle의 GitHub App 토큰에 `workflows` 권한이 없어
`.github/workflows/*`가 포함된 푸시가 거절됩니다(`refusing to allow a GitHub App to create or
update workflow ... without workflows permission`). 워크플로 파일은
`handoffs/🎮-어제-장-실전-트레이딩-게임-제작-배포/workflow/update-market-replay.yml`에 있습니다.

권한이 생기면:

```bash
mkdir -p .github/workflows
cp <워크플로 파일> .github/workflows/update-market-replay.yml
git add .github && git commit -m "ci: 어제 장 리플레이 데이터 자동 갱신" && git push
```

(GitHub 앱 설치 화면에서 `workflows` 권한을 켜거나, 저장소 관리자가 직접 커밋해도 됩니다.)

### 2) 예약 작업(스케줄러)에서 실행

워크플로 없이도, 이 저장소를 체크아웃한 곳에서 아래를 매일 실행하면 같은 효과가 납니다.

```bash
cd <repo> && git pull --rebase --autostash -q && python3 scripts/update_replay.py && \
  git add data/market-replay.json && \
  (git diff --cached --quiet || git commit -m "chore: 어제 장 리플레이 데이터 갱신" && git push -q)
```

## JSON 구조 (요약)

```json
{
  "generatedAt": "2026-11-25T08:10:00+09:00",
  "interval": "5m",
  "includePrePost": true,
  "kstOffset": 540,
  "startCash": 10000000,
  "fees": { "KR": {"buy":0.00015,"sell":0.00015,"tax":0.0020},
            "US": {"buy":0.001,"sell":0.001,"tax":0} },
  "sessions": [
    { "id":"us-2026-11-23", "market":"US", "date":"2026-11-23",
      "tz":"America/New_York", "tzOffset":-300, "open":"09:30", "close":"16:00",
      "currency":"USD", "fx":1344.31,
      "extended": true,
      "extStart": 1795424400, "extEnd": 1795478400,
      "regStart": 1795444200, "regEnd": 1795467600,
      "openKst":"23:30", "closeKst":"06:00", "extStartKst":"18:00", "extEndKst":"09:00",
      "symbols":[ { "sym":"NVDA","name":"엔비디아","ex":"나스닥",
                    "tags":["NASDAQ","SP500","DJIA"],
                    "bars":[[epoch,o,h,l,c,v], ...],
                    "reg":[1795444200, 1795467600],
                    "day":{"open":..,"high":..,"low":..,"close":..,"volume":..,"prevClose":..} } ] }
  ],
  "notes": []
}
```

`bars`의 시각은 UTC 에폭(초)이고, 화면은 `kstOffset`(분)을 더해 **한국시간**으로 그립니다. 한 종목의 `bars`에는 프리마켓부터 애프터마켓까지의 실제 봉이 모두 들어 있고, `reg`는 그 중 정규장 봉의 구간입니다. 화면은 두 시장의 최신 세션을 에폭 순서로 이어 붙여 하나의 통합 장(KST 단일 타임라인)으로 씁니다.

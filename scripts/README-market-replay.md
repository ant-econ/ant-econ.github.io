# 어제 장 실전 트레이딩 게임 — 데이터 파이프라인

`market-replay.html`은 `data/market-replay.json` 하나만 읽어서 동작합니다.
이 파일은 `scripts/update_replay.py`가 실제 시세로 만듭니다. (가짜·랜덤 데이터 없음)

## 데이터 출처

| 항목 | 출처 | 비고 |
| --- | --- | --- |
| 분봉(5분) 가격·거래량 | Yahoo Finance Chart API `v8/finance/chart/{티커}?interval=5m&range=1mo` | 정규장만(`includePrePost=false`), 시가·고가·저가·종가·거래량 그대로 |
| 일봉(시초가·종가) | 같은 API `interval=1d&range=3mo` | 일봉이 아직 게시되지 않은 날은 같은 날 5분봉으로 시가·종가 구성 |
| 원/달러 환율 | `USDKRW=X` 일봉 종가 | 미국 종목을 1,000만 원 계좌에서 원화로 환산할 때 사용 |

- 대상 종목: NVDA·TSLA·AAPL·MSFT·QQQ(미국), 005930.KS·000660.KS·035420.KS·005380.KS(국내)
- 시장별로 **최근 3거래일**을 보관합니다(`--keep`으로 변경).
- 정규장 시작 봉과 마지막 봉이 모두 있는 날만 싣습니다. 시초가 데이터가 비어 있는 날(야후 데이터 공백)은 게임의 "존버" 비교가 왜곡되므로 제외하고, 제외 사유를 JSON `notes`에 남깁니다.

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
  "generatedAt": "2026-11-25T00:10:00+09:00",
  "interval": "5m",
  "startCash": 10000000,
  "fees": { "KR": {"buy":0.00015,"sell":0.00015,"tax":0.0018},
            "US": {"buy":0.001,"sell":0.001,"tax":0} },
  "sessions": [
    { "id":"kr-2026-11-24", "market":"KR", "date":"2026-11-24",
      "tz":"Asia/Seoul", "tzOffset":540, "open":"09:00", "close":"15:30",
      "currency":"KRW", "fx":1,
      "symbols":[ { "sym":"005930.KS","name":"삼성전자","ex":"KOSPI",
                    "bars":[[epoch,o,h,l,c,v], ...],
                    "day":{"open":..,"high":..,"low":..,"close":..,"volume":..,"prevClose":..} } ] }
  ],
  "notes": []
}
```

`bars`의 시각은 UTC 에폭(초)이고, 화면 표시는 `tzOffset`(분)을 더해 그 시장의 현지 시각으로 그립니다.

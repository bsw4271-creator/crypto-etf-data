# crypto-etf-data

ChatGPT Sites의 ETF 트래커 자동 수집(2026-11-05 GPT Pro 종료로 중단 예정)을 대신하는 무료 수집기입니다.
GitHub Actions가 하루 2번(한국시간 10:17, 16:17) 아래 자료를 `data/`에 누적합니다.

| 자료 | 출처 | 파일 |
|---|---|---|
| 코인별 미국 현물 ETF 일별 순유입(합계) | CryptoETF.today API | `data/flows/{종목}.json` |
| XRP·LTC·NEAR 펀드별 순유입 | CryptoETF.today API | `data/funds/{종목}.json` |
| 코인 가격·유통 시가총액(UTC 00:00) | CoinGecko | `data/market/{종목}.json` |
| 마지막 실행 결과 | — | `data/status.json` |

대상 8종: BTC, ETH, SOL, XRP, HYPE, LTC, NEAR, ZEC (ADR-011).

## 원칙
- 핵심 지표는 **코인 유통 시가총액 대비 ETF 순유입**이며, 계산은 OS 쪽에서 합니다. 여기서는 원자료만 쌓습니다.
- 응답이 없거나 값이 `null`이면 미확인으로 남기고 **0으로 채우지 않습니다.** 이미 저장된 값을 `null`로 덮지 않습니다.
- 출처가 과거 값을 고치면 새 값으로 바꾸고 이전 값은 `revisions`에 남깁니다.
- 실패한 종목은 기존 자료를 그대로 두고 건너뜁니다.

## 필요한 Secret (값은 저장소 설정에만, 채팅·코드에 쓰지 않기)
- `CRYPTOETF_API_KEY` — 없으면 순유입 수집을 건너뜀
- `COINGECKO_DEMO_KEY` — 선택. 없으면 공개 한도로 천천히 수집

## 알려진 차이
기존 트래커는 BTC·ETH·SOL·HYPE·ZEC 유출입을 Farside 표에서, 나머지를 CryptoETF.today에서 받았습니다. 이 수집기는 8종 모두 CryptoETF.today를 씁니다. 두 출처의 값이 다를 수 있으니 과거 이력과 이어 붙일 때 출처를 구분합니다.

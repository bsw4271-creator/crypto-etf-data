# 기존 ETF 트래커 전체 이력 (ChatGPT Sites, 2026-11-03 12:37 UTC 내보내기)

`tracker-export-20261103.json` = 트래커 GET /api/v1/export 원본 그대로(수정 없음). 마지막 수집 auto-20261102T010546Z(completed).

| 종목 | 유출입 일수 | 기간 | 출처 |
|---|---:|---|---|
| BTC | 722 | 2024-01-11 ~ 2026-11-03 | Farside (펀드별) |
| ETH | 584 | 2024-07-23 ~ 2026-11-03 | Farside (펀드별) |
| SOL | 37 | 2026-09-14 ~ | Farside |
| HYPE | 37 | 2026-09-14 ~ | Farside |
| ZEC | 37 | 2026-09-14 ~ | Farside |
| XRP | 60 | 2026-09-01 ~ 2026-11-02 | CryptoETF.today (9일 미집계) |
| LTC | 44 | 2026-09-01 ~ | CryptoETF.today |
| NEAR | 25 | 2026-09-29 ~ | CryptoETF.today |

가격·유통 시총은 8종 각 212일(2026-04-05 ~ 2026-11-02, CoinGecko UTC 00:00), 운용사 공식 순자산(AUM) 192건.

주의: Farside 행 중 `reported: 0`인 날(예: 2026-11-03)은 아직 발표 전이라 `sourceTotal: 0`이어도 **순유입 0이 아니라 미확인**입니다. 이어 붙일 때 `reported > 0` 또는 `complete`인 행만 확정값으로 씁니다.

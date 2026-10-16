# 주소 매칭 개선 및 진단 (v15.2)

## 적용 내용
- 부산광역시 기본정보의 주소 필드를 공식 명세의 국문 정의에 맞춰 정규화했습니다. 해당 API 문서는 `jibunAddr`를 소재지도로명주소, `doroAddr`를 소재지지번주소로 적어 필드 이름의 일반적인 의미와 혼동될 수 있습니다. 코드는 API 문서의 국문 필드 설명에 맞춥니다.
- 시설공단/부산광역시 주차장 이름이 조금 다를 경우 정규화된 이름과 보수적인 유사도 점수로 매칭합니다.
- 이름 후보가 애매하면 잘못된 주소가 연결되지 않도록 매칭을 보류하고 실패 원인 및 상위 후보를 진단 응답에 기록합니다.
- 주소 매칭률과 최종 주소 보유율을 반환하는 `/api/parking-diagnostics` 엔드포인트를 추가했습니다. 이 엔드포인트는 실시간 주차 API(②)를 호출하지 않습니다.
- `mergeParkingData.js`가 부산시설공단 목록 자체에 주소/좌표가 있는 경우도 보존하도록 수정했습니다.
- 진단 요청에 `?refresh=1`을 붙이면 로컬/엣지 캐시를 우회해 원본 목록을 다시 가져오도록 요청합니다. API가 실패하면 캐시 데이터가 사용될 수도 있으므로 응답의 `stale` 필드를 확인하세요.

## 로컬에서 확인
프로젝트 루트에서 Wrangler Pages 개발 서버를 실행합니다.

```powershell
npx wrangler@4 pages dev . --port 8788
```

브라우저에서 진단 JSON을 엽니다.

```text
http://127.0.0.1:8788/api/parking-diagnostics
```

원본 갱신을 시도하려면:

```text
http://127.0.0.1:8788/api/parking-diagnostics?refresh=1
```

## 주요 결과 필드
- `summary.cityMatchRatePercent`: 시설공단 목록이 부산광역시 레코드에 매칭된 비율
- `summary.finalAddressCoveragePercent`: 최종 출력에 주소가 있는 비율(시설공단 목록 자체 주소 포함)
- `summary.failureReasons`: 매칭 실패 원인의 건수
- `unmatchedSamples`: 실패한 주차장, 상위 유사 후보/점수, 주소 예시 최대 25개
- `matchedButAddressMissingSamples`: 레코드는 매칭됐지만 주소가 없는 예시

## 해석 주의
- `best-candidate-below-threshold`는 유사한 이름이 있긴 하지만 안전한 자동 연결 점수에 미달한 경우입니다.
- `ambiguous-top-candidates`는 후보가 거의 같아 다른 주차장의 주소를 잘못 붙일 위험 때문에 매칭하지 않은 경우입니다. 이는 의도적인 안전장치입니다.
- `cityRecordsLoaded`보다 `cityRecordsReportedTotal`이 크면 부산광역시 목록 일부만 읽어온 것입니다.

## 공식 출처
부산광역시_공영주차장 정보 조회 API 명세: https://www.data.go.kr/data/15004683/openapi.do
부산시설공단_공영주차장 시설 현황 API 명세: https://www.data.go.kr/data/15157490/openapi.do

## 매칭 알고리즘 단위 테스트

프로젝트 루트에서 다음 명령을 실행할 수 있습니다.

```powershell
node tests/address-matching.test.mjs
```

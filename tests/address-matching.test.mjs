import assert from 'node:assert/strict';
import {
  matchCityBasicInfo,
  buildAddressMatchDiagnostics,
  getCandidateSamples
} from '../functions/lib/matchCityBasicInfo.js';

const city = [
  { parknm: '삼락채첨거리 공영주차장', managementNumber: 'C-1', address: '부산광역시 사상구 낙동대로 1', roadAddress: '부산광역시 사상구 낙동대로 1', lotAddress: '사상구 삼락동 1' },
  { parknm: '부산시청 공영주차장', managementNumber: 'C-2', address: '부산광역시 연제구 중앙대로 100', roadAddress: '부산광역시 연제구 중앙대로 100', lotAddress: '연제구 연산동 100' },
  { parknm: '부산시청 공영주차장', managementNumber: 'C-3', address: '부산광역시 연제구 중앙대로 101', roadAddress: '부산광역시 연제구 중앙대로 101', lotAddress: '연제구 연산동 101' }
];
const facilities = [
  { parkgcd: 'F-1', parknm: '삼락 채첨거리' },
  { parkgcd: 'F-2', parknm: '부산시청 공영주차장' },
  { parkgcd: 'F-3', parknm: '완전히 다른 장소' },
  { parkgcd: 'F-4' }
];
const matches = facilities.map(item => matchCityBasicInfo(item, city));
assert.equal(matches[0].matched, true, 'name with generic suffix/spacing should match');
assert.equal(matches[0].roadAddress, '부산광역시 사상구 낙동대로 1');
assert.equal(matches[1].failureReason, 'ambiguous-top-candidates', 'duplicate names must not be guessed');
assert.equal(matches[2].failureReason, 'no-similar-name-candidate');
assert.equal(matches[3].failureReason, 'facility-name-and-address-missing');
const stats = buildAddressMatchDiagnostics(facilities, city, matches);
assert.equal(stats.facilityRecords, 4);
assert.equal(stats.cityMatchedRecords, 1);
assert.equal(stats.cityMatchRatePercent, 25);
assert.equal(getCandidateSamples(facilities, matches, 25).length, 3);
const addressOnly = matchCityBasicInfo({ roadAddress: '부산광역시 사상구 낙동대로 1' }, city);
assert.equal(addressOnly.matched, true, 'exact address can match when a name is missing');
console.log('Address matching tests passed');

import assert from 'node:assert/strict';
import { cleanAddress, firstUsableAddress, getBusanDistrict, classifyAddressValues } from '../functions/lib/addressUtils.js';
import { matchCityBasicInfo, buildAddressMatchDiagnostics, getCandidateSamples } from '../functions/lib/matchCityBasicInfo.js';
import { mergeParkingData } from '../functions/lib/mergeParkingData.js';

assert.equal(cleanAddress('-'), '');
assert.equal(cleanAddress('해운대구'), '');
assert.equal(cleanAddress('부산광역시 해운대구'), '');
assert.equal(cleanAddress('부산광역시 해운대구 우동 123'), '부산광역시 해운대구 우동 123');
assert.equal(firstUsableAddress('-', '해운대구', '부산광역시 해운대구 우동 123'), '부산광역시 해운대구 우동 123');
assert.equal(getBusanDistrict('-', '해운대구'), '해운대구');
assert.equal(classifyAddressValues('-', '해운대구'), 'district-only');
assert.equal(classifyAddressValues('-', ''), 'placeholder-or-invalid');

const city = [
  { parknm: '장산역 공영주차장', address: '부산광역시 해운대구 좌동 100', roadAddress: '부산광역시 해운대구 좌동 100', lotAddress: '해운대구 좌동 100' },
  { parknm: '요트경기장 앞 공영주차장', address: '', roadAddress: '-', lotAddress: '해운대구', district: '해운대구', addressQuality: 'district-only' },
  { parknm: '수변공원 공영주차장', address: '부산광역시 수영구 민락동 10', roadAddress: '부산광역시 수영구 민락동 10' }
];

const stationMatch = matchCityBasicInfo({ parkgcd: 'A05', parknm: '장산역 2번' }, city);
assert.equal(stationMatch.matched, true, 'exit/section qualifiers should be considered as alternate name');
assert.equal(stationMatch.matchReason, 'matched-by-normalized-location-name');

const yachtMatch = matchCityBasicInfo({ parkgcd: 'A50', parknm: '요트경기장 앞 2구역(대형)' }, city);
assert.equal(yachtMatch.matched, true, 'a unique parent-lot candidate with section qualifiers should match');
assert.equal(yachtMatch.addressMatchStatus, 'district-only');
assert.equal(Boolean(yachtMatch.address), false, 'district-only record should not be reported as a full address');

const parkMatch = matchCityBasicInfo({ parkgcd: 'A03', parknm: '수변어린이공원' }, city);
assert.equal(parkMatch.matched, false, 'near-similar parks must not be auto-joined without strong evidence');
assert.ok(parkMatch.candidateSummary.length > 0, 'weak candidates should appear in diagnostics');
assert.equal(parkMatch.failureReason, 'best-candidate-below-threshold');

const stats = buildAddressMatchDiagnostics(
  [
    { parkgcd: 'A05', parknm: '장산역 2번' },
    { parkgcd: 'A50', parknm: '요트경기장 앞 2구역(대형)' },
    { parkgcd: 'A03', parknm: '수변어린이공원' }
  ],
  city,
  [stationMatch, yachtMatch, parkMatch]
);
assert.equal(stats.cityRecordsWithUsableAddress, 2);
assert.equal(stats.cityRecordsWithRawButUnusableAddress, 1);
assert.equal(stats.cityRecordsDistrictOnly, 1);
assert.equal(stats.addressAvailableAfterMerge, 1);
assert.equal(getCandidateSamples([{ parkgcd: 'A03', parknm: '수변어린이공원' }], [parkMatch], 25)[0].candidates.length > 0, true);

const merged = mergeParkingData({
  facility: { parkgcd: 'A50', parknm: '요트경기장 앞 2구역(대형)' },
  realtime: { available: true, maxcnt: 100, parkingcnt: 50, curravacnt: 50 },
  basic: yachtMatch
});
assert.equal(merged.address, '');
assert.equal(merged.addressQuality, 'district-only');
assert.equal(merged.addressDistrict, '해운대구');
console.log('Address quality and matching v15.3 tests passed');

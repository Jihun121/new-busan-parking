import assert from 'node:assert/strict';
import { matchCityBasicInfo } from '../functions/lib/matchCityBasicInfo.js';

const city = [
  { parknm: '도시철도 장산역 1번 공영주차장', roadAddress: '해운대구 장산로 101', addressQuality: 'full-address' },
  { parknm: '도시철도 장산역 2번 공영주차장', roadAddress: '해운대구 장산로 202', addressQuality: 'full-address' },
  { parknm: '도시철도 부산대역(북측)', roadAddress: '금정구 북측로 1', addressQuality: 'full-address' },
  { parknm: '도시철도 부산대역(남측)', roadAddress: '금정구 남측로 2', addressQuality: 'full-address' },
  { parknm: '도시철도 노포역', roadAddress: '금정구 청룡노포동 133', addressQuality: 'full-address' },
  { parknm: '국철 화명역 공영주차장', roadAddress: '북구 학사로 145', addressQuality: 'full-address' },
  { parknm: '대연고가도로 밑', roadAddress: '남구 대연로 10', addressQuality: 'full-address' },
  { parknm: '온천장북측공영주차장', roadAddress: '동래구 온천로 10', addressQuality: 'full-address' },
  { parknm: '도시철도 온천장역', roadAddress: '동래구 온천로 20', addressQuality: 'full-address' },
  { parknm: '동대신2동제1노상공영주차장', roadAddress: '서구 동대신동 100', addressQuality: 'full-address' }
];

function byName(name) {
  return matchCityBasicInfo({ parknm: name }, city);
}

const jangsan1 = byName('장산역 1번');
assert.equal(jangsan1.matched, true, 'prefix/suffix cleanup should match same station exit');
assert.equal(jangsan1.parknm, '도시철도 장산역 1번 공영주차장');

const jangsan2 = byName('장산역 2번');
assert.equal(jangsan2.matched, true, 'exit 2 should match the explicit exit 2 record');
assert.equal(jangsan2.parknm, '도시철도 장산역 2번 공영주차장');
assert.notEqual(jangsan2.parknm, '도시철도 장산역 1번 공영주차장');

const busanSouth = byName('부산대역(남측)');
assert.equal(busanSouth.matched, true, 'parenthesized side qualifier should be preserved');
assert.equal(busanSouth.parknm, '도시철도 부산대역(남측)');
const busanNorth = byName('부산대역(북측)');
assert.equal(busanNorth.matched, true);
assert.equal(busanNorth.parknm, '도시철도 부산대역(북측)');

const genericBusanStation = byName('부산대역');
assert.equal(genericBusanStation.matched, false, 'generic station name must not arbitrarily choose north/south');
assert.equal(genericBusanStation.failureReason, 'location-qualifier-specificity-mismatch');

assert.equal(byName('노포역').matched, true, 'generic transit prefix should not prevent a strong match');
assert.equal(byName('화명역').matched, true, 'national rail prefix should not prevent a strong match');
assert.equal(byName('대연고가밑').matched, true, 'known overpass-underpass alias should match');

const oncheonSouth = byName('온천장역(남측)');
assert.equal(oncheonSouth.matched, false, 'south side must not attach to north or generic station record');
assert.ok(['location-qualifier-conflict', 'location-qualifier-specificity-mismatch'].includes(oncheonSouth.failureReason));

const dongdaesin = byName('동대신동');
assert.equal(dongdaesin.matched, false, 'generic neighborhood name must not attach to one numbered dong parking lot');

console.log('Address matching qualifier tests v15.4 passed');

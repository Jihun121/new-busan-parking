/**
 * 주차장 기본정보를 하나의 공통 형태로 만드는 모듈입니다.
 *
 * 현재 목록 API가 반환하는 기본 필드를 우선 보존합니다.
 * 추후 별도의 기본정보 API가 필요해지면 이 파일에서만 확장하면 됩니다.
 */
export async function fetchBasicInfo({ serviceKey, parking }) {
    void serviceKey;

    return {
        ...parking,
        parkgcd: parking?.parkgcd ?? null,
        parknm: parking?.parknm ?? ""
    };
}

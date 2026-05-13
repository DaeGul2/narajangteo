// 공고명 기반 실제 직원채용 여부 분류 — Python 버전과 동일 패턴

const EXCLUDE_PATTERNS = [
  [/채용\s*전산\s*시스템/, '채용 시스템'],
  [/채용\s*시스템/, '채용 시스템'],
  [/채용시스템/, '채용 시스템'],
  [/채용\s*박람회/, '박람회'],
  [/채용박람회/, '박람회'],
  [/취업.*채용.*박람회/, '박람회'],
  [/외국인.*취업.*채용/, '박람회'],
  [/채용연계형/, '경진대회/연계행사'],
  [/채용자\s*교육/, '신규자 교육'],
  [/신규\s*채용자\s*교육/, '신규자 교육'],
  [/채용에\s*대한\s*조사/, '조사 용역'],
  [/AI.*채용.*조사/, '조사 용역'],
  [/채용\s*접수관리/, '시스템 운영'],
  [/통합역량검사/, '시스템 임대'],
  [/채용\s*활성화.*프로젝트/, '홍보/캠페인'],
  [/채용\s*및\s*통합역량검사/, '시스템 임대'],
  [/온라인\s*채용.*시스템/, '시스템 임대'],
];

export function classify(name) {
  if (!name) return { isRecruitment: false, reason: '공고명 없음' };
  for (const [pat, reason] of EXCLUDE_PATTERNS) {
    if (pat.test(name)) return { isRecruitment: false, reason };
  }
  if (name.includes('채용')) return { isRecruitment: true, reason: '직접/대행 채용' };
  return { isRecruitment: false, reason: '해당 없음' };
}

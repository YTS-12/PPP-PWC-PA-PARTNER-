// 공시검색(list.json) 공통: corp_code 없이 기간·유형·시장으로 모든 페이지를 받는다
import { baseTitle, log, parseYmd, today, ymd } from '../lib/common.mjs';
import { DartFatal } from '../lib/dart.mjs';

/**
 * major·krx 공통: 조회 종료일(--end, 기본 오늘)을 확인하고 크게 보여 준다. main 안에서 부른다(잘못된 값은 DartFatal).
 * 조회 구간이 종료일로 정해지고 캐시 이름에 구간이 들어가서, 다음 날 이어받을 때도 같은 --end 를 줘야 캐시를 쓴다.
 * 실패·중단으로 끝나면(runCollector 가 이유를 찍은 뒤) 같은 종료일로 다시 실행하는 명령을 덧붙인다.
 */
export function checkEnd(end, command) {
  const now = today();
  if (!/^\d{8}$/.test(end || '') || ymd(parseYmd(end)) !== end) {
    throw new DartFatal(`--end 는 YYYYMMDD 형식의 날짜로 주세요(받은 값: ${end}). 예) npm run ${command} -- --end ${now}`);
  }
  if (end > now) throw new DartFatal(`--end(${end})가 오늘(${now})보다 뒤예요. 첫 실행일이나 오늘 날짜를 주세요.`);
  const again = `npm run ${command} -- --end ${end}`;
  const bar = '='.repeat(64);
  log(bar);
  log(`  조회 종료일 ${end}${end === now ? ' (오늘)' : ''}`);
  log(`  다음 날 이어받을 때도 같은 종료일을 주세요: ${again}`);
  log('  종료일이 바뀌면 조회 구간이 달라져 받은 응답 캐시를 못 쓰고 처음부터 다시 호출해요.');
  log(bar);
  process.on('exit', (code) => {
    if (code !== 0) {
      console.error(`다시 실행: ${again}`);
      console.error(`  다음 날 이어받아도 같은 --end ${end} 를 줘야 받은 응답 캐시를 써요(옵션 없이 실행하면 종료일이 그날로 바뀌어요).`);
    }
  });
}

/**
 * opts: { dart, bgn, end, type (pblntf_ty, 없으면 전체), cls ('Y'|'K'), tag }
 * 반환: 공시 목록 배열
 */
export async function searchAll({ dart, bgn, end, type, cls, tag }) {
  const rows = [];
  let page = 1;
  let totalPage = 1;
  do {
    const params = {
      bgn_de: bgn,
      end_de: end,
      corp_cls: cls,
      last_reprt_at: 'Y',
      page_no: String(page),
      page_count: '100',
    };
    if (type) params.pblntf_ty = type;
    const json = await dart.call('list.json', params, `${tag}_${type || 'ALL'}_${cls}_${bgn}_${end}_p${page}`);
    if (json.status === '013') break;
    if (json.status !== '000') {
      // 000·013 이 아닌 응답은 dart.mjs 가 issues 에 남긴다 → 수집 스크립트가 저장 직전 assertNoIssues 로 멈춘다.
      // 이 구간의 남은 쪽은 건너뛰고 나머지 구간은 계속 훑어, 끝에 이상 응답을 한꺼번에 보여 준다.
      log(
        `  경고: ${bgn}~${end} ${cls} ${page}쪽 응답 ${json.status ?? '상태 없음'} ${json.message || ''} → 이 구간 남은 쪽 건너뜀, ` +
          '결과는 저장 전 중단됨. 다시 실행하면 이 구간의 이 쪽부터 다시 받아요.',
      );
      break;
    }
    rows.push(...(Array.isArray(json.list) ? json.list : []));
    // total_page 가 숫자가 아니면(빈 값·문자 등) 1쪽으로 본다
    const tp = Number(json.total_page);
    totalPage = Number.isFinite(tp) && tp >= 1 ? Math.floor(tp) : 1;
    page++;
  } while (page <= totalPage);
  return rows;
}

// 거래소 시장조치(결정 E4): 거래소공시(I) 제목으로 고른다. 공백·맨 앞 대괄호 머리말([기재정정] 등)을 지운 제목에서 본다.
// 넣는 것: 상장적격성 실질심사(대상 결정·대상(사유발생)·사유 발생·사유 추가), 상장폐지 사유 발생·추가, 관리종목 지정·지정사유 발생·추가,
//   내부결산시점 관리종목지정·형식적상장폐지·상장적격성실질심사 사유발생, 반기검토(감사)의견 부적정 등 사실확인, 매매거래정지(중요한 영업정지).
// '내부결산'(2026-10-06 결정 E): 제목에 '내부결산'이 있으면 회사가 감사 전 내부결산 기준으로 낸 공시라 관리종목보다 먼저 보아 mkt '내부결산'
//   (화면 표시 '내부결산 기준 사유 발생(감사 전)'). RS1 근거로는 그대로 쓴다(E4). 정정공시 본문에 사유 해소 문구가 있으면
//   collect:corrections 가 withdrawn('사유 해소')으로 남겨 data:build 가 뺀다(결정 B).
// '중요한영업정지'(결정 C): 영업정지 공시에 따라 그날 자동으로 걸리는 정지(코스닥시장공시규정 제37조)라 독립된 거래소 확인이 아니다.
//   분류는 그대로 두어 근거 공시 목록에 남기고, RS1 근거·영업정지 예외 조건에서 빼는 것은 data:build 가 한다.
// 빼는 것(MARKET_EXCLUDE): 우려·해제·해소·미진행·미해당·면제·자율공시·개선계획·제외(실질심사 대상 제외 결정). 실질심사 '대상결정 기한 안내'도 뺀다.
//   '상장폐지 관련'·'실질심사 관련 안내'·'조사기간 연장'·'개선기간'·'상장폐지 결정'·'자본잠식 50% 이상 사실발생'처럼 E4 목록에 없는 제목은 넣지 않는다
//   (collect:krx 가 '규칙 밖 후보'로 건수를 보여 준다).
export const MARKET_EXCLUDE = /우려|해제|해소|미진행|미해당|면제|자율공시|개선계획|제외/;
const MARKET_RULES = [
  ['반기부적정', /반기검토(\(감사\))?의견부적정/],
  ['중요한영업정지', /매매거래정지\(?중요한영업정지/],
  // 내부결산 시점 공시(감사 전): 제목에 관리종목·실질심사·상장폐지가 함께 있어도 관리종목보다 먼저 본다
  ['내부결산', /내부결산/],
  ['관리종목', /관리종목지정(사유(발생|추가))?(?!우려)/],
  ['실질심사', /실질심사(대상\(?사유발생|대상결정(?!기한)|사유(추가)?발생|사유추가)/],
  ['상장폐지사유', /상장폐지사유(발생|추가)/],
];
/** 시장조치 종류 이름(로그·확인용, MARKET_RULES 순서) */
export const MARKET_KINDS = MARKET_RULES.map(([k]) => k);
/** 거래소공시 제목 → 시장조치 종류('실질심사'·'상장폐지사유'·'관리종목'·'내부결산'·'반기부적정'·'중요한영업정지') 또는 null */
export function marketKind(reportNm) {
  const t = baseTitle(reportNm);
  if (MARKET_EXCLUDE.test(t)) return null;
  for (const [kind, re] of MARKET_RULES) if (re.test(t)) return kind;
  return null;
}
/** 시장조치 후보처럼 보이지만 규칙에 안 맞는 제목(확인용 출력) */
export const looksMarket = (reportNm) => /실질심사|상장폐지|관리종목|부적정|중요한영업정지|내부결산/.test(baseTitle(reportNm));
/** 시장조치 종류별 건수 한 줄('관리종목 12 · 내부결산 30 · …', MARKET_RULES 순서, 0건은 뺌). rows 는 mkt 가 든 행 */
export function marketKindCounts(rows) {
  const by = new Map();
  for (const r of rows || []) if (r && r.mkt) by.set(r.mkt, (by.get(r.mkt) || 0) + 1);
  const order = [...MARKET_KINDS, ...[...by.keys()].filter((k) => !MARKET_KINDS.includes(k))];
  return order.filter((k) => by.get(k)).map((k) => `${k} ${by.get(k)}`).join(' · ') || '없음';
}

export function toFiling(r, extra = {}) {
  return {
    rcept_no: r.rcept_no,
    corp_code: r.corp_code,
    corp_name: r.corp_name,
    report_nm: r.report_nm,
    rcept_dt: r.rcept_dt,
    rm: r.rm || '',
    ...extra,
  };
}

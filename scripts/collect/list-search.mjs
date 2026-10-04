// 공시검색(list.json) 공통: corp_code 없이 기간·유형·시장으로 모든 페이지를 받는다
import { log, parseYmd, today, ymd } from '../lib/common.mjs';
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

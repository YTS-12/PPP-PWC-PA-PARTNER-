// 공시검색(list.json) 공통: corp_code 없이 기간·유형·시장으로 모든 페이지를 받는다
import { log } from '../lib/common.mjs';

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
      log(`  경고: ${bgn}~${end} ${cls} ${page}쪽 응답 ${json.status} ${json.message || ''}`);
      break;
    }
    rows.push(...(json.list || []));
    totalPage = Number(json.total_page || 1);
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

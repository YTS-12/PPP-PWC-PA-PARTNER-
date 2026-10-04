// Supabase Free는 7일 동안 활동이 없으면 프로젝트를 멈춘다.
// Vercel Cron이 하루 한 번 이 경로를 불러 가벼운 조회로 활동을 만든다 (vercel.json 참고).
// 실패는 200이 아닌 코드로 돌려줘 성공과 바로 구분한다: 401 헤더 불일치, 503 환경변수 없음, 502 Supabase 실패.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // 배포 환경(Vercel)에서 CRON_SECRET이 빠지면 누구나 부를 수 있으므로 막는다. 로컬은 없어도 된다.
  if (!secret && process.env.VERCEL) {
    return Response.json({ ok: false, reason: 'CRON_SECRET 환경변수가 없어요.' }, { status: 503 });
  }
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return Response.json({ ok: false, reason: 'Supabase 환경변수가 없어요.' }, { status: 503 });
  }
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/profiles?select=user_id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
  } catch {
    // 주소 오타·DNS·연결 실패. 키가 섞일 수 있어 오류 원문은 돌려주지 않는다.
    return Response.json({ ok: false, reason: 'Supabase에 연결하지 못했어요.' }, { status: 502 });
  }
  if (!res.ok) {
    return Response.json({ ok: false, status: res.status }, { status: 502 });
  }
  return Response.json({ ok: true, status: res.status, at: new Date().toISOString() });
}

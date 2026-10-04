// Supabase Free는 7일 동안 활동이 없으면 프로젝트를 멈춘다.
// Vercel Cron이 하루 한 번 이 경로를 불러 가벼운 조회로 활동을 만든다 (vercel.json 참고).
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return Response.json({ ok: false, reason: 'Supabase 환경변수가 없어요.' });
  }
  const res = await fetch(`${url}/rest/v1/profiles?select=user_id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  return Response.json({ ok: res.ok, status: res.status, at: new Date().toISOString() });
}

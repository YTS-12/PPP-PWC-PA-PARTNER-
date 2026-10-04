'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getSupabase, supabaseConfigured } from './supabase';
import { defaultFilters, normalizeFilters } from './config';
import type { Filters, Profile, ShortItem, Status } from './types';

type Mode = 'guest' | 'user' | null;

interface Personal {
  profile: Profile;
  savedFilters: Filters | null;
  shortlist: Record<string, ShortItem>;
  memos: Record<string, string>;
}

const EMPTY: Personal = {
  profile: { display_name: '', team: '', memo_sign: '' },
  savedFilters: null,
  shortlist: {},
  memos: {},
};

interface LoginResult {
  ok: boolean;
  created?: boolean;
  message?: string;
}

interface AppState {
  ready: boolean;
  mode: Mode;
  email: string | null;
  supabaseReady: boolean;
  personal: Personal;
  filters: Filters;
  setFilters: (f: Filters) => void;
  enterGuest: () => void;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  toggleShortlist: (corp: string) => void;
  setStatus: (corp: string, status: Status) => void;
  saveMemo: (corp: string, text: string) => Promise<void>;
  saveProfile: (p: Profile) => Promise<void>;
  saveDefaultFilters: (f: Filters) => Promise<void>;
  resetDefaultFilters: () => Promise<void>;
  clearAll: () => Promise<void>;
  notify: (msg: string) => void;
  displayName: string;
}

const Ctx = createContext<AppState | null>(null);
const MODE_KEY = 'pa_mode';

function friendly(err: { message?: string; code?: string; status?: number } | null | undefined): string {
  const m = (err?.message || '').toLowerCase();
  if (err?.status === 429 || m.includes('rate limit') || err?.code === 'over_request_rate_limit') {
    return '요청이 많아 잠시 막혔어요. 잠시 후 다시 시도하거나 로그인 없이 둘러보기를 이용해 주세요.';
  }
  if (err?.code === 'weak_password' || m.includes('password should')) return '비밀번호가 너무 짧거나 약해요. 8자 이상으로 입력해 주세요.';
  if (err?.code === 'email_address_invalid' || m.includes('invalid email')) return '이메일 형식을 확인해 주세요.';
  return `로그인하지 못했어요. 잠시 후 다시 시도해 주세요. (${err?.message || '알 수 없는 오류'})`;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [personal, setPersonal] = useState<Personal>(EMPTY);
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const loadPersonal = useCallback(async (uid: string) => {
    const sb = getSupabase();
    if (!sb) return;
    const [p, f, s, m] = await Promise.all([
      sb.from('profiles').select('display_name,team,memo_sign').maybeSingle(),
      sb.from('user_filters').select('filters').maybeSingle(),
      sb.from('shortlist').select('corp_code,status,saved_at'),
      sb.from('memos').select('corp_code,body'),
    ]);
    const err = p.error || f.error || s.error || m.error;
    if (err) notify(`저장된 내용을 불러오지 못했어요: ${err.message} (Supabase 테이블을 만들었는지 확인해 주세요)`);
    const shortlist: Record<string, ShortItem> = {};
    for (const r of (s.data || []) as { corp_code: string; status: Status; saved_at: string }[]) {
      shortlist[r.corp_code] = { status: r.status, saved_at: (r.saved_at || '').slice(0, 10) };
    }
    const memos: Record<string, string> = {};
    for (const r of (m.data || []) as { corp_code: string; body: string }[]) memos[r.corp_code] = r.body;
    const savedFilters = f.data ? normalizeFilters((f.data as { filters: Filters }).filters) : null;
    setPersonal({
      profile: {
        display_name: p.data?.display_name || '',
        team: p.data?.team || '',
        memo_sign: p.data?.memo_sign || '',
      },
      savedFilters,
      shortlist,
      memos,
    });
    if (savedFilters) setFilters(savedFilters);
    void uid;
  }, [notify]);

  // 처음 열 때: Supabase 세션이 있으면 로그인 상태, 없으면 탭에 남은 게스트 표시를 따른다
  useEffect(() => {
    let alive = true;
    (async () => {
      const sb = getSupabase();
      if (sb) {
        const { data } = await sb.auth.getSession();
        const u = data.session?.user;
        if (u && alive) {
          setMode('user');
          setEmail(u.email || null);
          setUserId(u.id);
          await loadPersonal(u.id);
          if (alive) setReady(true);
          return;
        }
      }
      try {
        if (sessionStorage.getItem(MODE_KEY) === 'guest' && alive) setMode('guest');
      } catch {
        /* 저장소를 쓸 수 없는 환경 */
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [loadPersonal]);

  const enterGuest = useCallback(() => {
    setMode('guest');
    setEmail(null);
    setUserId(null);
    setPersonal(EMPTY);
    setFilters(defaultFilters());
    try {
      sessionStorage.setItem(MODE_KEY, 'guest');
    } catch {
      /* 무시 */
    }
  }, []);

  const login = useCallback(
    async (mail: string, password: string): Promise<LoginResult> => {
      const sb = getSupabase();
      if (!sb) return { ok: false, message: '로그인 설정 전이에요(Supabase 키 미입력). 로그인 없이 둘러보기를 이용해 주세요.' };
      const after = async (u: { id: string; email?: string | null }) => {
        setMode('user');
        setEmail(u.email || mail);
        setUserId(u.id);
        try {
          sessionStorage.setItem(MODE_KEY, 'user');
        } catch {
          /* 무시 */
        }
        await loadPersonal(u.id);
      };
      const si = await sb.auth.signInWithPassword({ email: mail, password });
      if (!si.error && si.data.user) {
        await after(si.data.user);
        return { ok: true };
      }
      const invalid =
        si.error && (si.error.code === 'invalid_credentials' || /invalid login credentials/i.test(si.error.message));
      if (!invalid) return { ok: false, message: friendly(si.error) };
      // 처음 쓰는 이메일이면 그 자리에서 계정을 만든다 (이메일 인증 끔)
      const su = await sb.auth.signUp({ email: mail, password });
      if (su.error) {
        if (su.error.code === 'user_already_exists' || /already registered/i.test(su.error.message)) {
          return { ok: false, message: '비밀번호가 맞지 않아요. 처음 쓰는 이메일이라면 다른 이메일로 시작해 주세요.' };
        }
        return { ok: false, message: friendly(su.error) };
      }
      if (!su.data.session || !su.data.user) {
        return { ok: false, message: 'Supabase에서 이메일 인증(Confirm email)이 켜져 있어요. 꺼야 바로 시작할 수 있어요.' };
      }
      await after(su.data.user);
      return { ok: true, created: true };
    },
    [loadPersonal],
  );

  const logout = useCallback(async () => {
    const sb = getSupabase();
    if (sb && mode === 'user') await sb.auth.signOut();
    setMode(null);
    setEmail(null);
    setUserId(null);
    setPersonal(EMPTY);
    setFilters(defaultFilters());
    try {
      sessionStorage.removeItem(MODE_KEY);
    } catch {
      /* 무시 */
    }
  }, [mode]);

  const isUser = mode === 'user' && !!userId;

  const toggleShortlist = useCallback(
    (corp: string) => {
      const exists = !!personal.shortlist[corp];
      setPersonal((p) => {
        const next = { ...p.shortlist };
        if (exists) delete next[corp];
        else next[corp] = { status: '검토 전', saved_at: new Date().toISOString().slice(0, 10) };
        return { ...p, shortlist: next };
      });
      if (isUser) {
        const sb = getSupabase()!;
        const q = exists
          ? sb.from('shortlist').delete().eq('user_id', userId!).eq('corp_code', corp)
          : sb.from('shortlist').upsert({ user_id: userId, corp_code: corp, status: '검토 전' });
        q.then(({ error }) => error && notify(`저장하지 못했어요: ${error.message}`));
        notify(exists ? '후보에서 뺐어요.' : '제안 후보에 저장했어요.');
      } else {
        notify(exists ? '후보에서 뺐어요.' : '후보에 담았어요. 게스트 모드라 새로고침하면 사라져요. 로그인하면 저장돼요.');
      }
    },
    [personal.shortlist, isUser, userId, notify],
  );

  const setStatus = useCallback(
    (corp: string, status: Status) => {
      setPersonal((p) => ({ ...p, shortlist: { ...p.shortlist, [corp]: { ...p.shortlist[corp], status } } }));
      if (isUser) {
        getSupabase()!
          .from('shortlist')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('user_id', userId!)
          .eq('corp_code', corp)
          .then(({ error }) => error && notify(`저장하지 못했어요: ${error.message}`));
      }
      notify(`상태를 '${status}'(으)로 바꿨어요.`);
    },
    [isUser, userId, notify],
  );

  const saveMemo = useCallback(
    async (corp: string, text: string) => {
      const body = text.trim().slice(0, 200);
      setPersonal((p) => {
        const memos = { ...p.memos };
        if (body) memos[corp] = body;
        else delete memos[corp];
        return { ...p, memos };
      });
      if (!isUser) {
        notify('게스트 모드라 이 화면에서만 유지돼요. 로그인하면 저장돼요.');
        return;
      }
      const sb = getSupabase()!;
      const { error } = body
        ? await sb.from('memos').upsert({ user_id: userId, corp_code: corp, body, updated_at: new Date().toISOString() })
        : await sb.from('memos').delete().eq('user_id', userId!).eq('corp_code', corp);
      notify(error ? `저장하지 못했어요: ${error.message}` : '메모를 내 계정에 저장했어요.');
    },
    [isUser, userId, notify],
  );

  const saveProfile = useCallback(
    async (profile: Profile) => {
      if (!isUser) {
        notify('로그인하면 프로필을 저장할 수 있어요.');
        return;
      }
      setPersonal((p) => ({ ...p, profile }));
      const { error } = await getSupabase()!
        .from('profiles')
        .upsert({ user_id: userId, ...profile, updated_at: new Date().toISOString() });
      notify(error ? `저장하지 못했어요: ${error.message}` : '프로필을 저장했어요.');
    },
    [isUser, userId, notify],
  );

  const saveDefaultFilters = useCallback(
    async (f: Filters) => {
      if (!isUser) {
        notify('로그인하면 이 조건을 기본값으로 저장해 다음에도 바로 쓸 수 있어요.');
        return;
      }
      const saved = { ...f, query: '' };
      setPersonal((p) => ({ ...p, savedFilters: saved }));
      const { error } = await getSupabase()!
        .from('user_filters')
        .upsert({ user_id: userId, filters: saved, updated_at: new Date().toISOString() });
      notify(error ? `저장하지 못했어요: ${error.message}` : '내 기본 조건으로 저장했어요. 다음 로그인부터 자동으로 적용돼요.');
    },
    [isUser, userId, notify],
  );

  const resetDefaultFilters = useCallback(async () => {
    if (!isUser) {
      notify('로그인 후 사용할 수 있어요.');
      return;
    }
    setPersonal((p) => ({ ...p, savedFilters: null }));
    setFilters(defaultFilters());
    const { error } = await getSupabase()!.from('user_filters').delete().eq('user_id', userId!);
    notify(error ? `초기화하지 못했어요: ${error.message}` : '기본 조건을 초기화했어요.');
  }, [isUser, userId, notify]);

  const clearAll = useCallback(async () => {
    setPersonal(EMPTY);
    setFilters(defaultFilters());
    if (!isUser) {
      notify('이 화면의 후보·메모를 지웠어요.');
      return;
    }
    const sb = getSupabase()!;
    const results = await Promise.all(
      ['shortlist', 'memos', 'user_filters', 'profiles'].map((t) => sb.from(t).delete().eq('user_id', userId!)),
    );
    const err = results.find((r) => r.error)?.error;
    notify(err ? `일부를 지우지 못했어요: ${err.message}` : '내 저장 데이터를 모두 지웠어요.');
  }, [isUser, userId, notify]);

  const displayName = mode === 'user' ? personal.profile.display_name || (email || '').split('@')[0] : '게스트';

  const value = useMemo<AppState>(
    () => ({
      ready,
      mode,
      email,
      supabaseReady: supabaseConfigured,
      personal,
      filters,
      setFilters,
      enterGuest,
      login,
      logout,
      toggleShortlist,
      setStatus,
      saveMemo,
      saveProfile,
      saveDefaultFilters,
      resetDefaultFilters,
      clearAll,
      notify,
      displayName,
    }),
    [ready, mode, email, personal, filters, enterGuest, login, logout, toggleShortlist, setStatus, saveMemo, saveProfile, saveDefaultFilters, resetDefaultFilters, clearAll, notify, displayName],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppStateProvider 안에서만 쓸 수 있어요.');
  return v;
}

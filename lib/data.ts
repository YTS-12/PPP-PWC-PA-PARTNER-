'use client';
import { useEffect, useState } from 'react';
import type { CompanyDetail, Summary } from './types';

let summaryPromise: Promise<Summary> | null = null;

export function loadSummary(): Promise<Summary> {
  if (!summaryPromise) {
    summaryPromise = fetch('/data/summary.json').then((r) => {
      if (!r.ok) throw new Error('summary.json을 불러오지 못했어요. npm run data:build를 먼저 실행해 주세요.');
      return r.json();
    });
    summaryPromise.catch(() => {
      summaryPromise = null;
    });
  }
  return summaryPromise;
}

const detailBuckets = new Map<string, Promise<Record<string, CompanyDetail>>>();

export async function loadDetail(corp: string): Promise<CompanyDetail | null> {
  const bucket = corp.slice(-2);
  if (!detailBuckets.has(bucket)) {
    const p = fetch(`/data/detail/${bucket}.json`).then((r) => (r.ok ? r.json() : {}));
    detailBuckets.set(bucket, p);
  }
  const all = await detailBuckets.get(bucket)!;
  return all[corp] || null;
}

export function useSummary() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadSummary()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, []);
  return { data, error };
}

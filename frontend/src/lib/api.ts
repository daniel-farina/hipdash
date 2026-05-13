export async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin', ...init });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return (await r.json()) as T;
}

export async function postJson<T = any>(url: string, body?: any): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return (await r.json()) as T;
}

export type Status = {
  mtplx_alive: boolean;
  sidecar_alive: boolean;
  last_mtplx_seen: number;
  last_sidecar_seen: number;
  last_health: any;
  mtplx_signature: string | null;
  sidecar_signature: string | null;
};

export type Restart = {
  id: number;
  ts: number;
  target: string;
  detail: any;
};

export type MetricPoint = {
  ts: number;
  value: number;
  extra?: any;
};

export type RequestRow = {
  id: number;
  ts: number;
  request_id: string | null;
  session_id: string | null;
  mode: string | null;
  prompt: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  decode_tok_s: number | null;
  prefill_tok_s: number | null;
  ttft_s: number | null;
  wall_s: number | null;
};

export type Run = {
  run_id: number;
  target: string;
  start_ts: number;
  end_ts: number | null;
  is_current: boolean;
  detail: any;
  request_count: number;
  first_request_ts: number | null;
  last_request_ts: number | null;
  avg_decode_tok_s: number | null;
};

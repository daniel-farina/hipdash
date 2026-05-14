// Per-tool category color. Known tool families get hand-picked tones; anything
// unknown falls back to a deterministic hash → palette mapping so distinct
// tools always render with distinct colors and the same tool reads the same
// color across sessions.

type Tone = { background: string; borderColor: string; color: string };

function tone(rgb: string, alpha: number, text: string): Tone {
  return {
    background: `rgba(${rgb}, ${alpha * 0.15})`,
    borderColor: `rgba(${rgb}, ${alpha * 0.5})`,
    color: text,
  };
}

const READ      = tone('111,214,224', 1, '#cdf2f6'); // cyan
const SEARCH    = tone('132,169,255', 1, '#cfe0ff'); // blue
const EDIT      = tone('126,217,87',  1, '#d8f3c8'); // green
const SHELL     = tone('244,201,93',  1, '#ffe7c4'); // amber
const BG        = tone('255,177,108', 1, '#ffdcc4'); // orange — async/background
const DANGER    = tone('244,114,114', 1, '#ffd2d2'); // red — destructive
const TASK      = tone('201,134,255', 1, '#e9d5ff'); // purple — tasks / agents
const SCHEDULE  = tone('169,169,255', 1, '#d8d8ff'); // lavender — cron/schedule
const WEB       = tone('255,155,210', 1, '#ffd8ec'); // pink
const META      = tone('102,224,163', 1, '#cdf3df'); // mint — meta / lsp
const USER      = tone('244,201,93',  1, '#ffe7c4'); // amber too — user interaction

// Exact name → tone (case-insensitive). Order doesn't matter, lookup is O(1).
const EXACT: Record<string, Tone> = {
  // file reads
  read: READ, readfile: READ, view: READ, cat: READ,
  // search
  grep: SEARCH, glob: SEARCH, list: SEARCH, ls: SEARCH, find: SEARCH,
  toolsearch: SEARCH,
  // edits
  edit: EDIT, write: EDIT, patch: EDIT, multiedit: EDIT, notebookedit: EDIT,
  applypatch: EDIT, replace: EDIT,
  // shell
  bash: SHELL, shell: SHELL, exec: SHELL, run: SHELL,
  // destructive
  killshell: DANGER, kill: DANGER, remove: DANGER, rm: DANGER, delete: DANGER,
  // task / agent
  task: TASK, taskcreate: TASK, taskupdate: TASK, tasklist: TASK,
  taskget: TASK, taskstop: TASK, taskoutput: TASK, agent: TASK, subagent: TASK,
  spawnagent: TASK, dispatch_agent: TASK,
  // schedule / background
  schedule: SCHEDULE, schedulewakeup: SCHEDULE,
  croncreate: SCHEDULE, cronlist: SCHEDULE, crondelete: SCHEDULE,
  remotetrigger: BG, pushnotification: BG, monitor: BG,
  // web
  webfetch: WEB, websearch: WEB, fetch: WEB,
  // user interaction / planning
  askuserquestion: USER, askuser: USER,
  exitplanmode: META, enterplanmode: META, enterworktree: META, exitworktree: META,
  // meta / language servers
  lsp: META, skill: META,
};

// Heuristic substring buckets used when an exact match isn't found.
const SUBSTRINGS: { match: string[]; tone: Tone }[] = [
  { match: ['task', 'agent'],                    tone: TASK },
  { match: ['schedule', 'cron', 'wakeup'],       tone: SCHEDULE },
  { match: ['background', 'bg_', 'async'],       tone: BG },
  { match: ['edit', 'write', 'patch', 'mutate'], tone: EDIT },
  { match: ['read', 'get', 'view', 'fetch_file'],tone: READ },
  { match: ['grep', 'glob', 'search', 'find', 'list'], tone: SEARCH },
  { match: ['bash', 'shell', 'exec', 'run_cmd'], tone: SHELL },
  { match: ['kill', 'remove', 'delete', 'drop'], tone: DANGER },
  { match: ['web', 'http', 'curl', 'fetch'],     tone: WEB },
  { match: ['ask', 'question', 'plan', 'mode'],  tone: USER },
];

// Distinct fallback palette for tools that don't match any known family —
// hashed so the same tool name always lands on the same color.
const HASH_PALETTE = ['126,217,87', '132,169,255', '244,201,93', '201,134,255', '111,214,224', '255,155,210', '102,224,163', '244,114,114', '255,177,108', '169,169,255'];
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function toolColor(name: string): Tone {
  const key = (name || '').toLowerCase().trim();
  if (!key) {
    return { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.18)', color: 'rgba(239,239,233,0.7)' };
  }
  const exact = EXACT[key];
  if (exact) return exact;
  for (const { match, tone } of SUBSTRINGS) {
    if (match.some((m) => key.includes(m))) return tone;
  }
  const rgb = HASH_PALETTE[hashStr(key) % HASH_PALETTE.length];
  return tone(rgb, 1, `rgba(${rgb}, 1)`);
}

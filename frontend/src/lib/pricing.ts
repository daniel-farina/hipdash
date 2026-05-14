// Per-million-token list prices for the "what would this have cost in the
// cloud" comparison. Numbers are rounded to the published list prices for
// each provider, no volume / cache / batch discounts applied.
//
// "saved" = sum(prompt_tokens) * input + sum(completion_tokens) * output.
// Running locally on MTPLX, the marginal cost is electricity, not tokens.

export type ModelPricing = {
  id: string;
  label: string;
  vendor: string;
  // $ per million tokens
  input: number;
  output: number;
  tier?: 'premium' | 'mid' | 'budget' | 'open';
};

export const MODELS: ModelPricing[] = [
  { id: 'opus-4-7',    label: 'Claude Opus 4.7',     vendor: 'Anthropic', input: 15.00, output: 75.00, tier: 'premium' },
  { id: 'sonnet-4-6',  label: 'Claude Sonnet 4.6',   vendor: 'Anthropic', input:  3.00, output: 15.00, tier: 'mid'     },
  { id: 'haiku-4-5',   label: 'Claude Haiku 4.5',    vendor: 'Anthropic', input:  0.80, output:  4.00, tier: 'budget'  },
  { id: 'gpt-5-5',     label: 'GPT-5.5',             vendor: 'OpenAI',    input:  5.00, output: 20.00, tier: 'premium' },
  { id: 'gpt-5',       label: 'GPT-5',               vendor: 'OpenAI',    input:  2.50, output: 10.00, tier: 'mid'     },
  { id: 'gpt-4o',      label: 'GPT-4o',              vendor: 'OpenAI',    input:  2.50, output: 10.00, tier: 'mid'     },
  { id: 'gemini-2-5-pro', label: 'Gemini 2.5 Pro',   vendor: 'Google',    input:  1.25, output:  5.00, tier: 'mid'     },
  { id: 'deepseek-v3', label: 'DeepSeek V3',         vendor: 'DeepSeek',  input:  0.27, output:  1.10, tier: 'open'    },
];

export const DEFAULT_MODEL_ID = 'opus-4-7';

export function findModel(id: string): ModelPricing {
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

export function costFor(inputTok: number, outputTok: number, m: ModelPricing): number {
  return (inputTok / 1_000_000) * m.input + (outputTok / 1_000_000) * m.output;
}

export function fmtMoney(usd: number): string {
  if (!isFinite(usd) || usd === 0) return '$0';
  const abs = Math.abs(usd);
  if (abs >= 1000) return `$${(usd / 1000).toFixed(2)}K`;
  if (abs >= 100) return `$${usd.toFixed(0)}`;
  if (abs >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}

export function fmtMoneyPrecise(usd: number): string {
  if (!isFinite(usd)) return '$0.00';
  return `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

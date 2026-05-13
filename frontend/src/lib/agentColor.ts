// Deterministic palette for agent pills. Same agent name → same color.

const PALETTE = [
  { hue: '126,217,87',   text: '#d8f3c8' }, // green
  { hue: '132,169,255',  text: '#cfe0ff' }, // blue
  { hue: '244,201,93',   text: '#ffe7c4' }, // amber
  { hue: '201,134,255',  text: '#e9d5ff' }, // purple
  { hue: '111,214,224',  text: '#cdf2f6' }, // cyan
  { hue: '255,155,210',  text: '#ffd8ec' }, // pink
  { hue: '102,224,163',  text: '#cdf3df' }, // mint
  { hue: '244,114,114',  text: '#ffd2d2' }, // red
  { hue: '169,169,255',  text: '#d8d8ff' }, // lavender
  { hue: '255,177,108',  text: '#ffdcc4' }, // orange
];

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function agentColor(name: string | null | undefined): {
  background: string;
  borderColor: string;
  color: string;
} {
  const key = (name || '-').toLowerCase().trim();
  const p = PALETTE[hashStr(key) % PALETTE.length];
  return {
    background: `rgba(${p.hue}, 0.10)`,
    borderColor: `rgba(${p.hue}, 0.45)`,
    color: p.text,
  };
}

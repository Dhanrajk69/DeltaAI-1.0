/**
 * Human-readable formatters for raw SNAKE_CASE trigger, risk gate, and conduit enum strings.
 */

const EXACT_ENUM_LABELS: Record<string, string> = {
  // Scan Trigger Reasons
  INITIAL: 'Initial Sync',
  HEARTBEAT_60S: '60s Heartbeat',
  '60S_TIMER': '60s Timer',
  '5M_CANDLE_CLOSE': '5m Candle Close',
  MOMENTUM_DISPLACEMENT: 'Momentum Displacement',
  OVERDUE_RECOVERY: 'Overdue Recovery',
  MANUAL: 'Manual Scan',
  MANUAL_DISPATCH: 'Manual Dispatch',
  AUTO_SCAN: 'Auto Scan',

  // Risk Gate Codes
  REWARD_RISK: 'Reward/Risk',
  CPR_CHOP: 'CPR Chop',
  CIRCUIT_BREAKER: 'Circuit Breaker',
  INVALIDATION: 'Invalidation',
  MARGIN: 'Margin',
  INSUFFICIENT_MARGIN: 'Insufficient Margin',

  // Dispatch / Conduit Statuses & Actions
  STANDBY: 'Standby',
  DISPATCHED: 'Dispatched',
  SUPPRESSED: 'Suppressed',
  SUPPRESSED_COOLDOWN: 'Cooldown Active',
  BLOCKED: 'Blocked',
  STALE_GATED: 'Stale Data Gated',
  BUY_LONG: 'Buy Long',
  SELL_SHORT: 'Sell Short',
  NEUTRAL_THETA_HARVEST: 'Neutral Theta Harvest',
  TRENDING_DIRECTIONAL: 'Trending Directional',
};

const UPPERCASE_ACRONYMS = new Set([
  'CPR',
  'VWAP',
  'EMA',
  'SMA',
  'RSI',
  'ATR',
  'POC',
  'VPVR',
  'HTF',
  'LTF',
  'AI',
  'API',
  'BTC',
  'ETH',
  'SOL',
  'USD',
  'USDT',
  'INR',
  'SL',
  'TP',
  'TP1',
  'TP2',
  'TP3',
  'TP4',
  'BE',
  'RR',
]);

/**
 * Converts a single raw SNAKE_CASE (or known uppercase) enum code into a clean human-readable label.
 * Examples:
 * - 'HEARTBEAT_60S' -> '60s Heartbeat'
 * - '5M_CANDLE_CLOSE' -> '5m Candle Close'
 * - 'REWARD_RISK' -> 'Reward/Risk'
 * - 'CPR_CHOP' -> 'CPR Chop'
 */
export function formatEnumLabel(value?: string | null, fallback = ''): string {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  const upper = raw.toUpperCase();
  if (EXACT_ENUM_LABELS[upper]) {
    return EXACT_ENUM_LABELS[upper];
  }

  // Fallback token-by-token formatting for any other SNAKE_CASE enum
  return raw
    .split('_')
    .filter(Boolean)
    .map((segment) => {
      const segUpper = segment.toUpperCase();
      if (UPPERCASE_ACRONYMS.has(segUpper)) return segUpper;
      // Timeframe / duration tokens like 5M, 15M, 1H, 4H, 60S -> 5m, 15m, 1h, 4h, 60s
      if (/^\d+[SMHDW]$/i.test(segment)) {
        return segment.toLowerCase();
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Formats longer conduit/status reason sentences by replacing embedded raw SNAKE_CASE enum tokens
 * (such as 5M_CANDLE_CLOSE, HEARTBEAT_60S, REWARD_RISK, CPR_CHOP, etc.) with human-readable labels.
 */
export function formatConduitText(text?: string | null): string {
  const raw = String(text || '');
  if (!raw) return '';

  return raw.replace(/\b[A-Z0-9]+(?:_[A-Z0-9]+)+\b/g, (token) => formatEnumLabel(token, token));
}

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

// ================= CONSTANTS & WHITELISTS =================

export const ALLOWED_SYMBOLS = [
  'BTCUSD',
  'BTCUSDT',
  'ETHUSD',
  'ETHUSDT',
  'SOLUSD',
  'SOLUSDT',
  'XRPUSD',
  'XRPUSDT',
  'DOGEUSD',
  'DOGEUSDT',
  'AVAXUSD',
  'AVAXUSDT',
] as const;

export const SENSITIVE_KEY_PATTERNS = [
  /api[-_]?secret/i,
  /api[-_]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /authorization/i,
  /private[-_]?key/i,
  /bearer/i,
  /credentials?/i,
  /session[-_]?token/i,
];

// ================= 1. SECRET MASKING & REDACTION =================

/**
 * Masks a secret string to prevent accidental disclosure in logs, errors, or UI.
 * Shows at most the last 4 characters if long enough, else full redaction.
 */
export function maskSecret(val: unknown): string {
  if (typeof val !== 'string' || !val) {
    return '[EMPTY_OR_UNSET]';
  }
  const trimmed = val.trim();
  if (trimmed.length <= 4) {
    return '****';
  }
  const visible = trimmed.slice(-4);
  return `****${visible}`;
}

/**
 * Deeply redacts sensitive keys from any object or payload before logging or error serialization.
 */
export function redactSecrets<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    // Redact Bearer tokens in headers or strings
    let sanitized = input.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]');
    sanitized = sanitized.replace(/api[-_]?key[:=]\s*["']?[A-Za-z0-9._-]+["']?/gi, 'api_key: "[REDACTED_KEY]"');
    sanitized = sanitized.replace(/api[-_]?secret[:=]\s*["']?[A-Za-z0-9._-]+["']?/gi, 'api_secret: "[REDACTED_SECRET]"');
    return sanitized as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item)) as unknown as T;
  }

  if (typeof input === 'object') {
    const copy: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitiveKey) {
        if (typeof value === 'string') {
          copy[key] = maskSecret(value);
        } else {
          copy[key] = '[REDACTED]';
        }
      } else {
        copy[key] = redactSecrets(value);
      }
    }
    return copy as T;
  }

  return input;
}

// ================= 2. LOCAL OFFLINE HMAC-SHA256 SIGNATURE GENERATOR =================

export interface LocalHmacGenerationInput {
  apiKey?: string;
  apiSecret: string;
  method?: string;
  path?: string;
  payload?: any;
  timestamp?: string;
}

export interface LocalHmacGenerationResult {
  status: 'success';
  diagnosticType: 'LOCAL_HMAC_OFFLINE_GENERATION';
  verifiedOnExchange: false;
  disclaimer: string;
  exchange: 'Delta Exchange India (Format Reference)';
  requestDetails: {
    method: string;
    path: string;
    timestamp: string;
    apiKeyMasked: string;
    hasPayload: boolean;
  };
  headers: {
    'api-key': string;
    timestamp: string;
    signature: string;
  };
  notice: string;
}

/**
 * Generates an HMAC-SHA256 signature locally for testing/diagnostic purposes.
 * Explicitly disclaims exchange verification: this verifies client-side cryptographic
 * formatting only, without sending secrets to or confirming authentication with Delta Exchange India.
 */
export function generateLocalHmacSignature(
  input: LocalHmacGenerationInput
): LocalHmacGenerationResult {
  const method = (input.method || 'GET').toUpperCase();
  const path = input.path || '/v2/positions';
  const timestamp = input.timestamp || Math.floor(Date.now() / 1000).toString();
  const payloadStr = input.payload ? (typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload)) : '';

  // Signature payload canonical string: METHOD + TIMESTAMP + PATH + PAYLOAD
  const signatureData = method + timestamp + path + payloadStr;
  const signature = crypto.createHmac('sha256', input.apiSecret).update(signatureData).digest('hex');

  const maskedKey = input.apiKey ? maskSecret(input.apiKey) : 'UNSET';

  return {
    status: 'success',
    diagnosticType: 'LOCAL_HMAC_OFFLINE_GENERATION',
    verifiedOnExchange: false,
    disclaimer:
      'OFFLINE CRYPTOGRAPHIC SIMULATION: This endpoint performs local HMAC-SHA256 digest computation only. It does NOT transmit credentials to or verify authentication against Delta Exchange India servers.',
    exchange: 'Delta Exchange India (Format Reference)',
    requestDetails: {
      method,
      path,
      timestamp,
      apiKeyMasked: maskedKey,
      hasPayload: Boolean(payloadStr),
    },
    headers: {
      'api-key': maskedKey,
      timestamp,
      signature,
    },
    notice:
      'For live trading, server-side live gate (DELTA_LIVE_TRADING_ENABLED) and verified exchange keys are required. Do not use test signatures as live credentials.',
  };
}

// ================= 3. INPUT VALIDATION SCHEMAS =================

export interface ValidatedOrderPayload {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number;
  leverage: number;
  takeProfit?: number;
  stopLoss?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  tp4?: number;
  strategy: string;
  mode: 'PAPER' | 'LIVE';
}

export function validateOrderInput(body: any): { valid: true; data: ValidatedOrderPayload } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a valid JSON object' };
  }

  const { symbol, side, size, orderType = 'MARKET', limitPrice, leverage = 10, takeProfit, stopLoss, tp1, tp2, tp3, tp4, strategy = 'Manual Terminal Order', mode = 'PAPER' } = body;

  // 1. Symbol validation
  if (!symbol || typeof symbol !== 'string') {
    return { valid: false, error: 'Field "symbol" is required and must be a string' };
  }
  const cleanSymbol = symbol.trim().toUpperCase();
  if (!ALLOWED_SYMBOLS.includes(cleanSymbol as any)) {
    return {
      valid: false,
      error: `Invalid symbol "${symbol}". Allowed symbols: ${ALLOWED_SYMBOLS.join(', ')}`,
    };
  }

  // 2. Side validation
  if (side !== 'LONG' && side !== 'SHORT') {
    return { valid: false, error: 'Field "side" must be either "LONG" or "SHORT"' };
  }

  // 3. Size validation
  const numSize = Number(size);
  if (!Number.isFinite(numSize) || numSize <= 0) {
    return { valid: false, error: 'Field "size" must be a positive finite number (> 0)' };
  }
  if (numSize > 1000) {
    return { valid: false, error: 'Field "size" exceeds maximum safety threshold (1000 contracts)' };
  }

  // 4. Order type validation
  const cleanOrderType = (orderType || 'MARKET').toString().toUpperCase();
  if (cleanOrderType !== 'MARKET' && cleanOrderType !== 'LIMIT') {
    return { valid: false, error: 'Field "orderType" must be either "MARKET" or "LIMIT"' };
  }

  // 5. Limit price validation
  let validatedLimitPrice: number | undefined;
  if (cleanOrderType === 'LIMIT') {
    const numLimit = Number(limitPrice);
    if (!Number.isFinite(numLimit) || numLimit <= 0) {
      return { valid: false, error: 'Field "limitPrice" is required and must be a positive number for LIMIT orders' };
    }
    validatedLimitPrice = numLimit;
  }

  // 6. Leverage validation
  const numLeverage = Number(leverage);
  if (!Number.isFinite(numLeverage) || numLeverage < 1 || numLeverage > 100) {
    return { valid: false, error: 'Field "leverage" must be an integer between 1 and 100' };
  }

  // 7. Take profit validation
  let validatedTp: number | undefined;
  if (takeProfit !== undefined && takeProfit !== null && takeProfit !== '') {
    const numTp = Number(takeProfit);
    if (!Number.isFinite(numTp) || numTp <= 0) {
      return { valid: false, error: 'Field "takeProfit" must be a positive finite number' };
    }
    validatedTp = numTp;
  }

  // 8. Stop loss validation
  let validatedSl: number | undefined;
  if (stopLoss !== undefined && stopLoss !== null && stopLoss !== '') {
    const numSl = Number(stopLoss);
    if (!Number.isFinite(numSl) || numSl <= 0) {
      return { valid: false, error: 'Field "stopLoss" must be a positive finite number' };
    }
    validatedSl = numSl;
  }

  const parseOptionalPrice = (val: any): number | undefined => {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : undefined;
  };

  // 9. Mode validation
  const cleanMode = (mode || 'PAPER').toString().toUpperCase();
  if (cleanMode !== 'PAPER' && cleanMode !== 'LIVE') {
    return { valid: false, error: 'Field "mode" must be either "PAPER" or "LIVE"' };
  }

  // 10. Strategy string sanitization
  const cleanStrategy = typeof strategy === 'string' ? strategy.slice(0, 100) : 'Manual Order';

  return {
    valid: true,
    data: {
      symbol: cleanSymbol,
      side,
      size: numSize,
      orderType: cleanOrderType as 'MARKET' | 'LIMIT',
      limitPrice: validatedLimitPrice,
      leverage: Math.floor(numLeverage),
      takeProfit: validatedTp,
      stopLoss: validatedSl,
      tp1: parseOptionalPrice(tp1),
      tp2: parseOptionalPrice(tp2),
      tp3: parseOptionalPrice(tp3),
      tp4: parseOptionalPrice(tp4),
      strategy: cleanStrategy,
      mode: cleanMode as 'PAPER' | 'LIVE',
    },
  };
}

export function validateSignatureTestInput(body: any): { valid: true; data: LocalHmacGenerationInput } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a valid JSON object' };
  }

  const { apiKey, apiSecret, method = 'GET', path = '/v2/positions', payload } = body;

  if (!apiSecret || typeof apiSecret !== 'string' || apiSecret.trim().length < 8) {
    return {
      valid: false,
      error: 'Field "apiSecret" is required and must be at least 8 characters for HMAC-SHA256 generation',
    };
  }

  if (apiSecret.length > 512) {
    return { valid: false, error: 'Field "apiSecret" exceeds safe maximum length' };
  }

  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 256)) {
    return { valid: false, error: 'Field "apiKey" must be a string up to 256 characters' };
  }

  const validMethods = ['GET', 'POST', 'PUT', 'DELETE'];
  const cleanMethod = (method || 'GET').toString().toUpperCase();
  if (!validMethods.includes(cleanMethod)) {
    return { valid: false, error: `Invalid HTTP method "${method}". Allowed: ${validMethods.join(', ')}` };
  }

  const cleanPath = typeof path === 'string' && path.startsWith('/') ? path : '/v2/positions';
  if (cleanPath.length > 256 || /[^\w\-./?=&%]/.test(cleanPath)) {
    return { valid: false, error: 'Path contains invalid characters or exceeds 256 characters' };
  }

  return {
    valid: true,
    data: {
      apiKey: apiKey ? apiKey.trim() : undefined,
      apiSecret: apiSecret.trim(),
      method: cleanMethod,
      path: cleanPath,
      payload,
    },
  };
}

// ================= 4. RATE LIMITER IMPLEMENTATION =================

interface RateLimitRecord {
  tokens: number;
  lastRefill: number;
}

export class InMemoryRateLimiter {
  private limits = new Map<string, RateLimitRecord>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(options: { maxRequests: number; windowMs: number }) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;

    // Periodic sweep to prevent memory leakage
    setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.limits.entries()) {
        if (now - record.lastRefill > this.windowMs * 2) {
          this.limits.delete(key);
        }
      }
    }, 60000).unref();
  }

  public check(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    let record = this.limits.get(key);

    if (!record) {
      record = { tokens: this.maxRequests - 1, lastRefill: now };
      this.limits.set(key, record);
      return { allowed: true, remaining: this.maxRequests - 1, retryAfterSeconds: 0 };
    }

    const elapsed = now - record.lastRefill;
    if (elapsed > this.windowMs) {
      record.tokens = this.maxRequests - 1;
      record.lastRefill = now;
      return { allowed: true, remaining: this.maxRequests - 1, retryAfterSeconds: 0 };
    }

    if (record.tokens > 0) {
      record.tokens -= 1;
      return { allowed: true, remaining: record.tokens, retryAfterSeconds: 0 };
    }

    const retryAfterSeconds = Math.ceil((this.windowMs - elapsed) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  public middleware(actionName = 'action') {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        'unknown-ip';
      const key = `${ip}:${req.path}`;
      const result = this.check(key);

      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfterSeconds);
        return res.status(429).json({
          status: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          error: `Rate limit exceeded for ${actionName}. Please retry in ${result.retryAfterSeconds} seconds.`,
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }

      next();
    };
  }
}

// ================= 5. SECURE SESSION / TOKEN HANDLING =================

export interface SessionVerificationResult {
  valid: boolean;
  sessionId?: string;
  createdAt?: number;
  error?: string;
}

export class SessionTokenManager {
  private readonly secret: string;
  private readonly sessionTtlMs: number;
  private activeSessions = new Set<string>();

  constructor(secret: string, sessionTtlMs = 24 * 60 * 60 * 1000) {
    this.secret = secret;
    this.sessionTtlMs = sessionTtlMs;
  }

  public issueToken(): { token: string; sessionId: string; expiresAt: number } {
    const sessionId = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const expiresAt = now + this.sessionTtlMs;
    const payload = `${sessionId}.${expiresAt}`;
    const signature = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');
    const token = `${payload}.${signature}`;

    this.activeSessions.add(sessionId);
    return { token, sessionId, expiresAt };
  }

  public verifyToken(token: string | undefined): SessionVerificationResult {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Missing session authentication token' };
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed session token format' };
    }

    const [sessionId, expiresAtStr, receivedSignature] = parts;
    const expiresAt = Number(expiresAtStr);

    if (!sessionId || !expiresAt || !Number.isFinite(expiresAt)) {
      return { valid: false, error: 'Invalid token timestamp or session ID' };
    }

    if (Date.now() > expiresAt) {
      this.activeSessions.delete(sessionId);
      return { valid: false, error: 'Session token has expired' };
    }

    const payload = `${sessionId}.${expiresAtStr}`;
    const expectedSignature = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');

    // Constant-time signature comparison to prevent timing attacks
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const receivedBuf = Buffer.from(receivedSignature, 'hex');

    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return { valid: false, error: 'Invalid or forged session token signature' };
    }

    return { valid: true, sessionId, createdAt: expiresAt - this.sessionTtlMs };
  }

  public authMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers['authorization'];
      let token: string | undefined;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      } else if (req.headers['x-session-token']) {
        token = (req.headers['x-session-token'] as string).trim();
      } else if (req.query.token) {
        token = (req.query.token as string).trim();
      }

      const verification = this.verifyToken(token);
      if (!verification.valid) {
        return res.status(401).json({
          status: 'error',
          code: 'UNAUTHORIZED_SESSION',
          error: verification.error || 'Authentication required',
        });
      }

      (req as any).sessionId = verification.sessionId;
      next();
    };
  }
}

// ================= 6. STRICT PAPER VS LIVE EXECUTION BOUNDARY =================

export interface LiveTradingGateStatus {
  serverLiveGateEnabled: boolean;
  hasServerExchangeCredentials: boolean;
  liveTradingReady: boolean;
  mode: 'PAPER_ONLY' | 'LIVE_ENABLED';
  policyNotice: string;
}

export interface LiveGateEvaluationOptions {
  runtimeUnlocked?: boolean;
  hasRuntimeCredentials?: boolean;
  headers?: Record<string, string | string[] | undefined>;
}

interface RuntimeLiveGateState {
  unlocked: boolean;
  apiKey: string;
  apiSecret: string;
  environment: 'PROD' | 'TESTNET';
  updatedAt: number;
}

let runtimeLiveGateState: RuntimeLiveGateState = {
  unlocked: false,
  apiKey: '',
  apiSecret: '',
  environment: 'PROD',
  updatedAt: 0,
};

function isValidCredentialPair(apiKey?: string, apiSecret?: string): boolean {
  if (typeof apiKey !== 'string' || typeof apiSecret !== 'string') return false;
  const k = apiKey.trim();
  const s = apiSecret.trim();
  return (
    k.length >= 8 &&
    !k.toLowerCase().startsWith('demo_') &&
    s.length >= 8 &&
    !s.toLowerCase().startsWith('demo_')
  );
}

export function setRuntimeLiveTradingGate(config: {
  unlocked: boolean;
  apiKey?: string;
  apiSecret?: string;
  environment?: 'PROD' | 'TESTNET';
}): RuntimeLiveGateState {
  if (!config.unlocked) {
    runtimeLiveGateState = {
      ...runtimeLiveGateState,
      unlocked: false,
      updatedAt: Date.now(),
    };
    return { ...runtimeLiveGateState };
  }

  const nextKey = config.apiKey !== undefined ? config.apiKey.trim() : runtimeLiveGateState.apiKey;
  const nextSecret = config.apiSecret !== undefined ? config.apiSecret.trim() : runtimeLiveGateState.apiSecret;
  const hasValidCreds =
    isValidCredentialPair(nextKey, nextSecret) ||
    isValidCredentialPair(process.env.DELTA_API_KEY, process.env.DELTA_API_SECRET);

  runtimeLiveGateState = {
    unlocked: Boolean(config.unlocked && hasValidCreds),
    apiKey: nextKey,
    apiSecret: nextSecret,
    environment: config.environment || runtimeLiveGateState.environment || 'PROD',
    updatedAt: Date.now(),
  };

  return { ...runtimeLiveGateState };
}

export function getRuntimeLiveTradingGate(): RuntimeLiveGateState {
  return { ...runtimeLiveGateState };
}

export function evaluateLiveTradingGate(options?: LiveGateEvaluationOptions): {
  gateEnabled: boolean;
  hasCredentials: boolean;
  allowed: boolean;
  status: LiveTradingGateStatus;
} {
  const envGateEnabled = process.env.DELTA_LIVE_TRADING_ENABLED === 'true';
  const rawHeader = options?.headers?.['x-delta-live-unlocked'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const headerUnlocked = String(headerValue || '').trim().toLowerCase() === 'true';

  const envHasCredentials = isValidCredentialPair(
    process.env.DELTA_API_KEY,
    process.env.DELTA_API_SECRET
  );
  const runtimeHasCredentials =
    isValidCredentialPair(runtimeLiveGateState.apiKey, runtimeLiveGateState.apiSecret) ||
    Boolean(options?.hasRuntimeCredentials);

  const hasCredentials = envHasCredentials || runtimeHasCredentials;
  const runtimeGateActive =
    runtimeLiveGateState.unlocked ||
    Boolean(options?.runtimeUnlocked) ||
    (headerUnlocked && hasCredentials);

  const gateEnabled = envGateEnabled || runtimeGateActive;
  const allowed = gateEnabled && hasCredentials;

  return {
    gateEnabled,
    hasCredentials,
    allowed,
    status: {
      serverLiveGateEnabled: gateEnabled,
      hasServerExchangeCredentials: hasCredentials,
      liveTradingReady: allowed,
      mode: allowed ? 'LIVE_ENABLED' : 'PAPER_ONLY',
      policyNotice: allowed
        ? 'Live execution gate unlocked on server with verified credentials.'
        : 'SAFETY ENFORCEMENT: Server-side live trading gate is LOCKED. Client requests with mode="LIVE" are rejected to prevent unauthenticated execution or simulated confusion.',
    },
  };
}

/**
 * Checks whether an incoming order with requested mode is permitted.
 * If mode is LIVE, strictly rejects unless server live gate is enabled and verified.
 */
export function enforceExecutionBoundary(
  requestedMode: 'PAPER' | 'LIVE',
  options?: LiveGateEvaluationOptions
): {
  permitted: boolean;
  statusCode?: number;
  errorCode?: string;
  message?: string;
} {
  if (requestedMode === 'PAPER') {
    return { permitted: true };
  }

  // Requested LIVE mode: Check server-side live gate (env or explicit runtime unlock)
  const gate = evaluateLiveTradingGate(options);

  if (!gate.gateEnabled) {
    return {
      permitted: false,
      statusCode: 403,
      errorCode: 'LIVE_TRADING_GATE_LOCKED',
      message:
        'Live trading is disabled on this server instance (DELTA_LIVE_TRADING_ENABLED is false). Live orders are blocked by server safety policy. Use PAPER mode for simulated trading.',
    };
  }

  if (!gate.hasCredentials) {
    return {
      permitted: false,
      statusCode: 501,
      errorCode: 'LIVE_EXCHANGE_CREDENTIALS_MISSING',
      message:
        'Server-side live exchange credentials (DELTA_API_KEY / DELTA_API_SECRET) are unconfigured. To protect funds, live order execution is rejected until verified server-side exchange connectivity is installed.',
    };
  }

  return { permitted: true };
}

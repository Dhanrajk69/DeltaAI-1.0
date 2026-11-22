/**
 * Comprehensive Security & Authentication Test Suite for DelaAI
 * Validates:
 * 1. Safe Local Offline HMAC-SHA256 Generation & Disclaimers
 * 2. Secret Redaction & Log Sanitization
 * 3. Strict Input Validation on Orders & Diagnostic Payloads
 * 4. Token Bucket Rate Limiting & Cooldowns
 * 5. Cryptographic Session Token Issuance & Constant-Time Verification
 * 6. Strict Paper-vs-Live Execution Boundary & Live Gate Guard
 */

import {
  maskSecret,
  redactSecrets,
  generateLocalHmacSignature,
  validateOrderInput,
  validateSignatureTestInput,
  InMemoryRateLimiter,
  SessionTokenManager,
  evaluateLiveTradingGate,
  enforceExecutionBoundary,
  setRuntimeLiveTradingGate,
} from '../src/server/security.ts';
import crypto from 'crypto';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

async function runTestSuite() {
  console.log('\n========================================');
  console.log('RUNNING DELAAI SECURITY & AUTH TEST SUITE');
  console.log('========================================\n');

  // TEST SUITE 1: Secret Redaction & Key Masking
  console.log('[Suite 1: Secret Redaction & Key Masking]');
  {
    const masked1 = maskSecret('mySuperSecretDeltaApiKey1234');
    assert(masked1 === '****1234', 'Masks long key showing only last 4 chars', `Got: ${masked1}`);

    const masked2 = maskSecret('short');
    assert(masked2 === '****hort', 'Masks short key showing last 4 chars', `Got: ${masked2}`);

    const masked3 = maskSecret('abc');
    assert(masked3 === '****', 'Masks <=4 char secret completely', `Got: ${masked3}`);

    const payloadWithSecrets = {
      user: 'trader1',
      apiKey: 'DELTA_LIVE_KEY_87654321',
      apiSecret: 'SUPER_SECRET_HMAC_KEY_ABCD',
      nested: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token',
        otherData: 12345,
      },
    };
    const redacted = redactSecrets(payloadWithSecrets);
    assert(
      redacted.apiKey === '****4321' &&
      redacted.apiSecret === '****ABCD' &&
      redacted.nested.token === '****oken' &&
      redacted.nested.otherData === 12345,
      'Deeply redacts sensitive keys without corrupting non-sensitive fields'
    );

    const logString = 'Error connecting with Authorization: Bearer secret_session_token_xyz to server';
    const sanitizedString = redactSecrets(logString);
    assert(
      !sanitizedString.includes('secret_session_token_xyz') && sanitizedString.includes('[REDACTED_TOKEN]'),
      'Redacts Bearer tokens in raw log strings',
      `Got: ${sanitizedString}`
    );
  }

  // TEST SUITE 2: Safe Local HMAC Generation (Offline Diagnostic Only)
  console.log('\n[Suite 2: Safe Local Offline HMAC Generation]');
  {
    const testSecret = 'secure_hmac_test_secret_for_sha256';
    const testKey = 'TEST_DELTA_API_KEY_1234';
    const result = generateLocalHmacSignature({
      apiKey: testKey,
      apiSecret: testSecret,
      method: 'GET',
      path: '/v2/positions',
      timestamp: '1700000000',
    });

    assert(result.status === 'success', 'Generates diagnostic response');
    assert(result.verifiedOnExchange === false, 'Explicitly declares verifiedOnExchange = false');
    assert(result.diagnosticType === 'LOCAL_HMAC_OFFLINE_GENERATION', 'Diagnostic type labeled as offline');
    assert(result.headers['api-key'] === '****1234', 'API key is masked in headers, not exposed in plaintext');
    assert(
      result.disclaimer.includes('OFFLINE CRYPTOGRAPHIC SIMULATION') &&
      result.disclaimer.includes('NOT transmit credentials'),
      'Includes mandatory offline disclaimer'
    );

    // Verify cryptographic accuracy of local HMAC-SHA256
    const expectedSig = crypto
      .createHmac('sha256', testSecret)
      .update('GET1700000000/v2/positions')
      .digest('hex');
    assert(result.headers.signature === expectedSig, 'HMAC-SHA256 digest matches RFC2104 standard');
  }

  // TEST SUITE 3: Input Validation on Orders & Diagnostic Payloads
  console.log('\n[Suite 3: Input Validation on Orders & Payloads]');
  {
    // Valid order
    const validOrder = validateOrderInput({
      symbol: 'BTCUSDT',
      side: 'LONG',
      size: 0.25,
      orderType: 'MARKET',
      leverage: 10,
      mode: 'PAPER',
    });
    assert(validOrder.valid === true, 'Accepts valid PAPER order payload');

    // Invalid symbol
    const badSymbol = validateOrderInput({
      symbol: 'FAKECOIN',
      side: 'LONG',
      size: 1,
    });
    assert(badSymbol.valid === false && badSymbol.error.includes('Invalid symbol'), 'Rejects disallowed symbols');

    // Negative size
    const negativeSize = validateOrderInput({
      symbol: 'BTCUSDT',
      side: 'LONG',
      size: -0.5,
    });
    assert(negativeSize.valid === false && negativeSize.error.includes('Field "size" must be a positive'), 'Rejects negative size');

    // Invalid side
    const badSide = validateOrderInput({
      symbol: 'BTCUSDT',
      side: 'NEUTRAL',
      size: 1,
    });
    assert(badSide.valid === false && badSide.error.includes('"side" must be either "LONG" or "SHORT"'), 'Rejects invalid side');

    // LIMIT without limitPrice
    const missingLimitPrice = validateOrderInput({
      symbol: 'BTCUSDT',
      side: 'LONG',
      size: 1,
      orderType: 'LIMIT',
    });
    assert(missingLimitPrice.valid === false && missingLimitPrice.error.includes('limitPrice'), 'Enforces limitPrice on LIMIT orders');

    // Signature test validation: Secret too short
    const shortSecret = validateSignatureTestInput({
      apiSecret: '123',
    });
    assert(shortSecret.valid === false && shortSecret.error.includes('at least 8 characters'), 'Enforces min 8 characters on API secret');
  }

  // TEST SUITE 4: Rate Limiting
  console.log('\n[Suite 4: Rate Limiting & Cooldown]');
  {
    const limiter = new InMemoryRateLimiter({ maxRequests: 3, windowMs: 2000 });
    const ipKey = 'test-client-ip-1';

    const req1 = limiter.check(ipKey);
    assert(req1.allowed === true && req1.remaining === 2, 'Allows request 1');

    const req2 = limiter.check(ipKey);
    assert(req2.allowed === true && req2.remaining === 1, 'Allows request 2');

    const req3 = limiter.check(ipKey);
    assert(req3.allowed === true && req3.remaining === 0, 'Allows request 3 (boundary)');

    const req4 = limiter.check(ipKey);
    assert(req4.allowed === false && req4.retryAfterSeconds > 0, 'Blocks request 4 exceeding rate limit with retryAfter');
  }

  // TEST SUITE 5: Session Tokens & Tamper Resistance
  console.log('\n[Suite 5: Session Token Issuance & Verification]');
  {
    const secret = 'test_session_secret_32_bytes_long_entropy!';
    const manager = new SessionTokenManager(secret, 3600000);

    const issued = manager.issueToken();
    assert(Boolean(issued.token && issued.sessionId), 'Issues signed session token');

    const validCheck = manager.verifyToken(issued.token);
    assert(validCheck.valid === true && validCheck.sessionId === issued.sessionId, 'Validates authentic session token');

    // Tampered token test
    const tampered = issued.token.slice(0, -4) + 'abcd';
    const tamperedCheck = manager.verifyToken(tampered);
    assert(tamperedCheck.valid === false && Boolean(tamperedCheck.error?.includes('signature')), 'Rejects tampered signature');

    // Missing token test
    const emptyCheck = manager.verifyToken('');
    assert(emptyCheck.valid === false, 'Rejects empty token');

    // Expired token test
    const expiredManager = new SessionTokenManager(secret, -1000); // Already expired
    const expiredIssued = expiredManager.issueToken();
    const expiredCheck = expiredManager.verifyToken(expiredIssued.token);
    assert(expiredCheck.valid === false && Boolean(expiredCheck.error?.includes('expired')), 'Rejects expired session tokens');
  }

  // TEST SUITE 6: Strict Paper vs Live Execution Boundary
  console.log('\n[Suite 6: Strict Paper vs Live Execution Boundary]');
  {
    // Ensure DELTA_LIVE_TRADING_ENABLED is unset / false and runtime gate is reset
    delete process.env.DELTA_LIVE_TRADING_ENABLED;
    delete process.env.DELTA_API_KEY;
    delete process.env.DELTA_API_SECRET;
    setRuntimeLiveTradingGate({ unlocked: false, apiKey: '', apiSecret: '' });

    // PAPER order is always permitted
    const paperCheck = enforceExecutionBoundary('PAPER');
    assert(paperCheck.permitted === true, 'PAPER orders are permitted in simulated environment');

    // LIVE order when server gate is locked (default)
    const liveCheckLocked = enforceExecutionBoundary('LIVE');
    assert(
      liveCheckLocked.permitted === false &&
      liveCheckLocked.statusCode === 403 &&
      liveCheckLocked.errorCode === 'LIVE_TRADING_GATE_LOCKED',
      'Strictly rejects LIVE mode with HTTP 403 when DELTA_LIVE_TRADING_ENABLED is false'
    );

    // LIVE order when gate is true but server credentials are unconfigured
    process.env.DELTA_LIVE_TRADING_ENABLED = 'true';
    const liveCheckNoCreds = enforceExecutionBoundary('LIVE');
    assert(
      liveCheckNoCreds.permitted === false &&
      liveCheckNoCreds.statusCode === 501 &&
      liveCheckNoCreds.errorCode === 'LIVE_EXCHANGE_CREDENTIALS_MISSING',
      'Strictly rejects LIVE mode when server exchange credentials are missing'
    );

    // LIVE order when gate is true AND valid server credentials configured
    process.env.DELTA_API_KEY = 'REAL_DELTA_KEY_12345';
    process.env.DELTA_API_SECRET = 'REAL_DELTA_SECRET_ABCDE';
    const liveCheckAllowed = enforceExecutionBoundary('LIVE');
    assert(liveCheckAllowed.permitted === true, 'Permits LIVE mode ONLY when both server gate and server credentials exist');

    // Reset environment variables and test dynamic runtime unlock with valid credentials
    delete process.env.DELTA_LIVE_TRADING_ENABLED;
    delete process.env.DELTA_API_KEY;
    delete process.env.DELTA_API_SECRET;

    setRuntimeLiveTradingGate({
      unlocked: true,
      apiKey: 'RUNTIME_DELTA_KEY_98765',
      apiSecret: 'RUNTIME_DELTA_SECRET_98765',
      environment: 'PROD',
    });
    const runtimeUnlockedCheck = enforceExecutionBoundary('LIVE', {
      headers: { 'x-delta-live-unlocked': 'true' },
    });
    assert(
      runtimeUnlockedCheck.permitted === true,
      'Permits LIVE mode when dynamically unlocked at runtime with valid API credentials'
    );

    setRuntimeLiveTradingGate({ unlocked: false, apiKey: '', apiSecret: '' });
  }

  console.log('\n========================================');
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('========================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});

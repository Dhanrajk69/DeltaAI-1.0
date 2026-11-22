# DelaAI Authentication, Credential Handling & Security Guide

## 1. Executive Summary

Based on the security and authentication review of the DelaAI repository, this upgrade introduces institutional-grade defensive controls:

1. **Elimination of Hardcoded Secrets & Demo Fallbacks:** Removed all dummy/demo keys (e.g. `DEMO_DELTA_INDIA_KEY`, hardcoded test phone numbers/usernames) across server and client layers.
2. **Safe Local Offline HMAC-SHA256 Generation:** Clarified and refactored `/api/delta/signature-test` to be an offline diagnostic tool. It explicitly states `verifiedOnExchange: false`, returns masked keys, never echoes back raw secrets, and includes clear disclaimers that it does not authenticate against Delta Exchange India servers.
3. **Cryptographic Session Token Management & Auth Middleware:** Protected sensitive endpoints (`/api/delta/order`, `/api/delta/close-position`, `/api/delta/kill-switch`, `/api/delta/auto-hedge`, `/api/delta/signature-test`) with HMAC-signed session tokens and constant-time signature verification.
4. **Strict Input Validation:** Enforced whitelisted crypto pairs, numeric bounds on order sizing, valid leverage (1–100), permitted order types (`MARKET` vs `LIMIT`), and sanitized strings.
5. **In-Memory Rate Limiting:** Enforced token bucket sliding-window limits on order placement (30 req/min), signature testing (12 req/min), and general queries (120 req/min), responding with HTTP 429 and `Retry-After` headers.
6. **Automatic Secret Redaction:** Sanitized all console logs and HTTP error responses so API keys, secrets, session tokens, and passwords are masked (`****<last4>` or `[REDACTED]`).
7. **Strict Paper-vs-Live Execution Boundary:** A client request with `mode: "LIVE"` is blocked with HTTP 403 unless a server-side live-trading gate (`DELTA_LIVE_TRADING_ENABLED="true"`) AND verified server-side exchange credentials (`DELTA_API_KEY` & `DELTA_API_SECRET`) exist. The system does not invent simulated executions and label them as live.

---

## 2. Architecture & Components

```
Client (React Terminal)
   │
   ├── 1. Fetches ephemeral session token via GET /api/auth/session
   ├── 2. Inspects server live gate status (serverLiveGateEnabled: true/false)
   │
   ▼
Headers: { "Authorization": "Bearer <sessionId>.<expiry>.<hmacSignature>" }
   │
   ▼
Express Server Protection Pipeline (/server.ts + /src/server/security.ts)
   ├── 1. Rate Limiter (Token bucket per client IP) -> 429 Too Many Requests
   ├── 2. Session Auth Middleware (HMAC verification) -> 401 Unauthorized
   ├── 3. Input Validation Schema (validateOrderInput / validateSignatureTestInput) -> 400 Bad Request
   ├── 4. Strict Paper-vs-Live Boundary (enforceExecutionBoundary) -> 403 Forbidden / 501 Not Implemented
   └── 5. Safe Error & Log Interceptor (redactSecrets) -> Masked keys, no leaks
```

---

## 3. Safe Local Offline HMAC Generation

### Endpoint: `POST /api/delta/signature-test`
- **Purpose:** Verifies that a user's client or backend can compute HMAC-SHA256 signatures according to Delta Exchange India specifications.
- **Important Disclosure:** This endpoint performs **local cryptographic digest computation only**. It does **NOT** transmit credentials to or verify authentication with Delta Exchange India servers.
- **Output Sample:**
```json
{
  "status": "success",
  "diagnosticType": "LOCAL_HMAC_OFFLINE_GENERATION",
  "verifiedOnExchange": false,
  "disclaimer": "OFFLINE CRYPTOGRAPHIC SIMULATION: This endpoint performs local HMAC-SHA256 digest computation only. It does NOT transmit credentials to or verify authentication against Delta Exchange India servers.",
  "exchange": "Delta Exchange India (Format Reference)",
  "requestDetails": {
    "method": "GET",
    "path": "/v2/positions",
    "timestamp": "1741344000",
    "apiKeyMasked": "****1234",
    "hasPayload": false
  },
  "headers": {
    "api-key": "****1234",
    "timestamp": "1741344000",
    "signature": "a1b2c3d4..."
  },
  "notice": "For live trading, server-side live gate (DELTA_LIVE_TRADING_ENABLED) and verified exchange keys are required. Do not use test signatures as live credentials."
}
```

---

## 4. Strict Paper vs. Live Execution Boundary

The system maintains a hard boundary between the simulated paper trading engine and live exchange execution:

| Mode Requested | Server Live Gate (`DELTA_LIVE_TRADING_ENABLED`) | Server Exchange Keys | Action Taken |
| :--- | :--- | :--- | :--- |
| **`PAPER`** | Any | Any | Order processed in isolated simulated paper engine. |
| **`LIVE`** | `false` (default) | Any | **REJECTED (HTTP 403):** `LIVE_TRADING_GATE_LOCKED`. Real trading blocked by policy. |
| **`LIVE`** | `true` | Missing / Empty | **REJECTED (HTTP 501):** `LIVE_EXCHANGE_CREDENTIALS_MISSING`. Prevents mock execution. |
| **`LIVE`** | `true` | Valid & Configured | Permitted for verified upstream execution. |

---

## 5. Environment Variables & Setup Steps

Configure these in your `.env` or deployment secrets:

```bash
# Optional custom session signing secret (auto-generated if omitted)
SESSION_SECRET="your-32-byte-random-session-secret"

# Master live trading switch (keep "false" unless executing real funds on exchange)
DELTA_LIVE_TRADING_ENABLED="false"

# Production server-side Delta Exchange India credentials
DELTA_API_KEY=""
DELTA_API_SECRET=""
```

### Running Tests
To verify all security mechanisms:
```bash
npm run test
```
Runs 30 unit tests validating secret redaction, offline HMAC generation, input schema validation, rate limiting, session verification, and paper-vs-live boundary enforcement.

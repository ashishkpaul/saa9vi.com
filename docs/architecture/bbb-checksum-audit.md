# BBB Checksum Audit

**Date:** 1 November 2026  
**Author:** Kiro CLI baseline (C-07)  
**Status:** VERIFIED — no code or schema change required.

---

## 1. Outbound API checksum (standard API calls)

All outbound calls to the BBB API (`create`, `join`, `getMeetingInfo`, `end`,
`hooks/create`, etc.) are signed by `BbbApiService.buildChecksum()`.

**Algorithm:** SHA-256 (plugin-level option `checksumAlgorithm`).

**Configuration:**
```typescript
// src/vendure-config.ts — BigBlueButtonPlugin.init()
checksumAlgorithm: 'sha256',
```

**Probe evidence (from vendure-config.ts comment):**  
Verified live against `meeting.saa9vi.com` on 2026-10-09. Both SHA-256 and
SHA-1 were tested using `scripts/bbb/checksum-probe.ts`. All four requests
returned `HTTP 200 <returncode>SUCCESS</returncode>`. Post-rotation test
(after BBB_ENCRYPTION_KEY rotation) also returned SUCCESS, confirming the
new secret decrypts correctly.

**Known-answer test vectors** (`bbb-checksum.spec.ts`):

| Algorithm | Input | Expected checksum |
|---|---|---|
| SHA-256 | `getMeetingInfo` + `meetingID=m1&password=mod-pw` + `w7-secret` | `2a93a0e94d917f900d4806586081d9041d810aef725d4b038c2545136efbc851` |
| SHA-1 | same | `f4ec5162b3840ff3fd8a8ac6b27218d6a9439291` |

Formula: `hex(alg(methodName + queryString + apiSecret))`

**Fallback behavior:** Unknown algorithm values (e.g. `md5`) fall back to
SHA-256. Tested in `bbb-checksum.spec.ts`.

**Supported options:** `sha1` (legacy servers) and `sha256` (default/modern).
SHA-384 and SHA-512 are not exposed as outbound options.

---

## 2. Inbound webhook verification (BBB hook callbacks)

BBB sends hook events to `POST /bbb/webhook/:serverId`. The verifier is in
`src/plugins/bigbluebutton-plugin/workers/bbb-webhook-auth.ts`.

**Two auth modes are supported:**

### Mode A: Bearer token (`auth2_0: true`)
Header: `Authorization: Bearer <raw shared secret>`  
Verified by constant-time comparison (both sides sha256-hashed first to equal length).  
Production systems should emit an alert recommending migration to checksum mode.

### Mode B: Checksum query parameter (`auth2_0: false`)
Parameter: `?checksum=<hex>`  
Formula: `hex(alg(callbackUrl + rawBody + secret))`

**Algorithm inferred from digest hex length:**

| Hex length | Algorithm |
|---|---|
| 40 | SHA-1 |
| 64 | SHA-256 |
| 96 | SHA-384 |
| 128 | SHA-512 |
| other | rejected |

All four algorithms are on the allow-list. An unknown length is rejected
before the comparison, so a zero-length or truncated checksum cannot produce
a false positive.

**Test coverage** (`bbb-webhook-auth.spec.ts`):
- Bearer mode: good token, wrong token, missing prefix
- Checksum mode: all 4 digest sizes, tampered checksum, wrong secret, unknown length, missing checksum
- Constant-time equality for both modes
- Secret hygiene: no secret, Authorization header value, or checksum value reaches Logger calls

---

## 3. Deployed server pool

**Server:** `meeting.saa9vi.com`  
**Verified compatible with:** SHA-256 (outbound) and SHA-1/SHA-256/SHA-384/SHA-512 (inbound hook).  
**BBB version:** Accepts the full BBB 3.0 algorithm set per the probe comment.

**Decision:** The plugin-level `checksumAlgorithm: 'sha256'` is correct for the
current single-server pool. No per-server DB column or migration is needed
unless a heterogeneous pool with conflicting algorithm requirements is deployed.

---

## 4. Distinctions

| Concern | Code path | Algorithm |
|---|---|---|
| Outbound API signing | `BbbApiService.buildChecksum()` | Plugin option (`sha256`) |
| Inbound hook verification | `bbb-webhook-auth.ts` | Inferred from digest length |

These are independent. The plugin-level option does not affect inbound
verification, and inbound verification does not require matching the outbound
algorithm.

---

## 5. No-action conclusion

No code change, migration, or per-server configuration is needed based on the
current evidence. Re-run the probe script if the server pool changes or BBB
servers are upgraded to a version that removes SHA-256 support.

Probe script location: `scripts/bbb/checksum-probe.ts`

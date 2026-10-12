# ATLASZ — Secret leak response procedure

Principle: a secret that was exposed is **compromised**, even if the repository is private and even if it was removed in a later commit. Removal from Git is never a substitute for revocation.

## Prevention (code-enforced)
- Secrets live only in the encrypted vault (`secret-vault`, key from `ATLASZ_VAULT_KEY`, outside the repo). Agents never receive values; privileged calls go through the credential broker with a stated purpose.
- Tool outputs, errors, traces and logs are redacted (`scrub`/`containsSecret`); a secret found in a tool result raises a `SECRET_IN_TOOL_OUTPUT` signal and the result is replaced.
- Egress policy: only owner-approved hosts; secret-bearing outbound bodies are refused.
- `atlasz-tests/repo-secret-scan.test.mjs` scans every tracked file on each gate run; `scripts/secret-history-scan.mjs` scans every ref, every added line and every commit message (output never contains the secret, only commit/file/pattern).

## Detection
1. `node scripts/secret-history-scan.mjs` (exit code 1 on a hit) — run before every release and after any suspicious event.
2. The gate fails on a tracked secret. A `SECRET_IN_TOOL_OUTPUT` signal opens an incident automatically.

## Response (in this order, do not skip)
1. **Revoke** the credential at the provider (API console / Stripe dashboard / GitHub settings). This is the only step that actually ends the exposure.
2. **Rotate**: create a replacement and store it with the vault (`vault set`), never in a file, prompt, chat or commit.
3. **Contain**: the incident module blocks the agent/tool involved, suspends its tasks and preserves evidence (`state/incidents/evidence/<id>`).
4. **Assess**: use provider audit logs for use between exposure and revocation; record findings in the incident.
5. **Clean history** only after 1–2: rewrite history only with the owner's explicit decision (coordination needed for every clone); the old secret stays revoked either way.
6. **Clear the incident** with a signed single-use owner approval (`CLEAR_INCIDENT`).
7. Add a regression test for the leak path.

## Limits (honest)
- Pattern scanning finds known token shapes, not every possible secret.
- Revocation/rotation is performed by the owner at each provider; ATLASZ cannot do it for them.

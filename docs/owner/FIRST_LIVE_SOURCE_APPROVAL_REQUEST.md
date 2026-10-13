# First live discovery source — owner approval request (UNSIGNED)

Status: **UNSIGNED_AWAITING_OWNER**. Nothing has been contacted. Signing this request is the only thing that allows the connection.

- Source: Hacker News (Algolia search API) (`hn-algolia`), host **hn.algolia.com**, port 443, method GET only
- Authentication: NONE (public read-only API; no credential is stored or sent)
- Exact request: `https://hn.algolia.com/api/v1/search_by_date?tags=comment&query=%22seeking%20freelancer%22&hitsPerPage=50`
- Action to sign: `EGRESS_POLICY_SET`
- Subject (hash of the policy): `egress:discovery-hn-algolia:4601c99eb59d85b717a13b67`

## Access restrictions
Public Hacker News Search (Algolia) API. Its published usage terms and rate limit could NOT be verified from the sandbox (the documentation page needs JavaScript). Before signing, read https://hn.algolia.com/api and confirm that read-only automated use at this volume is acceptable. ATLASZ makes at most 1 request per 15 minutes from one host.

## Limits
- minIntervalBetweenRequests: enforced by the engine (see DISCOVERY_LIMITS.minIntervalMs), the scheduler also enforces 15 min and 96 runs/day
- maxResponseBytes: bounded by DISCOVERY_LIMITS.maxResponseBytes
- redirects: never followed
- dnsPinning: connection pinned to the checked addresses

## Failure behaviour
HTTP error, timeout, parse error or oversize response => run recorded as failed, exponential back-off (10 min doubling to 6 h), no retry storm, owner stop honoured

## Data handled
Public comment text from job-seeking threads. Treated as untrusted data; embedded instructions are ignored; contact is never initiated by ATLASZ.

## Not allowed even if approved
- any other host
- any method except GET
- any port except 443
- sending anything to a poster
- using the data as revenue

## How to approve
Control Center > Agents > Discovery > host request 'hn-algolia' > enter your owner passphrase (action discoveryApproveHost). The signed policy is hash-bound to the exact JSON above; any change invalidates it.

## If approved / if not
- SEARCH agents may read this one host on the schedule above. First success is recorded in first-live-discovery.json and kept separate from fixtures.
- No network contact. Discovery stays fixture/operator-capture only.
- Revoke: EGRESS_POLICY_REMOVE (signed) removes the host immediately.

## Policy JSON
```json
{
  "providerId": "discovery-hn-algolia",
  "hosts": [
    "hn.algolia.com"
  ],
  "ports": [
    443
  ],
  "methods": [
    "GET"
  ],
  "pathPrefixes": [
    "/"
  ],
  "maxBodyBytes": 4096,
  "loopback": false,
  "description": ""
}
```

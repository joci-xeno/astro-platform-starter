# Computer Use — real provider required

Current ATLASZ state:
- computer-use-fabric.mjs exists and is wired into internal-integration-hub.mjs.
- Owner hierarchy and AUTO / ASK_JOCI / FORBIDDEN policy exist.
- With no tested provider the module correctly reports PLACEHOLDER_UNCONNECTED and refuses execution.

Required work:
1. Connect a real sandboxed browser/computer provider. Do not give agents unrestricted access to Joci's Windows host.
2. Adapter must support at minimum: open/navigate, click, type, read page/UI state, form interaction, screenshot/evidence, and controlled file transfer if supported.
3. Route it through Computer Use Fabric and Tool Fabric/Tool Bridge where appropriate.
4. Test in sandbox with harmless tasks: navigate, click, type into a non-sensitive form, read result, capture evidence.
5. Verify ASK_JOCI gates for spend/purchase/subscription/contract/payment/bank/account-security/credential changes and sensitive external publication/deletion.
6. Verify FORBIDDEN actions cannot bypass owner control, exfiltrate secrets, or disable audit.
7. Mark LIVE only after successful end-to-end tests and retained logs/evidence.

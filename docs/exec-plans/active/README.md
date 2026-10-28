# Active Execution Plans

Reviewed 2026-10-18. Implementation-only plans that have landed are in
[Completed plans](../completed/README.md). Historical validation results are not fresh release acceptance.

- [Ingress-Independent NetworkPolicy Access](networkpolicy-ingress-independence.md) — Implementation and historical chart publication complete; target-registry promotion and live ingress verification still pending. Use the approved current chart containing the fix, not the historical version solely because it appears in this plan.
- [Production Tool Results](production-tool-results.md) — Implementation complete; coordinated staging soak and production release acceptance still pending.
- [Production Readiness Audit — 2026-10-26](production-readiness-audit.md) — Focused corrections and fresh validation; security and target-environment release gates remain open.

- [Graceful rolling restarts](2026-10-29-graceful-rolling-restarts.md) — Native service draining and isolated Kubernetes acceptance; final review in progress.

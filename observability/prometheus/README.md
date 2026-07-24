# Prometheus Rules

Load every rule file under `alerts/` into the Prometheus-compatible rule
evaluator used by the deployment environment. The platform does not install a
Prometheus server.

`control-plane-automation.rules.yaml` covers the production Agent and Workflow
objectives for dispatch backlog, scheduler lag, stale approvals, uncertain
writes, trigger rejection, MCP dependencies, PDF rendering, and terminal
outcomes. Scrape the control-plane `/metrics` endpoint from every replica so
per-process counters and the Postgres-derived runtime gauges are both visible.

The MCP rules alert on failed durable credential cleanup, sustained remote
401/403 transitions, and scheduled workflows auto-paused by exact-tool
readiness. Remote MCP availability is intentionally absent from platform
readiness: use the kill switch while repairing an external dependency.

# Deployment-owned workflow policy

Expose report retention as a validated Helm value and map it to `TARGET_CHAT_REPORT_RETENTION_DAYS` across supported deployment surfaces. Keep `AGENT_MAX_RUNTIME_MS` as the sole execution limit and validate rendered defaults, overrides, and schema bounds.

Coordinated by the parent workspace `plan.md`. Related repositories: `control-plane`, `management-console`, and `docs-website`.

Completed: Helm, Compose, environment examples, docs, schema bounds, chart assertions, and deployment contract surfaces now carry the deployment-owned report-retention policy.

# Hosted-readiness deployment integration

> Archive review — 2026-10-18: Implementation has landed on main. This plan is retained as delivery history, not active implementation work.
> Original scope, checklists, and validation below are historical; this is not a new runtime or rollout validation report.

Scope: wire the shared execution-capacity mode, control-plane admission/dispatch gates and gateway lifecycle credential in local Compose, VM Compose and Helm. Keep capacity disabled by default and retain independently self-hostable deployment tracks. Add a rollout runbook and a five-pool example; do not claim current published images contain unreleased source changes.

Validation: render both Compose tracks, run `task validate`, Helm lint/template checks included by the repository, and run platform contract checks against sibling repositories. Source-mode integration is verified separately against disposable PostgreSQL/Redis. No live deployment or published release is part of this change.

Status: implementation, canonical validation and scoped review passed. The activated-catalogue procedure closes gates and drains before changing mode/catalogue, matching runtime startup guards. Coordinated implementation has landed on main; deployment acceptance remains separate.

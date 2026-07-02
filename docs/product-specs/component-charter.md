# Deployment Component Charter

## Responsibilities

- Provide the supported deployment and local development harness for AcornOps.
- Own compose topology and profiles.
- Own deployment-track env templates.
- Own local bootstrap and doctor scripts.
- Own VM production runbooks.
- Own Kubernetes platform Helm chart and chart validation.
- Own agentk rollout scripts.
- Own stack compatibility metadata.

## Non-Goals

- Service runtime implementation
- Product UI behavior
- Operator-managed backing services such as Postgres, Redis, object storage, and DNS

## Primary Consumers

- AcornOps contributors running the full local stack
- Operators deploying Docker-on-VM environments
- Operators deploying the central platform chart
- Component repositories that consume shared deployment contracts

# Deployment Repository Architecture

For the whole-system service topology, use the workspace-level
[System Architecture](../docs/system-architecture.md). For deployment-specific
topology, use [docs/deployment-architecture.md](docs/deployment-architecture.md).
This file documents only the deployment repository's internal ownership and
structure.

The deployment repository is the distribution and operations layer for:

1. local full-stack bring-up
2. Docker-on-VM production deployment
3. Kubernetes cluster-agent rollout automation
4. environment and profile management by deployment track
5. release compatibility metadata

## High-Level Diagram

```mermaid
flowchart LR
    Operator[Operator / Developer]
    Task[Taskfile + scripts]
    Compose[Compose stacks + profiles]
    Env[Environment files]
    Stack[AcornOps services]
    Agent[agentk deployment]
    Runbooks[Docs / runbooks / release metadata]

    Operator --> Task
    Task --> Compose
    Task --> Env
    Compose --> Stack
    Task --> Agent
    Operator --> Runbooks
```

## Detailed Diagram

```mermaid
flowchart TD
    subgraph Entry[Operator Entry Points]
        Taskfile[Taskfile.yml]
        Scripts[scripts/]
        Docs[docs/]
    end

    subgraph Config[Configuration Inputs]
        LocalEnv[env/local/.env.local]
        LocalAgentEnv[env/local/.env.agent]
        ProdEnv[env/vm/.env.prod]
        VmAgentEnv[env/vm/.env.agent]
        K8sAgentEnv[env/k8s/.env.agent]
        Versions[release/stack-versions.yaml]
    end

    subgraph Compose[Compose Topology]
        VMCompose[compose/vm-prod/compose.yaml]
        LocalOverlay[compose/local/compose.source.yaml]
        Proxy[proxy / OIDC / support config]
    end

    subgraph Managed[Managed Services]
        Console[management-console]
        CP[control-plane]
        EE[execution-engine]
        GW[llm-gateway]
        Agent[agentk]
    end

    Taskfile --> Scripts
    Taskfile --> LocalEnv
    Taskfile --> LocalAgentEnv
    Taskfile --> ProdEnv
    Taskfile --> VmAgentEnv
    Taskfile --> K8sAgentEnv
    Taskfile --> VMCompose
    Taskfile --> LocalOverlay
    Taskfile --> Versions

    VMCompose --> Proxy
    VMCompose --> Console
    VMCompose --> CP
    VMCompose --> EE
    VMCompose --> GW

    LocalOverlay --> Console
    LocalOverlay --> CP
    LocalOverlay --> EE
    LocalOverlay --> GW
    LocalOverlay --> Agent

    Scripts --> Agent
    Docs --> VMCompose
```

## Primary Responsibilities

1. define the supported deployment tracks and compose profiles
2. centralize stack env templates, operational scripts, and runbooks
3. wire the six repositories into a runnable local or production-like stack
4. manage version compatibility expectations for image-based deployments
5. keep cluster-agent deployment separate from the central service lifecycle

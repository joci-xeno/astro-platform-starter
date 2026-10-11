# Integration matrix 2026-10-11

static import closure + test-file references + live Control Center boot; static reachability is not 'running', 'tested' is not 'end-to-end verified'. LIMITATION: test linkage is by file name; Control Center panels are exercised through HTTP tests (control-center-*.test.mjs) without naming the panel file, so panels can show 0 tests here although they have HTTP tests; dynamic/string-built imports are not seen by the import closure.

Modules: 254; tally {"PARTIAL":206,"VERIFIED_WORKING":46,"EXTERNAL_BLOCKER":2}; connected {"master":22,"agents":21,"controlCenter":121,"isolatedFromAll":133}

| Module | Master | Agents | Control Center | Tests (integration) | Status | Why not verified |
|---|---|---|---|---|---|---|
| addons/a11y-audit.mjs | - | - | - | 7 (1) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/a11y-worker.mjs | - | - | - | 0 (0) | PARTIAL | no test references it and nothing in the Control Center loads it (isolated) |
| addons/agent-activity.mjs | - | - | Y | 5 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/agent-coordination.mjs | Y | Y | Y | 7 (1) | VERIFIED_WORKING |  |
| addons/agent-executors.mjs | Y | Y | Y | 3 (3) | VERIFIED_WORKING |  |
| addons/agent-factory.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/agent-memory.mjs | Y | Y | Y | 8 (2) | VERIFIED_WORKING |  |
| addons/agent-portfolio-manager.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/agent-registry.mjs | Y | Y | Y | 5 (4) | VERIFIED_WORKING |  |
| addons/agent-tool-broker.mjs | - | - | - | 3 (1) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/agent-tool-policy.mjs | Y | Y | Y | 6 (1) | VERIFIED_WORKING |  |
| addons/agent-workforce.mjs | Y | Y | Y | 4 (4) | VERIFIED_WORKING |  |
| addons/alt-solution-harness.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/analyst.mjs | - | - | Y | 5 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/anti-collusion-guard.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/approval-command-gateway.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/approval-requests.mjs | - | - | Y | 5 (4) | VERIFIED_WORKING |  |
| addons/architecture-assessor.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/assistant-profiles.mjs | - | - | Y | 10 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/audit-chain.mjs | Y | Y | Y | 17 (2) | VERIFIED_WORKING |  |
| addons/backtest.mjs | - | - | Y | 3 (1) | VERIFIED_WORKING |  |
| addons/backup-recovery.mjs | - | - | Y | 3 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/brain/behavior-monitor.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/black-box.mjs | - | - | Y | 8 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/brain/brain-health.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/brain-system.mjs | - | - | - | 5 (1) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/business-factory.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/capability-graph.mjs | - | - | Y | 8 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/brain/central-brain.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/disaster-recovery.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/brain/evidence-sources.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/governance.mjs | - | - | - | 6 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/governed-dispatch.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/knowledge-brain.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/memory-fabric.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/model-intelligence.mjs | - | - | Y | 5 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/brain/opportunity-intelligence.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/brain/orchestrator.mjs | - | - | Y | 6 (1) | VERIFIED_WORKING |  |
| addons/brain/owner-command.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/brain/planning-brain.mjs | - | - | - | 4 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/search-pipeline.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/security-brain.mjs | - | - | - | 8 (1) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/simulation-lab.mjs | - | - | - | 3 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/brain/verifier.mjs | - | - | - | 6 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/browser-extension-guard.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/budget-consumption-governor.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/artifact-registry.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/communication-center.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/crm.mjs | - | - | - | 3 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/deal-pipeline.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/delivery-service.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/entity-graph.mjs | - | - | - | 6 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/finance-intelligence.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/inbox-pipeline.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/invoice-service.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/job-system.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/judge.mjs | - | - | Y | 6 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/business/money-engine.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/payment-verification.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/qa-factory.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/recurring-billing.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/business/store.mjs | Y | Y | Y | 16 (5) | VERIFIED_WORKING |  |
| addons/business-memory.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/buyer-decision-maker-finder.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/campaign-manager.mjs | - | - | Y | 2 (1) | VERIFIED_WORKING |  |
| addons/capability-registry.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/chat-providers.mjs | - | - | Y | 2 (1) | VERIFIED_WORKING |  |
| addons/checkpoint-engine.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/chunker.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/client-dna-engine.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/code-edit-workflow.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/code-review.mjs | - | - | Y | 3 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/code-sandbox.mjs | - | - | Y | 3 (1) | VERIFIED_WORKING |  |
| addons/completion-registry.mjs | - | - | - | 2 (1) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/computer-use-fabric.mjs | - | - | - | 3 (0) | EXTERNAL_BLOCKER | needs a sandboxed computer-use provider; policy layer only |
| addons/connector-catalog.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/context-manager.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/contract-analysis.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/conversation.mjs | - | - | Y | 4 (1) | VERIFIED_WORKING |  |
| addons/cost-model-router.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/credential-broker.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/data-quality.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/dead-letter-queue.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/deal-state.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/debate-protocol.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/decision-analysis.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/delivery-engine.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/detail-level.mjs | - | - | Y | 3 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/dev-assist-common.mjs | - | - | - | 3 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/digital-twin.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/doc-extractors.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/doc-sync.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/document-center.mjs | - | - | Y | 15 (3) | VERIFIED_WORKING |  |
| addons/durable-queue.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/effort-allocation.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/egress-policy.mjs | - | - | Y | 5 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/eligibility-model.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/embedding-provider.mjs | Y | Y | Y | 5 (1) | EXTERNAL_BLOCKER | embedding model activation awaits owner (EMBEDDING_ACTIVATE) |
| addons/emergency-stop.mjs | - | - | Y | 5 (1) | VERIFIED_WORKING |  |
| addons/enterprise-control-plane.mjs | - | - | - | 3 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/enterprise-knowledge-agentic-rag.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/event-bus.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/event-stream.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/evidence-record.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/execution-factory.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/executor-toolbox-registry.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/experience-learning-engine.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/file-lock.mjs | Y | Y | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/financial-ledger.mjs | Y | Y | Y | 8 (2) | VERIFIED_WORKING |  |
| addons/follow-up-engine.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/form-assistant.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/general-intelligence-extensions.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/global-business-intelligence.mjs | - | - | Y | 1 (1) | VERIFIED_WORKING |  |
| addons/global-discovery.mjs | Y | Y | Y | 3 (2) | VERIFIED_WORKING |  |
| addons/goal-planner.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/guardrail-engine.mjs | - | - | - | 3 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/handoff-ledger.mjs | Y | Y | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/human-core.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/internal-integration-hub.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/invoice-engine.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/knowledge-projects.mjs | Y | Y | Y | 9 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/local-ai-manager.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/local-update-adapters.mjs | - | - | Y | 3 (1) | VERIFIED_WORKING |  |
| addons/market-data.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/market-intelligence-engine.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/master-brief.mjs | - | - | Y | 2 (1) | VERIFIED_WORKING |  |
| addons/master-coordinator.mjs | Y | - | Y | 2 (2) | VERIFIED_WORKING |  |
| addons/master-planner-orchestrator.mjs | Y | Y | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/mcp-client.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/memory-store.mjs | Y | Y | Y | 10 (2) | VERIFIED_WORKING |  |
| addons/migration-planner.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/mobile-api.mjs | - | - | Y | 1 (1) | VERIFIED_WORKING |  |
| addons/modality-fabric.mjs | - | - | Y | 4 (2) | VERIFIED_WORKING |  |
| addons/model-evolution.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/model-gateway.mjs | - | - | Y | 4 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/model-registry.mjs | - | - | Y | 6 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/model-routing-bridge.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/money-pipeline-controller.mjs | - | - | - | 3 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/money-supervisor.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/multi-model-brain.mjs | - | - | - | 3 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/multi-solution.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/negotiation-engine.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/notes-organizer.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/observability-black-box.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/observation-memory.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/opportunity-qualification-engine.mjs | Y | Y | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/orb-strategy.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/org-intelligence.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/outcome-compiler.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-auth.mjs | - | - | Y | 70 (6) | VERIFIED_WORKING |  |
| addons/owner-control/agent-governor.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-control/approval-gateway.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/owner-control/claim-distinctions.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-control/control-chain.mjs | - | - | - | 3 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-control/financial-firewall.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-control/money-state-guard.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-control/owner-authority.mjs | - | - | Y | 6 (1) | VERIFIED_WORKING |  |
| addons/owner-control/owner-control-system.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-control/recovery-points.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-control/recovery-source-map.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-control/safe-mode-scope.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/owner-control/system-doctor.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/owner-keystore.mjs | - | - | Y | 3 (3) | VERIFIED_WORKING |  |
| addons/page-ingest.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/paper-trader.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/payment-confirmation-adapter.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/payment-package-intake.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/personal-command-center.mjs | - | - | Y | 1 (1) | VERIFIED_WORKING |  |
| addons/plugin-installer.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/plugin-manager.mjs | - | - | Y | 9 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/preferences.mjs | - | - | Y | 6 (2) | VERIFIED_WORKING |  |
| addons/priority-queue-rate-limit-governor.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/probe-evidence.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/profit-accounting-engine.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/profit-ledger.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/progress-ledger.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/project-memory.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/proposal-quote-engine.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/prototype-builder.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/provider-adapters.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/provider-egress.mjs | - | - | Y | 3 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/provider-resilience.mjs | - | - | Y | 5 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/qa-reviewer.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/quarantine.mjs | - | - | Y | 3 (1) | VERIFIED_WORKING |  |
| addons/reasoning-common.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/recovery.mjs | - | - | - | 7 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/regression-eval-suite.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/release-signing.mjs | - | - | Y | 3 (1) | VERIFIED_WORKING |  |
| addons/render.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/repo-analyzer.mjs | - | - | Y | 3 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/research-ledger.mjs | - | - | Y | 8 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/restricted-node.mjs | Y | Y | Y | 17 (8) | VERIFIED_WORKING |  |
| addons/retrieval-eval.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/revenue-persistence.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/safe-keys.mjs | Y | Y | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/safe-mode.mjs | - | - | Y | 4 (1) | VERIFIED_WORKING |  |
| addons/scheduler.mjs | - | - | - | 4 (1) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/secret-patterns.mjs | Y | Y | Y | 5 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/secret-vault.mjs | - | - | Y | 6 (2) | VERIFIED_WORKING |  |
| addons/security-gates.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/self-healing-loop.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/semantic-index.mjs | Y | Y | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/shared-project-registry.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/skill-factory.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/skill-registry.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/social-drafts.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/source-adapters.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/source-allowlist.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/spaced-repetition.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/stall-replanner.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/startup-self-check.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/suggestions.mjs | - | - | Y | 4 (1) | VERIFIED_WORKING |  |
| addons/task-ledger.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/tax-accounting-engine.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/team-lead-workflows.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/tech-watch.mjs | - | - | Y | 2 (1) | VERIFIED_WORKING |  |
| addons/tenant-isolation.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/test-intelligence.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/text-compare.mjs | - | - | Y | 3 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/tool-bridge.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/tool-fabric.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/tracing-evals.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/transcript-actions.mjs | - | - | Y | 2 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/translation-feedback.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/tutor.mjs | - | - | Y | 3 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/typed-tools.mjs | - | - | Y | 9 (3) | VERIFIED_WORKING |  |
| addons/unified-entity-graph.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/universal-connector-layer.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/universal-inbox.mjs | - | - | Y | 4 (1) | VERIFIED_WORKING |  |
| addons/update-center.mjs | - | - | Y | 5 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| addons/voice-conversation.mjs | - | - | Y | 2 (1) | VERIFIED_WORKING |  |
| addons/voice-interface.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/voice-session.mjs | - | - | Y | 3 (1) | VERIFIED_WORKING |  |
| addons/watchdog.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| addons/workbench.mjs | - | - | Y | 5 (2) | VERIFIED_WORKING |  |
| addons/workflow-engine.mjs | - | - | Y | 1 (0) | PARTIAL | connected, but only unit-tested (no integration/E2E test references it) |
| control-center/agents-panel.mjs | - | - | Y | 0 (0) | PARTIAL | loaded by the Control Center but no test file references it by name |
| control-center/brain-views.mjs | - | - | Y | 0 (0) | PARTIAL | loaded by the Control Center but no test file references it by name |
| control-center/chat-providers-panel.mjs | - | - | Y | 0 (0) | PARTIAL | loaded by the Control Center but no test file references it by name |
| control-center/core.mjs | - | - | Y | 14 (13) | VERIFIED_WORKING |  |
| control-center/memory-panel.mjs | - | - | Y | 0 (0) | PARTIAL | loaded by the Control Center but no test file references it by name |
| control-center/model-registry-panel.mjs | - | - | Y | 0 (0) | PARTIAL | loaded by the Control Center but no test file references it by name |
| control-center/money-views.mjs | - | - | Y | 3 (1) | VERIFIED_WORKING |  |
| control-center/ops-views.mjs | - | - | Y | 0 (0) | PARTIAL | loaded by the Control Center but no test file references it by name |
| control-center/security-center-panel.mjs | - | - | Y | 0 (0) | PARTIAL | loaded by the Control Center but no test file references it by name |
| control-center/server.mjs | - | - | Y | 34 (33) | VERIFIED_WORKING |  |
| control-center/trading-panel.mjs | - | - | Y | 0 (0) | PARTIAL | loaded by the Control Center but no test file references it by name |
| control-center/vault-panel.mjs | - | - | Y | 0 (0) | PARTIAL | loaded by the Control Center but no test file references it by name |
| runtime/agent-child.js | - | - | - | 0 (0) | PARTIAL | no test references it and nothing in the Control Center loads it (isolated) |
| runtime/owner-cli.mjs | - | - | - | 2 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| runtime/runtime-http.mjs | - | - | - | 1 (0) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| runtime/supervisor-safe.mjs | - | - | - | 24 (9) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |
| runtime/supervisor.js | - | - | - | 0 (0) | PARTIAL | no test references it and nothing in the Control Center loads it (isolated) |
| runtime/worker.js | - | - | - | 2 (1) | PARTIAL | tested as a library but not reachable from Master, agents or Control Center (disconnected) |

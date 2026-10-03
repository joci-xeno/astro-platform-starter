// ATLASZ general intelligence extension registry.
// This file defines the capability slots requested by the owner.
// A slot is not considered LIVE until a real provider/tool is attached and its probe passes.

export const GENERAL_CAPABILITY_SLOTS = Object.freeze([
  { id: "general-reasoning-planning", label: "General Reasoning & Planning", layer: "MASTER", requiresProvider: true },
  { id: "broad-toolkit-discovery", label: "Broad Toolkit & Capability Discovery", layer: "TOOLS", requiresProvider: true },
  { id: "autonomous-debug-recovery", label: "Autonomous Debugging & Recovery", layer: "RECOVERY", requiresProvider: true },
  { id: "novel-situation-adaptation", label: "Novel Situation Adaptation", layer: "MASTER", requiresProvider: true },
  { id: "independent-verification-inference", label: "Independent Verification & Inference", layer: "JUDGE", requiresProvider: true },
  { id: "broad-knowledge-language", label: "Broad Knowledge & Language", layer: "KNOWLEDGE", requiresProvider: true },
  { id: "code-create-maintain", label: "Code Creation & Maintenance", layer: "EXECUTION", requiresProvider: true },
  { id: "higher-level-supervisor", label: "Higher-Level Independent Supervisor", layer: "AUDIT", requiresProvider: true }
]);

export function createGeneralCapabilityExtension({ providers = {}, tools = {} } = {}) {
  const status = GENERAL_CAPABILITY_SLOTS.map(slot => {
    const provider = providers[slot.id] || null;
    const tool = tools[slot.id] || null;
    const connected = Boolean(provider || tool);
    return {
      ...slot,
      state: connected ? "CONNECTED_UNTESTED" : "PLACEHOLDER_UNCONNECTED",
      provider: provider?.name || null,
      tool: tool?.name || null,
      tested: false,
      live: false
    };
  });

  return {
    name: "ATLASZ General Intelligence Extensions",
    version: "1.0.0",
    safety: {
      preserveRevenueEngine: true,
      searchAgents: 5,
      executionAgents: 25,
      noSpendByDefault: true,
      ownerApprovalForSpend: true,
      neverFakeSent: true,
      neverFakePaid: true
    },
    list: () => status.map(x => ({ ...x })),
    get: id => {
      const item = status.find(x => x.id === id);
      return item ? { ...item } : null;
    },
    summary: () => ({
      total: status.length,
      live: status.filter(x => x.live).length,
      connectedUntested: status.filter(x => x.state === "CONNECTED_UNTESTED").length,
      placeholders: status.filter(x => x.state === "PLACEHOLDER_UNCONNECTED").length
    })
  };
}

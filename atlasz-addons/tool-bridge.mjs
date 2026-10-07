import {isTested} from "./probe-evidence.mjs";
// ATLASZ Tool Bridge v1.0
// Synchronizes a REAL connector/adapter across Universal Connector, Tool Fabric and Executor Toolbox.
// It never marks an untested adapter LIVE/available.
export function createToolBridge({registerConnector,connectFabricTool,registerTool}={}){
 if(!registerConnector||!connectFabricTool||!registerTool)throw new Error("TOOL_BRIDGE_REGISTRIES_REQUIRED");
 function attach({tenantId="ATLASZ",id,category,capabilities=[],permissions=[],adapter=null,tested=false,probeEvidence=null,requiresApproval=false,costClass="UNKNOWN"}={}){tested=isTested(tested,probeEvidence);
  if(!id||!category||!adapter)throw new Error("REAL_TOOL_ADAPTER_REQUIRED");
  const connector=registerConnector({id,tenantId,capabilities,permissions,status:tested?"TESTED":"UNTESTED",adapter});
  const fabric=connectFabricTool({id,adapter,tested,probeEvidence,costClass});
  const executor=registerTool({id,category,capabilities,available:Boolean(tested),requiresApproval,costClass,adapter});
  return {id,tested:Boolean(tested),live:Boolean(tested),connectorStatus:connector.status,fabricState:fabric.state,executorAvailable:executor.available};
 }
 return {attach};
}

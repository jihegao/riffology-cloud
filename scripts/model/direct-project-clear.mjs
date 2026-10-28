/** Temporary private RPC, appended to the exact downloaded production module.
 * No public handler, namespace migration, revival fence or admission changes.
 * The caller must remove this addition after the explicitly authorized cleanup.
 */
export function installDirectProjectClear(classes,configuration){
  const bindings={WorkspaceAgent:'WORKSPACE_AGENT',RevisionStore:'REVISION_STORE',ManagedProductRuntime:'MANAGED_TURN_RUNTIME',ProductTurnRuntime:'PRODUCT_TURN_RUNTIME',ProjectRuntime:'PROJECT_RUNTIME',ToolBridgeAgent:'TOOL_BRIDGE_AGENT',ProjectToolSandbox:'PROJECT_SANDBOX',TrustedPiSandbox:'TRUSTED_PI_SANDBOX',ServiceRun:'SERVICE_RUN',ServiceRuntime:'SERVICE_RUNTIME',ServiceSandbox:'SERVICE_SANDBOX',SimulationSandbox:'SIMULATION_SANDBOX',ProjectViewRuntime:'PROJECT_VIEW_RUNTIME'};
  const forbidden=new Set(['message','prompt','body','content','files','payload','command','command_json','result','result_json','stdout','stderr','script','metrics','parameters','trace','snapshot','snapshot_json','recoveryContext']);
  const hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
  const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const safeUsage=value=>{
    if(!plain(value))return null;
    return Object.fromEntries(Object.entries(value).filter(([k,v])=>['status','kind','reason','settlement','inputTokens','outputTokens','totalTokens','cachedInputTokens'].includes(k)&&(typeof v==='number'||typeof v==='string'&&/^[a-z-]{1,40}$/.test(v))));
  };
  for(const [className,allowed] of Object.entries(configuration.actors)){
    const Class=classes[className],binding=bindings[className];
    if(!Class||!binding||Object.hasOwn(Class.prototype,'issue212DirectClear'))throw Error('direct-clear-class-invalid');
    Object.defineProperty(Class.prototype,'issue212DirectClear',{configurable:true,value:async function(input){
      if(!plain(input)||Object.keys(input).sort().join(',')!=='action,actorName,capability'||!['inspect','clear','delete-remote'].includes(input.action)||typeof input.capability!=='string'||input.capability.length!==64||Date.now()>=configuration.expiresAt)throw Error('direct-clear-denied');
      const actual=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.capability)));let difference=0;
      for(let i=0;i<64;i++)difference|=actual.charCodeAt(i)^configuration.capabilitySha256.charCodeAt(i);
      if(difference||!allowed.includes(input.actorName)||!this.env[binding].idFromName(input.actorName).equals(this.ctx.id))throw Error('direct-clear-denied');
      if(input.action!=='inspect'&&!configuration.clearActors?.[className]?.includes(input.actorName))throw Error('direct-clear-denied');
      const storage=this.ctx.storage;
      const inspection={className,actorName:input.actorName,kvCount:0,scopes:[],turnIdentities:[],initialRuntimes:[],warmLeases:[],relatedActors:[],metadataKeys:[],managedCosts:[],tables:[],remoteSessions:[],containerRunning:this.ctx.container?.running===true};
      const scopes=new Map(),turns=new Map(),initials=new Map(),warmLeases=new Map(),related=new Map(),keys=new Set(),sessions=new Set();let visited=0;
      function visit(value,depth=0){
        if(!plain(value)&&!Array.isArray(value))return;
        if(++visited>200000||depth>40)throw Error('direct-clear-inspection-limit');
        if(plain(value)){
          const s=value.scope??value;
          if(plain(s)&&['tenantId','projectId','workspaceId'].every(k=>typeof s[k]==='string')&&Number.isSafeInteger(s.workspaceGeneration??s.generation)){
            const scope={tenantId:s.tenantId,projectId:s.projectId,workspaceId:s.workspaceId,workspaceGeneration:s.workspaceGeneration??s.generation};scopes.set(JSON.stringify(scope),scope);
            if(plain(value.scope)&&['sessionId','turnId','dispatchId'].every(k=>typeof value[k]==='string')&&Number.isSafeInteger(value.generation)){
              const identity={scope,sessionId:value.sessionId,turnId:value.turnId,dispatchId:value.dispatchId,generation:value.generation};turns.set(JSON.stringify(identity),identity);
            }
          }
          if(typeof value.runtimeId==='string'&&typeof value.tenantId==='string'&&typeof value.workspaceId==='string'&&Number.isSafeInteger(value.generation)){
            const identity=Object.fromEntries(['tenantId','projectId','workspaceId','generation','runtimeId','leaseId','operationId'].filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));initials.set(JSON.stringify(identity),identity);
          }
          if(typeof value.remoteSessionId==='string')sessions.add(value.remoteSessionId);
          if(plain(value.scope)&&typeof value.leaseId==='string'&&Number.isSafeInteger(value.leaseEpoch)&&typeof value.runtimeVersion==='string'){
            const lease={scope:value.scope,leaseId:value.leaseId,leaseEpoch:value.leaseEpoch,runtimeVersion:value.runtimeVersion};warmLeases.set(JSON.stringify(lease),lease);
          }
          if(plain(value.scope)&&typeof value.runId==='string'&&value.spec)related.set('service:'+value.runId,{kind:'service',scope:value.scope,runId:value.runId});
          if(value.schema==='project.view-session/v1'&&plain(value.scope)&&typeof value.sessionId==='string')related.set('view:'+value.sessionId,{kind:'projectView',actorName:'project-view-'+value.sessionId});
          for(const [key,v] of Object.entries(value)){
            if(forbidden.has(key))continue;
            if(['objectKey','blobKey','contentRef','packageKey','checkpointKey'].includes(key)&&typeof v==='string'&&v.length<1024)keys.add(v);
            if(typeof v==='string'&&['identity_json','scope_json','record_json','document','value_json'].includes(key)){try{visit(JSON.parse(v),depth+1);}catch(error){if(error instanceof SyntaxError)throw Error('direct-clear-invalid-json');throw error;}}
            else visit(v,depth+1);
          }
        }else for(const v of value)visit(v,depth+1);
      }
      if(className==='WorkspaceAgent'){
        for(const [key,value]of storage.kv.list()){
          if(key.startsWith('simulation:run:')&&value.input){
            const token=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value.input)))).slice(0,52);related.set('simulation:'+token,{kind:'simulation',actorName:'simulation-'+token});
          }
          if(key.startsWith('m3:service:')&&value.reference){related.set(key,{kind:'serviceReference',reference:value.reference,scope:value.scope});}
        }
      }
      let after;
      for(let page=0;page<100;page++){
        const values=await storage.list({limit:128,...(after===undefined?{}:{startAfter:after})});
        for(const [key,value] of values){inspection.kvCount++;visit(value);after=key;
          if(className==='ManagedProductRuntime'&&key.startsWith('turn:'))inspection.managedCosts.push({identity:value.input?{scope:value.input.scope,sessionId:value.input.sessionId,turnId:value.input.turnId,dispatchId:value.input.dispatchId,generation:value.input.generation}:null,operation:value.operation,reserved:value.reserved===true,cost:typeof value.cost==='number'?value.cost:null,usage:safeUsage(value.observation?.usage),execution:value.observation?.execution??'unknown',closed:value.closed===true,deletion:value.deletion?{intent:value.deletion.intent,acknowledgedAt:value.deletion.acknowledgedAt,absentAt:value.deletion.absentAt}:null});
        }
        if(values.size<128)break;if(page===99)throw Error('direct-clear-inspection-limit');
      }
      const tables=storage.sql.exec("SELECT name,sql FROM sqlite_master WHERE type='table' AND substr(name,1,4)!='_cf_' ORDER BY name").toArray();
      if(className==='ManagedProductRuntime'&&tables.some(t=>t.name==='execution_bindings'))for(const row of storage.sql.exec('SELECT value FROM execution_bindings').toArray())visit(JSON.parse(row.value));
      if(className==='ServiceRun'&&tables.some(t=>t.name==='service_coordination')&&tables.some(t=>t.name==='service_runs')){
        const states=new Map(storage.sql.exec('SELECT run_id,state_json FROM service_coordination').toArray().map(r=>[r.run_id,JSON.parse(r.state_json)]));
        for(const row of storage.sql.exec('SELECT id,record_json FROM service_runs').toArray()){
          const run=JSON.parse(row.record_json),state=states.get(row.id);if(!state?.lease)continue;
          const nativeInput={reference:{runId:run.id,runtimeId:state.runtimeId,dispatchId:state.request.operationId,leaseId:state.lease.leaseId,generation:1,deadlineAt:state.request.deadlineAt},scope:run.scope,spec:run.spec,lease:state.lease},token=await serviceNativeToken(nativeInput);
          related.set('native-service:'+token,{kind:'serviceRuntime',actorName:'m3-runtime-'+token,sandboxName:'m3-s-'+token});
        }
      }
      const isolations=[];
      for(const table of tables){
        if(!/^[a-zA-Z0-9_]+$/.test(table.name))throw Error('direct-clear-table-invalid');
        const columns=storage.sql.exec('PRAGMA table_info('+table.name+')').toArray().map(r=>r.name),selected=columns.filter(k=>['identity_json','scope_json','record_json','document','value_json','remote_session_id'].includes(k));
        const count=storage.sql.exec('SELECT count(*) AS n FROM '+table.name).one().n;inspection.tables.push({name:table.name,count});
        if(selected.length)for(const row of storage.sql.exec('SELECT '+selected.join(',')+' FROM '+table.name).toArray()){if(row.remote_session_id)sessions.add(row.remote_session_id);visit(row);}
        if(table.name==='product_turn_execution_isolations')isolations.push({sql:table.sql,rows:storage.sql.exec('SELECT identity_digest,identity_json,fenced_at,classification FROM product_turn_execution_isolations').toArray()});
      }
      if(className==='ManagedProductRuntime'&&!inspection.managedCosts.length&&tables.some(t=>t.name==='issue212_retained_execution_summaries'))inspection.managedCosts=storage.sql.exec('SELECT summary_json FROM issue212_retained_execution_summaries ORDER BY ordinal').toArray().map(r=>JSON.parse(r.summary_json));
      inspection.scopes=[...scopes.values()];inspection.turnIdentities=[...turns.values()];inspection.initialRuntimes=[...initials.values()];inspection.warmLeases=[...warmLeases.values()];inspection.relatedActors=[...related.values()];inspection.metadataKeys=[...keys];inspection.remoteSessions=[...sessions];
      if(input.action==='inspect')return inspection;
      if(input.action==='delete-remote'){
        if(className!=='ManagedProductRuntime'||!tables.some(t=>t.name==='execution_bindings'))throw Error('direct-clear-remote-scope-denied');
        if(inspection.managedCosts.some(r=>r.reserved&&!['completed','failed','cancelled'].includes(r.execution)))throw Error('direct-clear-remote-execution-unconfirmed');
        const store=new SqlExecutionBindingStore(storage),transport=new ManagedSdkTransport({apiKey:this.env.MANAGED_OPENAI_API_KEY??'',store,admission:{reserve:async()=>{throw Error('direct-clear-no-inference');},readInput:async()=>null}});
        storage.sql.exec('CREATE TABLE IF NOT EXISTS issue212_remote_deletion(session_id TEXT PRIMARY KEY,intent_json TEXT,attempted INTEGER NOT NULL,absent_at INTEGER) STRICT');await storage.sync();
        const receipts=[];
        for(const sessionId of inspection.remoteSessions){
          const raw=storage.sql.exec('SELECT value FROM execution_bindings').toArray().map(r=>JSON.parse(r.value)).find(b=>b.remoteSessionId===sessionId);if(!raw)throw Error('direct-clear-remote-binding-missing');
          const binding=await store.read(raw.identity);if(!binding||binding.remoteSessionId!==sessionId)throw Error('direct-clear-remote-binding-conflict');
          const old=storage.sql.exec('SELECT intent_json,attempted,absent_at FROM issue212_remote_deletion WHERE session_id=?',sessionId).toArray()[0];
          let absent=false;
          try{await transport.client.beta.agents.sessions.retrieve(sessionId);}catch(error){if(error.status!==404)throw error;absent=true;}
          if(!absent){
            let intent=old?.intent_json?JSON.parse(old.intent_json):await transport.prepareSessionDeletion(binding);
            if(!old){storage.sql.exec('INSERT INTO issue212_remote_deletion VALUES(?,?,0,NULL)',sessionId,JSON.stringify(intent));await storage.sync();}
            if(old?.attempted)throw Error('direct-clear-remote-original-delete-unconfirmed');
            storage.sql.exec('UPDATE issue212_remote_deletion SET attempted=1 WHERE session_id=?',sessionId);await storage.sync();
            await transport.deleteSession(binding);
            absent=(await transport.observeSessionDeletion(binding,intent)).absent;
          }
          if(!absent)throw Error('direct-clear-remote-absence-unconfirmed');
          storage.sql.exec('INSERT INTO issue212_remote_deletion VALUES(?,NULL,0,?) ON CONFLICT(session_id) DO UPDATE SET absent_at=excluded.absent_at',sessionId,Date.now());await storage.sync();receipts.push({sessionId,absent:true});
        }
        return {className,actorName:input.actorName,remoteSessions:receipts};
      }
      // Destruction is scoped to the exact original actor; it never confirms or
      // releases a quota/capacity reservation and never retries a model request.
      let remoteReceipts=[],retainedBindings=[],retainedBudget=null;
      if(className==='ManagedProductRuntime'){
        const budget=storage.kv.get('budget');if(budget)retainedBudget={policy:budget.policy,startedAt:budget.startedAt,stopped:budget.stopped,simulationRunIds:budget.simulations};
        else if(tables.some(t=>t.name==='issue212_retained_budget'))retainedBudget=JSON.parse(storage.sql.exec('SELECT summary_json FROM issue212_retained_budget WHERE singleton=1').one().summary_json);
      }
      if(className==='ManagedProductRuntime'&&inspection.remoteSessions.length){
        if(tables.some(t=>t.name==='issue212_remote_deletion'))remoteReceipts=storage.sql.exec('SELECT session_id,intent_json,attempted,absent_at FROM issue212_remote_deletion').toArray();
        if(!tables.some(t=>t.name==='execution_bindings'))throw Error('direct-clear-remote-binding-missing');
        // Provider deletion may be unavailable. Keep the original content-free
        // correlation/remote identity for later cleanup, never the input/events.
        retainedBindings=storage.sql.exec('SELECT identity,session_key,value FROM execution_bindings').toArray();
        for(const row of retainedBindings){const binding=JSON.parse(row.value);if(Object.keys(binding).some(k=>!['schemaVersion','backend','identity','inputSha256','remoteSessionId','remoteTurnId','reservedAt','attachedAt'].includes(k)))throw Error('direct-clear-binding-summary-invalid');}
      }
      if(this.ctx.container?.running)await this.ctx.container.destroy();
      if(this.ctx.container?.running)throw Error('direct-clear-container-still-running');
      await storage.deleteAlarm();await storage.deleteAll();
      // Preserve original no-content execution isolation and managed accounting.
      for(const table of isolations){storage.sql.exec(table.sql);for(const row of table.rows)storage.sql.exec('INSERT INTO product_turn_execution_isolations VALUES(?,?,?,?)',row.identity_digest,row.identity_json,row.fenced_at,row.classification);}
      if(remoteReceipts.length){storage.sql.exec('CREATE TABLE issue212_remote_deletion(session_id TEXT PRIMARY KEY,intent_json TEXT,attempted INTEGER NOT NULL,absent_at INTEGER) STRICT');for(const row of remoteReceipts)storage.sql.exec('INSERT INTO issue212_remote_deletion VALUES(?,?,?,?)',row.session_id,row.intent_json,row.attempted,row.absent_at);}
      if(retainedBindings.length){storage.sql.exec('CREATE TABLE execution_bindings(identity TEXT PRIMARY KEY,session_key TEXT NOT NULL,value TEXT NOT NULL) STRICT');for(const row of retainedBindings)storage.sql.exec('INSERT INTO execution_bindings VALUES(?,?,?)',row.identity,row.session_key,row.value);}
      if(retainedBudget){storage.sql.exec('CREATE TABLE issue212_retained_budget(singleton INTEGER PRIMARY KEY,summary_json TEXT NOT NULL) STRICT');storage.sql.exec('INSERT INTO issue212_retained_budget VALUES(1,?)',JSON.stringify(retainedBudget));}
      if(inspection.managedCosts.length){storage.sql.exec('CREATE TABLE issue212_retained_execution_summaries(ordinal INTEGER PRIMARY KEY,summary_json TEXT NOT NULL) STRICT');inspection.managedCosts.forEach((row,i)=>storage.sql.exec('INSERT INTO issue212_retained_execution_summaries VALUES(?,?)',i,JSON.stringify(row)));}
      await storage.sync();
      const remainingKv=(await storage.list({limit:1})).size,alarm=await storage.getAlarm();
      if(remainingKv||alarm!==null)throw Error('direct-clear-readback-failed');
      return {className,actorName:input.actorName,cleared:true,kvCount:0,alarm:null,containerRunning:this.ctx.container?.running===true,retainedIsolationRows:isolations.reduce((n,t)=>n+t.rows.length,0),retainedManagedSummaries:inspection.managedCosts.length,retainedRemoteBindings:retainedBindings.length,remoteDeletionPending:inspection.remoteSessions.filter(id=>!remoteReceipts.some(r=>r.session_id===id&&r.absent_at>0)).length};
    }});
  }
}

export function directClearAppend(configuration){
  return '\n;('+installDirectProjectClear.toString()+')({'+Object.keys(configuration.actors).join(',')+'},'+JSON.stringify(configuration)+');\n';
}

export function patchDirectClearModule(original,configuration){
  const offset=original.lastIndexOf('\nexport {');if(offset<0)throw Error('direct-clear-export-block-missing');
  let tail=original.slice(offset),wrappers='';
  for(const name of Object.keys(configuration.actors)){
    if(!/^[A-Za-z][A-Za-z0-9]*$/.test(name)||tail.split('  '+name+',').length!==2)throw Error('direct-clear-export-conflict');
    tail=tail.replace('  '+name+',','  Issue212'+name+' as '+name+',');
    wrappers+='\nclass Issue212'+name+' extends '+name+' { async issue212DirectClear(input){return super.issue212DirectClear(input);} }\n';
  }
  return original.slice(0,offset)+tail+directClearAppend(configuration)+wrappers;
}

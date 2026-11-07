export function stableProjection(settings,version,module,secretNames){
 const gate='PROJECT_VIEW_BROWSER_POLICY_JSON';
 const copy=x=>JSON.parse(JSON.stringify(x));
 const s=copy(settings),v=copy(version);
 const strip=a=>{if(!Array.isArray(a))throw Error('bindings-shape');return a.filter(b=>b.name!==gate);};
 s.bindings=strip(s.bindings);v.resources.bindings=strip(v.resources.bindings);
 // Exact API envelope paths only. No recursive id/time removal.
 delete v.id;delete v.number;
 if(v.metadata){delete v.metadata.created_on;}
 return {settings:s,version:v,module,secretNames:secretNames.filter(x=>x.name!==gate)};
}
export function controlProjection(controls,apps,appVersions,exactTarget){
 return {namespaces:controls.namespaces.result,registries:controls.registries.result,domains:controls.domains.result,routes:controls.routes.result,schedules:controls.schedules.result,subdomain:controls.subdomain.result,apps,appVersions,exactTarget};
}

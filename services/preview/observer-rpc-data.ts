/** Workerd decorates returned aggregate RPC values with an own Symbol.dispose.
 * Detach only plain data fields before strict protocol validation, then release
 * the aggregate's RPC lifetime. Do not apply to live capabilities or Responses.
 * Any other symbol/accessor remains forbidden; nested data is validated by the
 * receiving protocol, which never accepts embedded RPC capabilities. */
export function observerRpcData<T extends object>(raw:T):T{
 if(!raw||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('observer-rpc-data-invalid');
 const descriptors=Object.getOwnPropertyDescriptors(raw),copy:Record<string,unknown>={};
 const disposal=Object.getOwnPropertyDescriptor(raw,Symbol.dispose);
 try{
  if(disposal&&(!Object.hasOwn(disposal,'value')||typeof disposal.value!=='function'))throw Error('observer-rpc-data-invalid');
  for(const key of Reflect.ownKeys(descriptors)){
   if(key===Symbol.dispose)continue;
   const d=Reflect.get(descriptors,key) as PropertyDescriptor;
   if(typeof key!=='string'||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('observer-rpc-data-invalid');
   Object.defineProperty(copy,key,{value:d.value,enumerable:true,writable:true,configurable:true});
  }
  return copy as T;
 }finally{if(disposal&&Object.hasOwn(disposal,'value')&&typeof disposal.value==='function')Reflect.apply(disposal.value,raw,[]);}
}

/** Attach disposal before racing a deadline so a late aggregate is still
 * released even when its caller has already stopped awaiting the result. */
export function observerRpcPendingData<T extends object>(pending:Promise<T>):Promise<T>{
 return pending.then(value=>observerRpcData(value));
}

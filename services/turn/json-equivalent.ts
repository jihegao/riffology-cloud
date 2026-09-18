/** Compare validated JSON values. Object member order is not event identity;
 * array order and every scalar value remain significant. No persisted hashes
 * are rewritten, so old journal receipts remain readable during rollback. */
export function jsonEquivalent(left:unknown,right:unknown):boolean {
  if(left===right)return true;
  if(left===null||right===null||typeof left!=='object'||typeof right!=='object')return false;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>jsonEquivalent(value,right[index]));
  const a=left as Record<string,unknown>,b=right as Record<string,unknown>,keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&jsonEquivalent(a[key],b[key]));
}

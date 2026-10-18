// Diagnostic-only preload: preserve SHA-256 inputs/results; delay completion
// of the first runtime validation digest (input fixture digest is call 1).
const original=crypto.subtle.digest.bind(crypto.subtle);let calls=0;
crypto.subtle.digest=async function(...args){
 const call=++calls,started=performance.now();
 console.error('DIAG digest begin',call);
 const result=await original(...args);
 if(call===2)await new Promise(resolve=>setTimeout(resolve,50));
 console.error('DIAG digest end',call,'elapsedMs',performance.now()-started);
 return result;
};

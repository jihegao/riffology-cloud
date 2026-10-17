const digest=crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest=async function(algorithm,bytes){
 const result=await digest(algorithm,bytes);
 const text=new TextDecoder().decode(bytes);
 if(text.includes('"closeBeganAt"')&&text.includes('"observedAt"')){
  console.error('DIAG cleanup-proof digest: delay completion 50ms');
  await new Promise(resolve=>setTimeout(resolve,50));
  console.error('DIAG cleanup-proof digest: completed');
 }
 return result;
};

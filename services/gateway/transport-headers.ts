/** These two fields are inputs to the existing G5 authority verification,
 * never a caller identity or a trusted forwarding assertion. */
export const g5ReadHeaders=['x-riffology-g5-read-session','x-riffology-g5-read-capability'] as const;
export function publicTransportHeaders(input:Headers):Headers {
  const headers=new Headers(input);
  for(const name of [...headers.keys()])if(/^(?:forwarded$|x-forwarded-|cf-|x-riffology-|x-riffoid-)/i.test(name)&&!g5ReadHeaders.some(allowed=>allowed===name))headers.delete(name);
  return headers;
}

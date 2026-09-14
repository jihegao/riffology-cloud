/** Validate before Docker, filesystem evidence creation or Worker startup. */
export function parseReuseAcceptanceArgs(args){
 if(!Array.isArray(args)||args.length!==1||args[0]!=='--run-ten-turns')throw Error('expected-only --run-ten-turns; native images and guards cannot be overridden');
 return Object.freeze({turns:10,sessionSwitchBeforeTurn:6,provider:'deterministic-fixture',native:'real-sdk',projectImage:'cloud',paidCalls:false});
}

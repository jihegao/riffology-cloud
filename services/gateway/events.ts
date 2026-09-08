import type { TurnEvent, TurnScope } from '../turn/protocol.ts';

export type EventPage={events:TurnEvent[];nextSequence:number;hasMore:boolean;oldestSequence:number;snapshotRequired:boolean};
type StreamOptions={scope:TurnScope;afterSequence:number;signal?:AbortSignal;pollMs?:number;maxMs?:number;
  authorize():Promise<void>;replay(afterSequence:number,limit:number):Promise<unknown>};
const encoder=new TextEncoder();
function page(value:unknown,scope:TurnScope,cursor:number):EventPage{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-event-page');const v=value as Partial<EventPage>;
  if(!Array.isArray(v.events)||!Number.isSafeInteger(v.nextSequence)||!Number.isSafeInteger(v.oldestSequence)||typeof v.hasMore!=='boolean'||typeof v.snapshotRequired!=='boolean')throw Error('invalid-event-page');
  let prior=cursor;for(const event of v.events){if(!event||typeof event!=='object'||!Number.isSafeInteger(event.sequence)||event.sequence<=prior||event.workspaceId!==scope.workspaceId||event.runtimeGeneration!==scope.workspaceGeneration||typeof event.type!=='string'||/[\r\n]/u.test(event.type))throw Error('invalid-event-page');prior=event.sequence;}
  if((v.events.length?prior:cursor)!==v.nextSequence)throw Error('invalid-event-page');return v as EventPage;
}
function frame(event:string,data:unknown,id?:number){return encoder.encode(`${id===undefined?'':`id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}
function wait(ms:number,signal:AbortSignal):Promise<boolean>{return new Promise(resolve=>{if(signal.aborted){resolve(false);return;}const timer=setTimeout(done,ms);function done(){clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(true);}function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(false);}signal.addEventListener('abort',abort,{once:true});});}

/** Observation only. Cancelling this stream never owns or cancels a Turn. Each
 * poll rechecks the durable catalog authority before reading persisted events. */
export function turnEventStream(options:StreamOptions):Response{
  const pollMs=options.pollMs??1000,maxMs=options.maxMs??300_000;
  if(!Number.isSafeInteger(options.afterSequence)||options.afterSequence<0||!Number.isSafeInteger(pollMs)||pollMs<1||pollMs>10_000||!Number.isSafeInteger(maxMs)||maxMs<1||maxMs>300_000)throw Error('invalid-event-stream-options');
  const aborter=new AbortController(),outer=options.signal;let closed=false;const abort=()=>aborter.abort();outer?.addEventListener('abort',abort,{once:true});
  const body=new ReadableStream<Uint8Array>({
    start(controller){void(async()=>{let cursor=options.afterSequence;const deadline=Date.now()+maxMs;
      try{stream:while(!aborter.signal.aborted&&Date.now()<deadline){
        try{await options.authorize();}catch{if(!aborter.signal.aborted)controller.enqueue(frame('stream.closed',{reason:'authorization_changed'}));break;}
        let current:EventPage;try{current=page(await options.replay(cursor,200),options.scope,cursor);}catch{if(!aborter.signal.aborted)controller.enqueue(frame('stream.closed',{reason:'temporarily_unavailable'}));break;}
        if(current.snapshotRequired){
          // Never advance across an event-retention gap without a full state
          // snapshot. The client must GET the workspace snapshot, then reconnect.
          controller.enqueue(frame('snapshot.required',{oldestSequence:current.oldestSequence,nextSequence:current.nextSequence}));
          break stream;
        }
        for(const event of current.events){controller.enqueue(frame(event.type,event,event.sequence));cursor=event.sequence;}
        if(current.hasMore)continue;if(current.events.length===0)controller.enqueue(encoder.encode(': keepalive\n\n'));
        if(!await wait(pollMs,aborter.signal))break;
      }
      if(!aborter.signal.aborted&&Date.now()>=deadline)controller.enqueue(frame('stream.closed',{reason:'observation_window_elapsed'}));
      }finally{closed=true;outer?.removeEventListener('abort',abort);try{controller.close();}catch{/* reader already cancelled */}}
    })();},
    cancel(){if(!closed)aborter.abort();},
  });
  return new Response(body,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store, no-transform','x-content-type-options':'nosniff','x-accel-buffering':'no'}});
}

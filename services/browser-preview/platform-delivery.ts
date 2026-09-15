import {browserPreviewDelivery} from './execution/delivery.ts';
/** Platform fixed origin and immutable assets; never a package-provided URL. */
export function platformPreviewDelivery(appOrigin:string|undefined,executionOrigin:string|undefined,assetSha256:string){
 if(!appOrigin||!executionOrigin)throw Error('browser-preview-delivery-unavailable');
 const app=new URL(appOrigin),execution=new URL(executionOrigin);
 const local=[app.hostname,execution.hostname].every(host=>host==='localhost'||host==='127.0.0.1');
 if(app.origin!==appOrigin||execution.origin!==executionOrigin||app.origin===execution.origin||execution.username||execution.password||!local&&(execution.protocol!=='https:'||app.protocol!=='https:'))throw Error('browser-preview-delivery-unavailable');
 if(!local&&app.hostname.split('.').slice(-2).join('.')===execution.hostname.split('.').slice(-2).join('.'))throw Error('browser-preview-delivery-unavailable');
 return browserPreviewDelivery(executionOrigin,assetSha256);
}

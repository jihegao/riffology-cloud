/** Offline grammar regression. Never import/execute Wrangler, main or any handler.
 * Only fixed public bundled parser declarations/options enter a capability-free VM. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from '/Users/jihegao/apps/riffology-cloud/node_modules/acorn/dist/acorn.mjs';
const cli='/Users/jihegao/apps/riffology-cloud/node_modules/wrangler/wrangler-dist/cli.js';
const expected='0a7bc2107ca92b2cc6db58b6a36d38d44b549eebd7db7ec34c36db9da7a91264';
const sha=b=>createHash('sha256').update(b).digest('hex'),raw=readFileSync(cli),source=raw.toString('utf8');
assert.equal(raw.length,14390953);assert.equal(sha(raw),expected);
const extracted=[];
function expression(marker,type,fromMarker=false){
 const start=source.indexOf(marker);assert.ok(start>=0&&source.indexOf(marker,start+marker.length)<0,'unique pinned marker');
 const offset=fromMarker?start:start+marker.length,node=parseExpressionAt(source,offset,{ecmaVersion:'latest'});assert.equal(node.type,type);
 const code=source.slice(node.start,node.end);extracted.push({marker,line:source.slice(0,node.start).split('\n').length,bytes:Buffer.byteLength(code),sha256:sha(code)});return code;
}
const names=['camelCase','decamelize','looksLikeNumber','tokenizeArgString','combineAliases','increment','sanitizeKey','stripQuotes'];
const helpers=names.map(name=>expression('function '+name+'(','FunctionExpression',true));
const parser=expression('YargsParser = ','ClassExpression');
const globals=expression('const globalFlags = ','ObjectExpression');
const oauth=expression('oauthArgs = ','ObjectExpression');
// No module wrapper, initializer, command registry, logger, dotenv or handler is evaluated.
const fixed=JSON.stringify({scopes:['user:read','account:read','workers:write','workers_scripts:write','containers:write'],tail:['--browser','--callback-host','localhost','--callback-port','8976']});
const code=`'use strict';
const __name=value=>value;
${helpers.join('\n')}
let mixin;
const DefaultValuesForTypeKey={BOOLEAN:'boolean',STRING:'string',NUMBER:'number',ARRAY:'array'};
const Parser=${parser};
const globalFlags=${globals},oauthFlags=${oauth},fixed=${fixed};
let forbiddenCapabilityCalls=0;
const forbidden=()=>{forbiddenCapabilityCalls++;throw Error('parser-only-capability-forbidden');};
function options(definitions){
 const result={array:[],boolean:[],string:[],number:[],alias:{},default:{},narg:{}};
 for(const [key,value]of Object.entries(definitions)){
  if(value.array)result.array.push(key);
  if(['boolean','string','number'].includes(value.type))result[value.type].push(key);
  if(value.requiresArg)result.narg[key]=NaN;
  if(value.alias!==undefined)result.alias[key]=value.alias;
  if(value.default!==undefined)result.default[key]=value.default;
 }
 return result;
}
function parse(args,defs){
 const parser=new Parser({cwd:()=>'/parser-only',env:()=>({}),format:text=>text,normalize:forbidden,resolve:forbidden,require:forbidden});
 const result=parser.parse(args,options(defs));
 if(result.error)throw result.error;
 return {commands:result.argv._,envFiles:result.argv['env-file'],scopes:result.argv.scopes,browser:result.argv.browser,callbackHost:result.argv['callback-host'],callbackPort:result.argv['callback-port'],json:result.argv.json,profile:result.argv.profile};
}
const login=['login','--scopes',...fixed.scopes,...fixed.tail],auth=['auth','token','--json','--profile','default'];
const cases={
 oldLoginRoot:parse(['--env-file','/dev/null',...login],globalFlags),
 newLoginRoot:parse([...login,'--env-file','/dev/null'],globalFlags),
 newLoginCommand:parse([...login,'--env-file','/dev/null'],{...globalFlags,...oauthFlags}),
 oldAuthRoot:parse(['--env-file','/dev/null',...auth],globalFlags),
 newAuthRoot:parse([...auth,'--env-file','/dev/null'],globalFlags),
 equalsStillGreedy:parse(['--env-file=/dev/null',...login],globalFlags)
};
if(cases.oldLoginRoot.commands.includes('login')||cases.oldLoginRoot.envFiles.join('|')!=='/dev/null|login')throw Error('old-login-control');
if(cases.oldAuthRoot.commands.includes('auth')||cases.oldAuthRoot.envFiles.join('|')!=='/dev/null|auth|token')throw Error('old-auth-control');
if(cases.newLoginRoot.commands[0]!=='login'||cases.newLoginCommand.commands.join('|')!=='login'||cases.newAuthRoot.commands.join('|')!=='auth|token')throw Error('new-command-order');
for(const key of ['newLoginRoot','newLoginCommand','newAuthRoot'])if(cases[key].envFiles.join('|')!=='/dev/null')throw Error('empty-env-file-not-exclusive');
if(cases.newLoginCommand.scopes.join('|')!==fixed.scopes.join('|')||cases.newLoginCommand.browser!==true||cases.newLoginCommand.callbackHost!=='localhost'||cases.newLoginCommand.callbackPort!==8976)throw Error('login-options-drift');
if(cases.newAuthRoot.json!==true||cases.newAuthRoot.profile!=='default')throw Error('auth-options-drift');
if(cases.equalsStillGreedy.envFiles.join('|')!=='/dev/null|login'||forbiddenCapabilityCalls!==0)throw Error('control-or-capability-failure');
globalThis.report={cases,forbiddenCapabilityCalls};`;
assert.ok(!/async function main|await login\(|init_src\(|createCLIParser\(/.test(code));
const context=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}});
new vm.Script(code,{filename:'pinned-yargs-parser-only.js'}).runInContext(context,{timeout:1000});
console.log(JSON.stringify({schema:'pinned-wrangler-argv-parser-only/v1',cli:{file:cli,bytes:raw.length,sha256:expected},parserVersion:'yargs-parser@21.1.1',extracted,extractedProgramSha256:sha(code),safety:{fullCliImported:false,fullCliExecuted:false,oauthHandlersIncluded:false,vmHasProcess:false,vmHasRequire:false,vmHasFetch:false,vmDynamicCodeGeneration:false,configEnvironmentAndCredentialFilesRead:0,networkCalls:0,forbiddenCapabilityCalls:context.report.forbiddenCapabilityCalls},...context.report},null,2));

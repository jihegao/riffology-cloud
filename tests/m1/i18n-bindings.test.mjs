import test from 'node:test';
import assert from 'node:assert/strict';
import {setLocale, t, formatNumber, msg, uiError, errorMessage} from '../../services/web/i18n.js';
import {bindText, bindAttribute, unbindI18n, bindValue} from '../../services/web/i18n-bindings.js';
const node = () => ({textContent:'',value:'user draft',attributes:{},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];}});

test('only explicit labels change; values, identities and unrelated user text remain intact', () => {
  setLocale('zh-CN',{persist:false});
  const label=node(),user=node();user.textContent='退出';
  bindText(label,'shell.signOut');bindAttribute(label,'aria-label','shell.signOut');
  assert.equal(label.textContent,'退出');
  setLocale('en',{persist:false});
  assert.equal(label.textContent,'Sign out');assert.equal(label.attributes['aria-label'],'Sign out');
  assert.equal(label.value,'user draft');assert.equal(user.textContent,'退出');
  assert.throws(()=>bindAttribute(label,'value','shell.signOut'),/presentation attributes/);
  unbindI18n(label);
});

test('rebinding a dynamic label preserves the node and takes precedence over static shell text', () => {
  const label=node();label.attributes['data-i18n']='shell.signOut';
  setLocale('en',{persist:false});bindText(label,'shell.signOut');
  assert.equal(label.attributes['data-i18n'],undefined);
  bindText(label,()=>t('shell.language')+' '+formatNumber(1234.5));
  setLocale('zh-CN',{persist:false});assert.equal(label.textContent,'语言 1,234.5');
  unbindI18n(label);setLocale('en',{persist:false});assert.equal(label.textContent,'语言 1,234.5');
});

test('interpolation stays text and a failing display getter cannot interrupt other bindings', () => {
  const unsafe=node(),broken=node(),healthy=node();
  bindText(unsafe,()=>'<img src=x onerror=alert(1)>');assert.equal(unsafe.textContent,'<img src=x onerror=alert(1)>');
  broken.textContent='existing';bindText(broken,()=>{throw Error('invalid display value');});
  bindText(healthy,'shell.signOut');setLocale('zh-CN',{persist:false});
  assert.equal(broken.textContent,'existing');assert.equal(healthy.textContent,'退出');
  for(const n of [unsafe,broken,healthy])unbindI18n(n);
});


test('stored notices and errors retain their keys and formatted values until presentation', () => {
  setLocale('zh-CN',{persist:false});
  const label=node(),error=node(),notice=msg('files.revision',()=>({p0:'revision-a',p1:formatNumber(1234),p2:'unchanged-time'}));
  bindValue(label,notice);bindValue(error,errorMessage(uiError('error.requestFailed')));
  const before=label.textContent;setLocale('en',{persist:false});
  assert.notEqual(label.textContent,before);assert.match(label.textContent,/Revision revision-a/);
  assert.match(label.textContent,/1,234/);assert.equal(error.textContent,'The request failed. Try again later.');
  assert.equal(label.value,'user draft');unbindI18n(label);unbindI18n(error);
});

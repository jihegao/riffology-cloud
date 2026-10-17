import {msg} from './i18n.js';
import {bindValue} from './i18n-bindings.js';

/** Navigation only: never fetches, executes, recreates a player or changes inputs. */
export function createViewTabs(root,section){
 const doc=root.ownerDocument,nav=doc.createElement('div'),body=doc.createElement('div');
 nav.className='workspace-subtabs';nav.setAttribute('role','tablist');
 body.className='workspace-subview';body.setAttribute('role','tabpanel');body.tabIndex=0;
 let views=[],selected='',key='',identity='',signature='';
 function choose(id,remember=false){
  const view=views.find(v=>v.id===id)??views[0];if(!view)return;
  selected=view.id;
  for(const button of nav.children){const active=button.dataset.viewId===selected;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
  body.setAttribute('aria-labelledby',`${root.id||section}-${section}-${selected}-tab`);
  for(const node of body.children)node.hidden=!view.nodes.includes(node);
  root.dataset.selectedView=selected;
  for(const candidate of views)candidate.onActive?.(candidate.id===selected);
  if(remember)try{doc.defaultView.sessionStorage.setItem(key,JSON.stringify({identity,id:selected}));}catch{}
 }
 nav.addEventListener('keydown',event=>{
  const buttons=[...nav.children],at=buttons.indexOf(event.target);if(at<0)return;
  const next=event.key==='ArrowRight'?(at+1)%buttons.length:event.key==='ArrowLeft'?(at+buttons.length-1)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:null;
  if(next===null)return;event.preventDefault();buttons[next].focus();choose(buttons[next].dataset.viewId,true);
 });
 return {update(next,context,version){
  const nextKey=`riffology:views:${context?.tenantId??''}:${context?.workspaceId??''}:${section}`;
  const changed=nextKey!==key||version!==identity;key=nextKey;identity=version??'';views=next;
  if(changed){selected='';try{const raw=doc.defaultView.sessionStorage.getItem(key);if(raw?.length<512){const saved=JSON.parse(raw);if(saved?.identity===identity)selected=saved.id;}}catch{}}
  const nodes=[...new Set(views.flatMap(v=>v.nodes))];
  // Keep canvas/forms attached and preserve focus when only a status is refreshed.
  if(root.firstChild!==nav)root.replaceChildren(nav,body);
  for(const child of [...body.children])if(!nodes.includes(child))child.remove();
  for(const node of nodes)if(node.parentNode!==body)body.append(node);
  const shape=JSON.stringify(views.map(v=>[v.id,String(v.title)]));
  if(shape!==signature){signature=shape;nav.replaceChildren();for(const view of views){const button=doc.createElement('button');button.type='button';button.id=`${root.id||section}-${section}-${view.id}-tab`;button.dataset.viewId=view.id;button.setAttribute('role','tab');button.setAttribute('aria-controls',`${root.id||section}-${section}-content`);bindValue(button,view.title);button.onclick=()=>choose(view.id,true);nav.append(button);}}
  body.id=`${root.id||section}-${section}-content`;nav.hidden=views.length<2;choose(selected);
 }};
}

export function artifactView(doc,view,artifacts){
 const section=doc.createElement('section'),note=doc.createElement('p');note.className='meta';
 const version=doc.createElement('p');version.className='model-version';bindValue(version,msg('model.savedVersion',{p0:artifacts.revisionId??msg('model.initial')}));section.append(version);
 bindValue(note,msg(view.renderer==='document'?'views.documentBoundary':'views.designBoundary'));section.append(note);
 const source=artifacts.contents[view.source];
 if(view.renderer!=='graph'){const pre=doc.createElement('pre');pre.className='design-source';pre.textContent=source;section.append(pre);return section;}
 const graph=JSON.parse(source),ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
 const width=960,height=Math.ceil(graph.nodes.length/3)*150+40;
 svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',view.title);svg.classList.add('design-graph');
 const position=new Map(graph.nodes.map((n,i)=>[n.id,{x:30+i%3*310,y:20+Math.floor(i/3)*150}]));
 function shape(tag,attrs,text){const n=doc.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;svg.append(n);return n;}
 for(const edge of graph.edges){
  const a=position.get(edge.from),b=position.get(edge.to),horizontal=a.y===b.y,forward=horizontal?b.x>a.x:b.y>a.y;
  const x=horizontal?a.x+(forward?270:0):a.x+135,y=horizontal?a.y+45:a.y+(forward?90:0),ex=horizontal?b.x+(forward?0:270):b.x+135,ey=horizontal?b.y+45:b.y+(forward?0:90),back=forward?-8:8;
  shape('path',{d:`M ${x} ${y} L ${ex} ${ey}`,fill:'none',stroke:'#64748b','stroke-width':2});
  shape('path',{d:horizontal?`M ${ex+back} ${ey-5} L ${ex} ${ey} L ${ex+back} ${ey+5}`:`M ${ex-5} ${ey+back} L ${ex} ${ey} L ${ex+5} ${ey+back}`,fill:'none',stroke:'#64748b','stroke-width':2});
 }
 for(const node of graph.nodes){const {x,y}=position.get(node.id);shape('rect',{x,y,width:270,height:90,rx:8,fill:'#f1f5f9',stroke:'#64748b'});const label=shape('text',{x:x+12,y:y+24,fill:'#0f172a','font-size':14});for(const [i,line]of (node.label.match(/.{1,26}/gu)??[]).slice(0,3).entries()){const span=doc.createElementNS(ns,'tspan');span.setAttribute('x',String(x+12));span.setAttribute('dy',i?'20':'0');span.textContent=line;label.append(span);}}
 section.append(svg);
 const list=doc.createElement('ul');for(const edge of graph.edges){const li=doc.createElement('li');li.textContent=`${graph.nodes.find(n=>n.id===edge.from).label} → ${graph.nodes.find(n=>n.id===edge.to).label}${edge.label?' · '+edge.label:''}`;list.append(li);}section.append(list);
 return section;
}

/** Presentation preferences only. Panels retain their original execution state. */
export function createWorkspaceLayout({root,storage}){
 if(storage===undefined)try{storage=window.localStorage;}catch{storage=null;}
 const grid=root.querySelector('.workspace-grid'),separator=root.querySelector('[data-workspace-divider]');
 let context=null,ratio=35,depth='explore',view='preview',mobile='chat';
 const key=()=>`riffology:workspace-layout:${context.tenantId}:${context.workspaceId}`;
 const save=()=>{if(context)try{storage?.setItem(key(),JSON.stringify({ratio,depth,view,mobile}));}catch{}};
 function limits(){const width=grid.getBoundingClientRect().width;return {min:Math.max(25,Math.min(45,240/Math.max(1,width)*100)),max:Math.min(60,Math.max(45,(width-340)/Math.max(1,width)*100))};}
 function render(){
  const {min,max}=limits(),shown=Math.min(max,Math.max(min,ratio));grid.style.setProperty('--agent-width',`${shown}%`);separator.setAttribute('aria-valuenow',String(Math.round(shown)));separator.setAttribute('aria-valuemin',String(Math.ceil(min)));separator.setAttribute('aria-valuemax',String(Math.floor(max)));separator.setAttribute('aria-valuetext',`对话 ${Math.round(shown)}%，模型 ${100-Math.round(shown)}%`);
  root.dataset.depth=view==='inspect'?'inspect':view==='runs'?'experiment':'explore';root.dataset.mobilePane=mobile;
  for(const node of root.querySelectorAll('[data-workspace-view]'))node.hidden=node.dataset.workspaceView!==view;
  for(const tab of root.querySelectorAll('[data-workspace-tab]')){const selected=tab.dataset.workspaceTab===view;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
  for(const node of root.querySelectorAll('[data-workspace-depth]'))node.setAttribute('aria-pressed',String(node.dataset.workspaceDepth===depth));
  for(const node of root.querySelectorAll('[data-mobile-pane]'))node.setAttribute('aria-pressed',String(node.dataset.mobilePane===mobile));
 }
 function select(next){if(!['preview','model','runs','inspect'].includes(next))return;view=next;if(next==='runs'&&depth==='explore')depth='experiment';if(next==='inspect')depth='inspect';mobile='preview';render();save();}
 root.addEventListener('click',event=>{const target=event.target.closest('button');if(!target)return;if(target.dataset.workspaceTab)select(target.dataset.workspaceTab);if(target.dataset.workspaceDepth){depth=target.dataset.workspaceDepth;view=depth==='inspect'?'inspect':depth==='experiment'?'runs':'preview';mobile='preview';render();save();}if(target.dataset.mobilePane){mobile=target.dataset.mobilePane;render();save();}});
 root.addEventListener('keydown',event=>{const tab=event.target.closest('[data-workspace-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=[...root.querySelectorAll('[data-workspace-tab]')],i=tabs.indexOf(tab);event.preventDefault();const target=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];select(target.dataset.workspaceTab);target.focus();});
 separator.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const {min,max}=limits();ratio=event.key==='Home'?min:event.key==='End'?max:Math.min(max,Math.max(min,ratio+(event.key==='ArrowRight'?2:-2)));render();save();});
 let dragging=false;
 separator.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragging=true;separator.setPointerCapture(event.pointerId);root.classList.add('workspace-resizing');event.preventDefault();});
 separator.addEventListener('pointermove',event=>{if(!dragging)return;const rect=grid.getBoundingClientRect(),{min,max}=limits();ratio=Math.max(min,Math.min(max,(event.clientX-rect.left)/rect.width*100));render();});
 const finish=()=>{if(!dragging)return;dragging=false;root.classList.remove('workspace-resizing');save();};separator.addEventListener('pointerup',finish);separator.addEventListener('pointercancel',finish);separator.addEventListener('lostpointercapture',finish);
 window.addEventListener('resize',render);
 function enter(value){context=value;ratio=window.innerWidth>=1200?35:32;depth='explore';view='preview';mobile='chat';try{const saved=JSON.parse(storage?.getItem(key())||'null');if(saved){if(Number.isFinite(saved.ratio))ratio=Math.max(25,Math.min(60,saved.ratio));if(['explore','experiment','inspect'].includes(saved.depth))depth=saved.depth;if(['preview','model','runs','inspect'].includes(saved.view))view=saved.view;else view=depth==='inspect'?'inspect':depth==='experiment'?'runs':'preview';if(['chat','preview'].includes(saved.mobile))mobile=saved.mobile;}}catch{}render();}
 return {enter,select,refresh:render};
}

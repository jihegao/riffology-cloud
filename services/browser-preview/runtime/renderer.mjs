import {validateTrace, LIMITS} from './protocol.mjs';
export class PreviewPlayer {
  constructor(container, metricContainer) {this.container = container; this.metricContainer = metricContainer; this.index = 0;}
  load(trace, visualization) {this.pause(); validateTrace(trace); if (new TextEncoder().encode(JSON.stringify(trace)).length > LIMITS.cacheBytes) throw Error('runtime-cache-limit'); this.trace = trace; this.visualization = visualization; this.index = 0; this.render();}
  clear() {this.pause(); this.trace = null; this.container.replaceChildren(); this.metricContainer.replaceChildren();}
  pause() {clearInterval(this.timer); this.timer = null;}
  play(speed = 5) {this.pause(); if (!Number.isFinite(speed) || speed < 1 || speed > 60) throw Error('runtime-playback-speed-invalid'); this.timer = setInterval(() => this.step(), 1000 / speed);}
  step() {if (!this.trace) return; if (this.index + 1 >= this.trace.snapshots.length) {this.pause(); return;} this.index++; this.render();}
  restart() {this.pause(); this.index = 0; this.render();}
  render() {
    if (!this.trace) return;
    const snapshot = this.trace.snapshots[this.index];
    this.container.replaceChildren(); this.metricContainer.replaceChildren();
    this.container.dataset.frame = String(snapshot.frame);
    if (snapshot.space.type === 'grid') {
      this.container.style.display = 'block';
      const canvas=document.createElement('canvas');canvas.className='preview-grid';canvas.width=600;canvas.height=420;canvas.style.maxWidth='100%';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`Frame ${snapshot.frame}: ${snapshot.agents.length} agents on ${snapshot.space.width} by ${snapshot.space.height} grid`);
      const ctx=canvas.getContext('2d');ctx.fillStyle='#f1f5f9';ctx.fillRect(0,0,600,420);
      const cellWidth=600/snapshot.space.width,cellHeight=420/snapshot.space.height;
      for(const agent of snapshot.agents){ctx.fillStyle=agent.state==='group-b'?'#f97316':'#2563eb';ctx.fillRect(agent.x*cellWidth,agent.y*cellHeight,Math.max(0.5,cellWidth),Math.max(0.5,cellHeight));}
      // O(agents), fixed pixel allocation; a million-cell model creates one DOM node.
      this.container.append(canvas);
    } else {
      this.container.style.display = 'block';
      const lanes=new Map(snapshot.space.lanes.map(lane=>[lane,[]]));for(const agent of snapshot.agents)lanes.get(agent.lane).push(agent);
      for (const [lane, agents] of lanes) {const row = document.createElement('div'); row.className = 'preview-lane'; row.textContent = lane + ': '; for (const agent of agents.sort((a,b) => a.position-b.position)) {const span = document.createElement('span'); span.textContent = ` ● ${agent.id}`; span.title = agent.state; row.append(span);} this.container.append(row);}
    }
    for (const key of this.visualization.metricKeys) {const row = document.createElement('div'); row.textContent = `${key}: ${snapshot.metrics[key] ?? '—'}`; this.metricContainer.append(row);}
  }
}

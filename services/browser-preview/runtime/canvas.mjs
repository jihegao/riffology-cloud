// Fixed, bounded drawing surface. Model Python owns the visual composition.
// This API is not a sandbox: Pyodide can reach JS through function constructors
// or import js. The opaque frame, CSP, locked subworker and host deadlines are
// the execution boundary.
export const CANVAS_WIDTH = 600;
export const CANVAS_HEIGHT = 420;
const MAX_COMMANDS = 20000;
const coordinate = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000;
const color = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
export function createCanvasBridge(surface) {
  if (!(surface instanceof OffscreenCanvas) || surface.width !== CANVAS_WIDTH || surface.height !== CANVAS_HEIGHT) throw Error('runtime-canvas-invalid');
  const context = surface.getContext('2d');
  if (!context) throw Error('runtime-canvas-unavailable');
  let commands = 0;
  const count = () => {if (++commands > MAX_COMMANDS) throw Error('runtime-canvas-command-limit');};
  const numbers = (...values) => {if (values.some(value => !coordinate(value))) throw Error('runtime-canvas-coordinate-invalid');};
  const paint = value => {if (!color(value)) throw Error('runtime-canvas-color-invalid');return value;};
  const api = Object.freeze({
    clear(value='#ffffff') {count();context.fillStyle=paint(value);context.fillRect(0,0,CANVAS_WIDTH,CANVAS_HEIGHT);},
    rect(x,y,width,height,value) {count();numbers(x,y,width,height);if(width<0||height<0)throw Error('runtime-canvas-size-invalid');context.fillStyle=paint(value);context.fillRect(x,y,width,height);},
    circle(x,y,radius,value) {count();numbers(x,y,radius);if(radius<0)throw Error('runtime-canvas-size-invalid');context.fillStyle=paint(value);context.beginPath();context.arc(x,y,radius,0,Math.PI*2);context.fill();},
    line(x1,y1,x2,y2,width,value) {count();numbers(x1,y1,x2,y2,width);if(width<0||width>100)throw Error('runtime-canvas-size-invalid');context.strokeStyle=paint(value);context.lineWidth=width;context.beginPath();context.moveTo(x1,y1);context.lineTo(x2,y2);context.stroke();},
  });
  return {api,reset() {commands=0;}};
}

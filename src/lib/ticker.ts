/**
 * A steady timer for windows that must keep working while hidden (the stream compositor).
 * Timers on the page are slowed down to about once a second when the window is covered or
 * minimised; timers inside a Web Worker are not, so the worker sends the ticks.
 */
export function startTicker(intervalMs: number, onTick: () => void): () => void {
  let worker: Worker | null = null;
  try {
    const source = `let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data);};`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => onTick();
    worker.postMessage(intervalMs);
    return () => {
      worker?.postMessage(0);
      worker?.terminate();
    };
  } catch {
    // Workers unavailable (e.g. blocked by the content security policy): plain timer.
    worker?.terminate();
    const id = window.setInterval(onTick, intervalMs);
    return () => window.clearInterval(id);
  }
}

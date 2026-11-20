// AudioWorklet: captura PCM float en bloques de 4096 muestras. Empieza en un frame exacto del AudioContext.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.start = (o.processorOptions && o.processorOptions.start) || 0;
    this.b = new Float32Array(4096); this.n = 0;
    this.port.onmessage = () => {
      this.port.postMessage({ end: true, data: this.b.slice(0, this.n) });
      this.n = 0;
    };
  }
  process(inputs) {
    const c = inputs[0] && inputs[0][0];
    if (!c || currentFrame + c.length <= this.start) return true;
    for (let k = 0; k < c.length; k++) {
      this.b[this.n++] = c[k];
      if (this.n === 4096) { this.port.postMessage(this.b); this.b = new Float32Array(4096); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);

// Runs on the audio rendering thread so arpeggiator scheduling ticks aren't subject to
// main-thread jank (GC pauses, layout, DOM events). Posts a message roughly every
// `intervalSamples` frames; the main thread uses each tick to run a lookahead scheduler
// that books actual note events using precise AudioContext time.
class ClockProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.counter = 0;
    this.intervalSamples = Math.round(sampleRate * 0.025);
    this.port.onmessage = (event) => {
      if (event.data && typeof event.data.intervalMs === "number") {
        this.intervalSamples = Math.max(64, Math.round((sampleRate * event.data.intervalMs) / 1000));
      }
    };
  }

  process() {
    this.counter += 128; // one render quantum
    if (this.counter >= this.intervalSamples) {
      this.counter -= this.intervalSamples;
      this.port.postMessage({ type: "tick", time: currentTime });
    }
    return true;
  }
}

registerProcessor("clock-processor", ClockProcessor);

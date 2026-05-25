(function(){try{var a=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};a.SENTRY_RELEASE={id:"d9632b117dd25fbb996f4be34305b4eecfd3c395"};var e=new a.Error().stack;e&&(a._sentryDebugIds=a._sentryDebugIds||{},a._sentryDebugIds[e]="b384b479-1025-4fd4-b669-36d557f74ae4",a._sentryDebugIdIdentifier="sentry-dbid-b384b479-1025-4fd4-b669-36d557f74ae4")}catch{}})();const Z={base:"/delayed-auditory-feedback-online/",dateModified:new Date().toISOString().split("T")[0],currentYear:new Date().getFullYear().toString()},H="psola",j=.6,q=256,z=Math.ceil(q/j)+1;function J(a){return z/a*1e3}const Q={deep:{pitchFloor:80,label:"Deep",latencyMs:25},normal:{pitchFloor:120,label:"Normal",latencyMs:16.6},high:{pitchFloor:150,label:"High-pitched",latencyMs:13.3}},ee="normal";function te(a,e){return 2*Math.floor(e/a)/e*1e3}const ie=2;function G(a){return Math.pow(2,a/12)}const U=j,se=ie,ne=q,ae=128,oe=z,re=8192,ce=2048,le=8192,de=4096,ue=1024,he=256,fe=4,pe=.15,me=`
(function () {
  'use strict';

  // ── Shared constants ────────────────────────────────────────────────────────
  const R_MIN = ${U};
  const R_MAX = ${se};

  // Pre-computed Hann table shared by both processors.
  const HTAB   = ${ue};
  const HTABM1 = HTAB - 1;
  const HANN   = new Float32Array(HTAB);
  for (let i = 0; i < HTAB; i++) {
    HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (HTAB - 1));
  }

  // ── Fixed-Anchor Grain Resampling (OLA) ────────────────────────────────────
  //
  // Pitch shift WITHOUT timing/delay change.
  // Anchor is fixed at inW - LOOKBACK every hop.
  // Pitch is changed by resampling readSpan = G/r input samples into G output.
  // r > 1: readSpan < G → higher frequency; r < 1: readSpan > G → lower.
  // Latency: LOOKBACK/sampleRate ≈ 8.9 ms at 48 kHz.
  //
  // R_MIN = ${U} (safe for ±8 st slider; min reachable ratio ≈ 0.630).
  // See top-of-file NOTE for R_MIN rationale.

  const OLA_G    = ${ne};
  const OLA_H    = ${ae};
  const OLA_LB   = ${oe};
  const OLA_INSZ = ${re};
  const OLA_OUTS = ${ce};
  const OLA_INM  = OLA_INSZ - 1;
  const OLA_OUTM = OLA_OUTS - 1;

  class OLAPitchShifter extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [{ name: 'pitchRatio', defaultValue: 1.0,
                minValue: R_MIN, maxValue: R_MAX, automationRate: 'k-rate' }];
    }
    constructor() {
      super();
      this._inBuf  = new Float32Array(OLA_INSZ);
      this._outBuf = new Float32Array(OLA_OUTS);
      this._inW  = 0;
      this._outW = 0;
      this._outR = 0;
    }
    process(inputs, outputs, parameters) {
      const inp = inputs[0]?.[0];
      const out = outputs[0]?.[0];
      if (!inp || !out) return true;
      const N = inp.length;
      const r = Math.max(R_MIN, Math.min(R_MAX, parameters.pitchRatio[0]));
      for (let i = 0; i < N; i++) {
        this._inBuf[this._inW++ & OLA_INM] = inp[i];
      }
      if (this._inW < OLA_LB + OLA_G) { out.fill(0); return true; }
      const anchor   = this._inW - OLA_LB;
      const readSpan = OLA_G / r;
      // Amplitude normalisation: COLA sum ≈ r with hop=H and grain=G.
      // Scale by 1/r to maintain unity gain across all pitch ratios.
      const gain = 1 / r;
      for (let i = 0; i < OLA_G; i++) {
        const srcPos = anchor + (i / (OLA_G - 1)) * readSpan;
        const ip = srcPos | 0;
        const fr = srcPos - ip;
        const s  = this._inBuf[ip & OLA_INM] * (1.0 - fr)
                 + this._inBuf[(ip + 1) & OLA_INM] * fr;
        this._outBuf[(this._outW + i) & OLA_OUTM] += s * HANN[Math.round(i / (OLA_G - 1) * HTABM1)] * gain;
      }
      this._outW += OLA_H;
      if (this._outW - this._outR >= N) {
        for (let i = 0; i < N; i++) {
          const idx = this._outR++ & OLA_OUTM;
          out[i] = this._outBuf[idx];
          this._outBuf[idx] = 0.0;
        }
      } else {
        out.fill(0);
      }
      return true;
    }
  }

  // ── PSOLA (Pitch Synchronous Overlap-Add) ───────────────────────────────────
  //
  // YIN pitch detector → pitch-synchronous grains → coherent overlap-add.
  // Latency: 2 × T_MAX = 2 × floor(sampleRate / pitchFloor).
  // pitchFloor passed via processorOptions at AudioWorkletNode creation.
  // Voice type buttons (Deep/Normal/High-pitched) control pitchFloor.

  const PSO_INSZ = ${le};
  const PSO_OUTS = ${de};
  const PSO_INM  = PSO_INSZ - 1;
  const PSO_OUTM = PSO_OUTS - 1;
  const YIN_W    = ${he};
  const YIN_INT  = ${fe};
  const YIN_THR  = ${pe};

  class PSOLAPitchShifter extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [{ name: 'pitchRatio', defaultValue: 1.0,
                minValue: R_MIN, maxValue: R_MAX, automationRate: 'k-rate' }];
    }
    constructor(options) {
      super();
      const pitchFloor  = options?.processorOptions?.pitchFloor ?? 120;
      this._tMin    = Math.ceil(sampleRate / 500);
      this._tMax    = Math.floor(sampleRate / pitchFloor);
      this._latency = 2 * this._tMax;
      this._inBuf  = new Float32Array(PSO_INSZ);
      this._outBuf = new Float32Array(PSO_OUTS);
      this._inW  = 0;
      this._outW = 0;
      this._outR = 0;
      this._synthRemain = 0;
      this._lastT0  = Math.round((this._tMin + this._tMax) / 2);
      this._voiced  = false;
      this._yinCount = 0;
    }
    process(inputs, outputs, parameters) {
      const inp = inputs[0]?.[0];
      const out = outputs[0]?.[0];
      if (!inp || !out) return true;
      const N = inp.length;
      const r = Math.max(R_MIN, Math.min(R_MAX, parameters.pitchRatio[0]));
      for (let i = 0; i < N; i++) {
        this._inBuf[this._inW++ & PSO_INM] = inp[i];
      }
      if (this._inW < this._latency + this._tMax + YIN_W) { out.fill(0); return true; }
      this._synthRemain -= N;
      while (this._synthRemain <= 0) this._generateGrain(r);
      if (this._outW - this._outR >= N) {
        for (let i = 0; i < N; i++) {
          const idx = this._outR++ & PSO_OUTM;
          out[i] = this._outBuf[idx];
          this._outBuf[idx] = 0.0;
        }
      } else {
        out.fill(0);
      }
      return true;
    }
    _generateGrain(r) {
      if (--this._yinCount <= 0) { this._runYIN(); this._yinCount = YIN_INT; }
      const anchor = this._inW - this._latency;
      let grainStart, grainSize, synthHop, grainGain;
      if (this._voiced) {
        const T0   = this._lastT0;
        const mark = this._findPitchMark(anchor, T0);
        grainStart = mark - T0;
        grainSize  = 2 * T0;
        synthHop   = Math.max(1, Math.round(T0 / r));
        grainGain  = 1 / r;
      } else {
        grainSize  = 128;
        grainStart = anchor - 64;
        synthHop   = 64;
        grainGain  = 1.0;
      }
      this._overlapAdd(grainStart, grainSize, grainGain);
      this._outW        += synthHop;
      this._synthRemain += synthHop;
    }
    _runYIN() {
      const base = this._inW - this._latency - YIN_W;
      const tMin = this._tMin;
      const tMax = this._tMax;
      let runSum = 0, bestTau = -1, bestD = 1.0;
      for (let tau = 1; tau <= tMax; tau++) {
        let d = 0;
        for (let j = 0; j < YIN_W; j++) {
          const diff = this._inBuf[(base + j)      & PSO_INM]
                     - this._inBuf[(base + j - tau) & PSO_INM];
          d += diff * diff;
        }
        runSum += d;
        if (tau < tMin) continue;
        const dNorm = runSum > 0 ? d * tau / runSum : 1.0;
        if (dNorm < YIN_THR && dNorm < bestD) {
          bestD = dNorm; bestTau = tau;
          if (dNorm < YIN_THR * 0.5) break;
        }
      }
      this._voiced = bestTau > 0;
      if (this._voiced) {
        const raw = Math.max(tMin, Math.min(tMax, bestTau));
        this._lastT0 = Math.round(0.85 * this._lastT0 + 0.15 * raw);
      }
    }
    _findPitchMark(anchor, T0) {
      const half = Math.max(1, Math.round(T0 * 0.25));
      let best = anchor, bestAbs = Infinity;
      for (let i = -half; i <= half; i++) {
        const v = Math.abs(this._inBuf[(anchor + i) & PSO_INM]);
        if (v < bestAbs) { bestAbs = v; best = anchor + i; }
      }
      return best;
    }
    _overlapAdd(start, size, gain) {
      if (size < 2) return;
      const sm1 = size - 1;
      for (let i = 0; i < size; i++) {
        const w = HANN[Math.round(i / sm1 * HTABM1)] * gain;
        this._outBuf[(this._outW + i) & PSO_OUTM] +=
          this._inBuf[(start + i) & PSO_INM] * w;
      }
    }
  }

  registerProcessor('pitch-shifter-ola',   OLAPitchShifter);
  registerProcessor('pitch-shifter-psola', PSOLAPitchShifter);
})();
`;let P=null;async function _e(a){if(!P){const e=new Blob([me],{type:"application/javascript"});P=URL.createObjectURL(e)}await a.audioWorklet.addModule(P)}class ge{_intervalMs;_isActive;_elapsedMs;_getGraph;_getStream;_intervalId=null;constructor(e,t,i,s,l){this._intervalMs=e,this._isActive=t,this._elapsedMs=i,this._getGraph=s,this._getStream=l}start(){this._intervalId||this._isActive()&&(this._intervalId=setInterval(()=>{try{if(!this._shouldSend())return;window.sendAnalyticsEvent?.("daf_active",{event_category:"DAF",event_label:"heartbeat",daf_usage_s:Math.floor(this._elapsedMs()/1e3)})}catch(e){console.warn("Analytics heartbeat error:",e)}},this._intervalMs))}stop(){this._intervalId&&(clearInterval(this._intervalId),this._intervalId=null)}_shouldSend(){if(!this._isActive())return!1;const e=this._getGraph();if(!e||e.state!=="running")return!1;const t=this._getStream();return!t||!t.getAudioTracks?.().some(s=>s.enabled!==!1)||e.gainValue<=0?!1:typeof window.sendAnalyticsEvent=="function"}}const ve=200,ye=`
(function () {
  'use strict';

  const SAMPLES = ${ve};

  class BenchmarkProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this._drifts = [];
      this._frame0 = -1;
      this._t0     = 0;
      this._done   = false;
    }

    process(_inputs, _outputs, _params) {
      if (this._done) return false;

      const wallMs = Date.now();

      if (this._frame0 === -1) {
        // Anchor: record the first quantum's frame count and wall time.
        // All subsequent drift measurements are relative to this pair.
        this._frame0 = currentFrame;
        this._t0     = wallMs;
        return true;
      }

      // Expected wall time = anchor + exact sample-accurate elapsed time.
      // currentFrame is integer samples — no resolution loss here.
      // Date.now() has 1ms resolution, but the DRIFT (deviation from expected)
      // still exposes scheduling pressure: a quantum consistently 5ms late
      // will show as drift ≈ +5ms regardless of Date.now() coarsening.
      const expectedMs = this._t0 + ((currentFrame - this._frame0) / sampleRate) * 1000;
      this._drifts.push(wallMs - expectedMs);

      if (this._drifts.length >= SAMPLES) {
        this._done = true;
        this.port.postMessage({ drifts: this._drifts });
        return false;
      }

      return true;
    }
  }

  registerProcessor('benchmark-processor', BenchmarkProcessor);
})();
`;async function we(a){const e=new Blob([ye],{type:"application/javascript"}),t=URL.createObjectURL(e);try{await a.audioWorklet.addModule(t)}finally{URL.revokeObjectURL(t)}}function be(a){return a.reduce((e,t)=>e+t,0)/a.length}function Ae(a,e){const t=a.reduce((i,s)=>i+(s-e)**2,0)/a.length;return Math.sqrt(t)}function Se(a){const e=[...a].sort((t,i)=>t-i);return e[Math.floor(e.length*.95)]??e[e.length-1]??0}async function Me(a,e,t){if(a.state!=="running")throw new Error(`AudioContext must be running (current state: ${a.state})`);const i=(a.baseLatency??0)*1e3,s=(a.outputLatency??0)*1e3;let l=null;try{const c=e?.getAudioTracks?.()?.[0]?.getSettings?.();c?.latency&&(l=c.latency*1e3)}catch{}const d=i+s+(l??0),f=Math.round(a.baseLatency*a.sampleRate),h=128/a.sampleRate*1e3;await we(a);const p=await new Promise((c,r)=>{let o=null;const u=setTimeout(()=>{try{o?.disconnect()}catch{}r(new Error("Benchmark timed out"))},5e3);try{o=new AudioWorkletNode(a,"benchmark-processor",{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]}),o.port.onmessage=_=>{clearTimeout(u);try{o.disconnect()}catch{}c(_.data.drifts)},o.onprocessorerror=_=>{clearTimeout(u),r(new Error(`Benchmark worklet error: ${_}`))},o.connect(a.destination)}catch(_){clearTimeout(u),r(_)}});if(p.length<10)throw new Error(`Too few samples collected (${p.length})`);const v=p.map(Math.abs),M=be(p),m=Ae(p,M),T=Se(v),I=Math.min(...p),n=Math.max(...p);return{sampleRate:a.sampleRate,baseLatencyMs:Math.round(i*10)/10,outputLatencyMs:Math.round(s*10)/10,inputLatencyMs:l!==null?Math.round(l*10)/10:null,fafLatencyMs:Math.round(t*10)/10,totalFloorMs:Math.round(d*10)/10,estimatedBufferSamples:f,quantumMs:Math.round(h*100)/100,jitter:{minDriftMs:Math.round(I*10)/10,maxDriftMs:Math.round(n*10)/10,meanDriftMs:Math.round(M*10)/10,p95DriftMs:Math.round(T*10)/10,stddevMs:Math.round(m*10)/10,samples:p.length}}}class De{_ctx=null;_nodes={source:null,gainNode:null,delayNode:null};_fafNodes=[];_fafSumNode=null;_fafActive=!1;_workletReady=!1;_pitchFloor=Q[ee].pitchFloor;_fafMode=H;measuredFloorMs=null;constructor(e){this._init(e)}get context(){return this._ctx}get state(){return this._ctx?.state??"closed"}get gainValue(){return this._nodes.gainNode?.gain.value??1}get fafLatencyMs(){return!this._fafActive||!this._ctx?0:this._fafMode==="ola"?J(this._ctx.sampleRate):te(this._pitchFloor,this._ctx.sampleRate)}set pitchFloor(e){this._pitchFloor=e}set fafMode(e){this._fafMode=e}connect(e,t){const i=this._ctx,s=this._nodes;s.source=i.createMediaStreamSource(e),s.gainNode=i.createGain(),s.delayNode=i.createDelay(.5);const l=1e-6;s.delayNode.delayTime.value=Math.max(l,t.delayTime/1e3),s.gainNode.gain.value=t.gain,s.source.connect(s.delayNode),s.delayNode.connect(s.gainNode),s.gainNode.connect(i.destination);const d=t.multiFAFSemitones?.length?t.multiFAFSemitones:t.pitchShift!==0?[t.pitchShift]:[];d.length>0&&this.setFAFNodes(d).catch(f=>console.warn("FAF init failed:",f))}disconnect(){this._teardownFAF();const{source:e,gainNode:t,delayNode:i}=this._nodes;[e,t,i].forEach(s=>{try{s?.disconnect()}catch{}}),this._nodes={source:null,gainNode:null,delayNode:null}}async close(){if(this.disconnect(),this._ctx&&this._ctx.state!=="closed")try{await this._ctx.close()}catch(e){console.error("Error closing AudioContext:",e)}this._ctx=null,this.measuredFloorMs=null,this._workletReady=!1}async resume(){this._ctx?.state==="suspended"&&await this._ctx.resume()}setDelayTime(e){if(!this._ctx||!this._nodes.delayNode)return;const i=e<=0?1e-6:e/1e3;this._nodes.delayNode.delayTime.setValueAtTime(i,this._ctx.currentTime)}setGain(e){!this._ctx||!this._nodes.gainNode||this._nodes.gainNode.gain.setValueAtTime(e,this._ctx.currentTime)}async setFAFSemitones(e){return this.setFAFNodes(e===0?[]:[e])}async setFAFNodes(e){if(!this._ctx||!this._nodes.source||!this._nodes.delayNode)return;const{source:t,delayNode:i}=this._nodes;if(e.length===0){if(!this._fafActive)return;this._teardownFAF();try{t.connect(i)}catch{}console.log("FAF bypassed");return}if(!this._workletReady)try{await _e(this._ctx),this._workletReady=!0}catch(d){throw console.error("PitchShifterWorklet failed to load:",d),d}if(!this._ctx||!this._nodes.source||!this._nodes.delayNode)return;if(e.length===this._fafNodes.length&&this._fafActive){for(let f=0;f<e.length;f++){const h=this._fafNodes[f].parameters.get("pitchRatio");h&&(h.value=G(e[f]))}const d=e.map(f=>`${f>0?"+":""}${f}`).join(", ");console.log(`FAF ratios updated: [${d}] st`);return}this._teardownFAF();try{this._nodes.source.disconnect(this._nodes.delayNode)}catch{}const s=e.length;this._fafSumNode=this._ctx.createGain(),this._fafSumNode.gain.value=1/s;for(const d of e){const f=this._fafMode==="ola"?"pitch-shifter-ola":"pitch-shifter-psola",h=new AudioWorkletNode(this._ctx,f,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:this._fafMode==="psola"?{pitchFloor:this._pitchFloor}:{}}),p=h.parameters.get("pitchRatio");p&&(p.value=G(d)),this._nodes.source.connect(h),h.connect(this._fafSumNode),this._fafNodes.push(h)}this._fafSumNode.connect(this._nodes.delayNode),this._fafActive=!0;const l=e.map(d=>`${d>0?"+":""}${d}`).join(", ");console.log(`FAF enabled [${s} signal${s>1?"s":""}]: [${l}] st`)}onStateChange(e){this._ctx?.addEventListener("statechange",t=>{const i=t.target.state;e(i)})}measureLatencyFloor(e){if(this._ctx)try{const t=((this._ctx.baseLatency??0)+(this._ctx.outputLatency??0))*1e3;let i=0;try{const l=e?.getAudioTracks?.()?.[0]?.getSettings?.();l?.latency&&(i=l.latency*1e3)}catch{}const s=i+t;this.measuredFloorMs=s,console.log(`Latency floor: ${t.toFixed(1)}ms (output)`+(i?` + ${i.toFixed(1)}ms (input)`:" + 0 (input unknown)")+` = ${s.toFixed(1)}ms total`),s>25&&console.warn(`Round-trip floor ${s.toFixed(1)}ms > 25ms — slap-back likely at low delay settings`)}catch{}}async benchmark(e){if(!this._ctx)throw new Error("AudioContext not initialised");return Me(this._ctx,e,this.fafLatencyMs)}_teardownFAF(){const e=this._nodes.source;for(const t of this._fafNodes){if(e)try{e.disconnect(t)}catch{}try{t.disconnect()}catch{}}if(this._fafNodes=[],this._fafSumNode){try{this._fafSumNode.disconnect()}catch{}this._fafSumNode=null}this._fafActive=!1}_init(e){const t={latencyHint:0};e&&Number.isFinite(e)&&(t.sampleRate=e);const i=window.AudioContext??window.webkitAudioContext;this._ctx=new i(t)}}class Fe{availableDevices=[];selectedDeviceId=null;micAccessGranted=!1;echoCancellation=!1;noiseSuppression=!1;_ui;_reporter;_sampleRate=null;_currentLabel="";_initialized=!1;_onDeviceChange=null;constructor(e,t){this._ui=e,this._reporter=t}async acquireStream(e=null){if(e)return this.micAccessGranted=!0,this._recordTrackMeta(e.getAudioTracks()[0]),{stream:e,sampleRate:this._sampleRate};const t={audio:{echoCancellation:this.echoCancellation,autoGainControl:!1,noiseSuppression:this.noiseSuppression,channelCount:1,...this.selectedDeviceId?{deviceId:{exact:this.selectedDeviceId}}:{}}},i=await navigator.mediaDevices.getUserMedia(t);this.micAccessGranted=!0,this._recordTrackMeta(i.getAudioTracks()[0]);try{const s=await navigator.mediaDevices.enumerateDevices();this.availableDevices=s.filter(l=>l.kind==="audioinput")}catch(s){console.warn("Could not refresh device list after mic grant:",s)}return{stream:i,sampleRate:this._sampleRate}}releaseStream(e){e&&(e.getTracks().forEach(t=>{t.stop(),t.enabled=!1}),this.micAccessGranted=!1)}async enumerate(){try{let e=null;if(!this.micAccessGranted)try{e=await navigator.mediaDevices.getUserMedia({audio:!0})}catch{}const t=await navigator.mediaDevices.enumerateDevices();return e&&e.getTracks().forEach(i=>{try{i.stop()}catch{}}),this.availableDevices=t.filter(i=>i.kind==="audioinput"),console.log("Audio inputs:",this.availableDevices),this._autoSelectHeadphone(),this._reflectSelectedDeviceInUI(),this._ui.populateDeviceDropdown(this.availableDevices,this.selectedDeviceId),this.availableDevices}catch(e){return console.error("Error enumerating audio devices:",e),this._ui.updateDeviceUI("Default microphone",!1),[]}}async selectById(e,t,i){if(!e)return!1;if(!t)return this.selectedDeviceId=e,this._ui.syncDeviceDropdown(e),!0;let s=null;try{s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:this.echoCancellation,autoGainControl:!1,noiseSuppression:this.noiseSuppression,channelCount:1,deviceId:{exact:e}}})}catch(p){const{message:v}=this._reporter.classifyMicError(p);return this._ui.updateStatus(v,"error"),this._ui.syncDeviceDropdown(this.selectedDeviceId),!1}const l=this.selectedDeviceId;if(this.selectedDeviceId=e,!await i(s))return this.selectedDeviceId=l,this._ui.syncDeviceDropdown(l),!1;const h=this.availableDevices.find(p=>p.deviceId===e)?.label??"Selected microphone";this._ui.updateDeviceUI(h,this._isHeadphoneMic(h)),this._ui.syncDeviceDropdown(e),this._ui.updateStatus(`Switched to: ${h}`,"success");try{window.sendAnalyticsEvent?.("device_switch",{to_device_name:h})}catch{}return!0}async select(e,t=null){if(!e)return!1;const i=this.selectedDeviceId;if(t){let s=null;try{s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:this.echoCancellation,autoGainControl:!1,noiseSuppression:this.noiseSuppression,channelCount:1,deviceId:{exact:e}}})}catch(d){const{message:f}=this._reporter.classifyMicError(d);return this._ui.updateStatus(f,"error"),!1}this.selectedDeviceId=e;const l=await t(s);return l||(this.selectedDeviceId=i),l}return this.selectedDeviceId=e,!0}initChangeListener(e,t){if(!this._initialized){this._onDeviceChange=async()=>{t()&&await e()};try{navigator.mediaDevices.addEventListener("devicechange",this._onDeviceChange)}catch(i){console.warn("Could not attach devicechange listener:",i),this._onDeviceChange=null}this._initialized=!0}}destroy(){try{this._onDeviceChange&&navigator.mediaDevices.removeEventListener("devicechange",this._onDeviceChange)}catch{}this._initialized=!1,this._onDeviceChange=null,this.availableDevices=[],this.selectedDeviceId=null,this.micAccessGranted=!1}_recordTrackMeta(e){if(!e)return;const t=e.getSettings?.()??{};this._sampleRate=t.sampleRate??null,t.deviceId&&(this.selectedDeviceId=t.deviceId);const i=e.label||"";this._currentLabel=i||"Default microphone";const s=this._isHeadphoneMic(i);this._ui.updateDeviceUI(this._currentLabel,s),this._reporter.micAcquired(t,i),console.log("Selected microphone settings:",t)}_autoSelectHeadphone(){const e=this.availableDevices.find(t=>{const i=(t.label||"").toLowerCase();return i.includes("bluetooth")||i.includes("airpod")?!1:i.includes("headphone")||i.includes("headset")||i.includes("earphone")});e&&this.selectedDeviceId!==e.deviceId&&(this.selectedDeviceId=e.deviceId,console.log("Auto-selected headphone mic:",e.label),this._ui.updateDeviceUI(e.label,!0))}_reflectSelectedDeviceInUI(){if(this.selectedDeviceId){const t=this.availableDevices.find(i=>i.deviceId===this.selectedDeviceId);if(t){this._ui.updateDeviceUI(t.label,this._isHeadphoneMic(t.label)),this._ui.syncDeviceDropdown(t.deviceId);return}}const e=this.availableDevices.find(t=>t.deviceId==="default"||t.deviceId==="")??this.availableDevices[0];e?(this._ui.updateDeviceUI(e.label,this._isHeadphoneMic(e.label)),this._ui.syncDeviceDropdown(e.deviceId)):this._ui.updateDeviceUI("Default microphone",!1)}_isHeadphoneMic(e){if(!e)return!1;const t=e.toLowerCase();return t.includes("bluetooth")||t.includes("airpod")?!1:t.includes("headphone")||t.includes("headset")||t.includes("earphone")}}class Ie{classifyMicError(e){const t=e,i=t?.name??"",s=(t?.message??"").toLowerCase();return i==="NotAllowedError"&&s.includes("system")?{tag:"permission_denied_system",message:"Your operating system is blocking microphone access. Please check your system privacy settings (macOS: System Settings → Privacy & Security → Microphone; Windows: Settings → Privacy → Microphone) and allow access, then try again."}:i==="NotAllowedError"&&s.includes("avaudiosession")?{tag:"permission_denied_ios_no_device",message:"No microphone was found on your device. Please plug in a headset or enable microphone access in Settings → Safari → Microphone, then try again."}:i==="NotAllowedError"&&s.includes("dismiss")?{tag:"permission_dismissed",message:'Microphone access was dismissed. Please tap "Start DAF" again and click "Allow" when prompted.'}:i==="NotAllowedError"||i==="PermissionDeniedError"||s.includes("not allowed")||s.includes("denied")?{tag:"permission_denied_user",message:`Microphone access was denied. Please click the 🔒 / 🎙️ icon in your browser's address bar, set Microphone to "Allow", refresh the page, and try again.`}:i==="NotFoundError"||s.includes("not found")||s.includes("device")?{tag:"device_not_found",message:"The selected microphone could not be found. It may have been unplugged. Please check your microphone connection and try again."}:{tag:"unknown",message:"Could not access your microphone. Please make sure a microphone is connected and this page has permission to use it, then try again."}}audioInitFailed(e,{deviceId:t=null,micErrorTag:i="unknown",audioContextState:s="not_initialized",availableDeviceCount:l=0,hasUserMedia:d=!!navigator.mediaDevices?.getUserMedia,secureContext:f=window.isSecureContext,preAcquired:h=!1}={}){this._capture(p=>p.captureException(e,{tags:{mechanism:"audio_init",mic_error_type:i,secure_context:f},extra:{requestedDeviceId:t,audioContextState:s,availableDeviceCount:l,hasUserMedia:d,preAcquired:h}}))}audioResumedAfterRetries(e){e<=1||this._capture(t=>t.captureMessage("Audio resumed after multiple attempts",{level:"warning",extra:{attempts:e}}))}micAcquired(e,t){const i={autoGainControl:e.autoGainControl,echoCancellation:e.echoCancellation,noiseSuppression:e.noiseSuppression,sampleRate:e.sampleRate,label:t||"Unknown"};this._capture(s=>{typeof s.setContext=="function"?s.setContext("mic_settings",i):typeof s.configureScope=="function"&&s.configureScope(l=>l.setContext("mic_settings",i))})}visibilityChanged(e){this._capture(t=>t.addBreadcrumb({category:"ui.lifecycle",message:`Visibility changed to ${e}`,level:"info"}))}_capture(e){if(window.Sentry)try{e(window.Sentry)}catch(t){console.warn("ErrorReporter: Sentry call failed",t)}}}class Le{_intervalId=null;_startTime=0;elapsedMs=0;start(){const e=document.getElementById("dafTimer");e&&(this._startTime=performance.now(),this.elapsedMs=0,e.textContent="00:00",e.classList.add("timer-running"),this._tick(e))}resume(){const e=document.getElementById("dafTimer");!e||this._intervalId||(this._startTime=performance.now()-this.elapsedMs,e.classList.add("timer-running"),this._tick(e))}pause(){this._intervalId&&(clearInterval(this._intervalId),this._intervalId=null)}stop(){this.pause(),this.elapsedMs=0;const e=document.getElementById("dafTimer");e&&(e.textContent="00:00",e.classList.remove("timer-running"))}_tick(e){this._intervalId=setInterval(()=>{this.elapsedMs=performance.now()-this._startTime;const t=Math.floor(this.elapsedMs/1e3),i=String(Math.floor(t/60)).padStart(2,"0"),s=String(t%60).padStart(2,"0");e.textContent=`${i}:${s}`},1e3)}}const Ee={success:"status-success",error:"status-error",loading:"status-loading",warning:"status-warning",info:"status-info"};class O{updateStatus(e,t="info"){const i=document.getElementById("statusMessage");i&&(i.textContent=e,i.classList.remove("status-success","status-error","status-warning","status-info","status-default","status-loading"),i.classList.add(Ee[t]??"status-default"))}updateDisplay(e,t){const i=document.getElementById(e);i&&(i.textContent=t)}updateControls(e){const t=document.getElementById("dafButton");t&&(t.textContent=e?"Stop DAF":"Start DAF",t.setAttribute("aria-pressed",String(e)))}updateDeviceUI(e,t){const i=document.getElementById("deviceIcon");i&&(i.textContent=t?"🎧":"🎙️")}populateDeviceDropdown(e,t){const i=document.getElementById("deviceSelect");if(i){if(i.innerHTML="",e.length===0){const s=document.createElement("option");s.value="",s.textContent="No microphones found",i.appendChild(s),i.disabled=!0;return}i.disabled=!1,e.forEach((s,l)=>{const d=document.createElement("option");d.value=s.deviceId,d.textContent=s.label||`Microphone ${l+1}`,s.deviceId===t&&(d.selected=!0),i.appendChild(d)}),!i.value&&e.length>0&&(i.options[0].selected=!0)}}setDeviceDropdownPending(){const e=document.getElementById("deviceSelect");if(!e)return;e.innerHTML="";const t=document.createElement("option");t.value="",t.textContent="Start DAF to see available microphones",e.appendChild(t),e.disabled=!0}syncDeviceDropdown(e){if(!e)return;const t=document.getElementById("deviceSelect");t&&(t.value=e,!t.value&&t.options.length>0&&(t.options[0].selected=!0))}}class Ne{config={delayTime:200,gain:1,pitchShift:0,multiFAFSemitones:[],pitchFloor:120,fafMode:H};_ui;_reporter;_devices;_timer;_heartbeat;_graph=null;_stream=null;_resumeAttempts=0;_maxResumeAttempts=5;_isAppVisible=document.visibilityState==="visible";_onVisibilityChange;_onFreeze;_onResume;_onDocClick;constructor(){this._ui=new O,this._reporter=new Ie,this._devices=new Fe(this._ui,this._reporter),this._timer=new Le,this._heartbeat=new ge(6e4,()=>this.isRunning,()=>this._timer.elapsedMs,()=>this._graph,()=>this._stream),this._onVisibilityChange=this._handleVisibilityChange.bind(this),this._onFreeze=this._handleFreeze.bind(this),this._onResume=this._handleResume.bind(this),this._onDocClick=this._handleDocClick.bind(this),document.addEventListener("visibilitychange",this._onVisibilityChange),"onfreeze"in document&&document.addEventListener("freeze",this._onFreeze),"onresume"in document&&document.addEventListener("resume",this._onResume),document.addEventListener("click",this._onDocClick),this._ui.updateDeviceUI('Click "Start DAF" to select your microphone',!1)}get isRunning(){return!!this._graph&&this._graph.state==="running"}get measuredFloorMs(){return this._graph?.measuredFloorMs??null}get fafLatencyMs(){return this._graph?.fafLatencyMs??0}async start(e=null){this._ui.updateStatus("Starting audio connection…","loading");try{const{stream:t,sampleRate:i}=await this._devices.acquireStream(e);this._stream=t,this._graph=new De(i),this._graph.pitchFloor=this.config.pitchFloor,this._graph.fafMode=this.config.fafMode,this._graph.onStateChange(s=>this._onGraphStateChange(s)),this._graph.connect(t,this.config),this._graph.state==="running"&&(this._graph.measureLatencyFloor(this._stream),this._refreshDelayDisplay(),setTimeout(()=>{this.isRunning&&this._graph&&(this._graph.measureLatencyFloor(this._stream),this._refreshDelayDisplay())},200)),this._ui.updateControls(!0),this._ui.updateStatus("Auditory Feedback Active","success"),this._timer.elapsedMs>0?this._timer.resume():this._timer.start(),this._heartbeat.start(),await this._devices.enumerate(),this._devices.initChangeListener(()=>this._devices.enumerate(),()=>this.isRunning)}catch(t){throw this._handleStartError(t),t}}async stop({preserveTimer:e=!1}={}){this._heartbeat.stop(),e?this._timer.pause():this._timer.stop(),this._devices.releaseStream(this._stream),this._stream=null,await this._graph?.close(),this._graph=null,this._resumeAttempts=0,this._ui.updateStatus("Auditory Feedback Stopped","info"),this._ui.updateControls(!1),this._ui.updateDeviceUI('Click "Start DAF" to select your microphone',!1)}async restartWithNewDevice(e=null){const t={...this.config,multiFAFSemitones:[...this.config.multiFAFSemitones]};return await this.stop({preserveTimer:!0}),await new Promise(i=>setTimeout(i,300)),this.config=t,await this.start(e),!0}updateDelayTime(e){this.config.delayTime=e,this._graph?.setDelayTime(e),this._refreshDelayDisplay()}updateGain(e){this.config.gain=e,this._graph?.setGain(e),this._ui.updateDisplay("inputGainValue",`${e}x`)}updateInputGain(e){this.updateGain(e)}updatePitchShift(e){this.config.pitchShift=e,this._refreshDelayDisplay(),this._graph?.setFAFSemitones(e).then(()=>this._refreshDelayDisplay()).catch(t=>console.warn("FAF update failed:",t))}updateMultiFAFNodes(e){this.config.multiFAFSemitones=e,this._refreshDelayDisplay(),this._graph?.setFAFNodes(e).then(()=>this._refreshDelayDisplay()).catch(t=>console.warn("Multi-FAF update failed:",t))}setPreferredDevice(e){this._devices.selectedDeviceId=e}updateVoiceProfile(e){if(this.config.pitchFloor=e,this._graph){this._graph.pitchFloor=e;const t=this.config.multiFAFSemitones.length?this.config.multiFAFSemitones:this.config.pitchShift!==0?[this.config.pitchShift]:[];t.length>0&&this._graph.setFAFNodes([]).then(()=>this._graph?.setFAFNodes(t)).then(()=>this._refreshDelayDisplay()).catch(i=>console.warn("Voice profile FAF rebuild failed:",i)),this._refreshDelayDisplay()}}updateFAFMode(e){if(this.config.fafMode=e,this._graph){this._graph.fafMode=e;const t=this.config.multiFAFSemitones.length?this.config.multiFAFSemitones:this.config.pitchShift!==0?[this.config.pitchShift]:[];t.length>0&&this._graph.setFAFNodes([]).then(()=>this._graph?.setFAFNodes(t)).then(()=>this._refreshDelayDisplay()).catch(i=>console.warn("FAF mode switch failed:",i)),this._refreshDelayDisplay()}}seedAudioConstraints(e,t){this._devices.echoCancellation=e,this._devices.noiseSuppression=t}async updateAudioConstraints(e,t){this._devices.echoCancellation=e,this._devices.noiseSuppression=t,this.isRunning&&await this.restartWithNewDevice(null)}async selectAudioDevice(e){await this._devices.selectById(e,this.isRunning,t=>this.restartWithNewDevice(t))}async runBenchmark(){if(!this._graph)throw new Error("DAF is not running");return this._graph.benchmark(this._stream)}async destroy(){await this.stop(),this._devices.destroy(),document.removeEventListener("visibilitychange",this._onVisibilityChange),document.removeEventListener("freeze",this._onFreeze),document.removeEventListener("resume",this._onResume),document.removeEventListener("click",this._onDocClick),console.log("SpeechProcessor destroyed")}async attemptResumeAudio(){if(!(!this._graph||this._graph.state!=="suspended")&&!(this._resumeAttempts>=this._maxResumeAttempts)){this._resumeAttempts++;try{await this._graph.resume(),this._resumeAttempts=0}catch{if(this._resumeAttempts>1&&this._reporter.audioResumedAfterRetries(this._resumeAttempts),this._resumeAttempts<this._maxResumeAttempts){const e=Math.pow(2,this._resumeAttempts)*100;setTimeout(()=>this.attemptResumeAudio(),e)}else this._ui.updateStatus("Audio paused — tap to resume","error"),this._heartbeat.stop()}}}_onGraphStateChange(e){this._notifyServiceWorker("AUDIO_STATE",{state:e}),e==="running"&&this._graph&&(this._graph.measureLatencyFloor(this._stream),this._refreshDelayDisplay()),e==="suspended"&&this._isAppVisible&&this._graph&&this.attemptResumeAudio()}_handleVisibilityChange(){this._isAppVisible=document.visibilityState==="visible",this._reporter.visibilityChanged(document.visibilityState),this._notifyServiceWorker("VISIBILITY_CHANGE",{isVisible:this._isAppVisible}),this._isAppVisible&&this._graph?.state==="suspended"&&this.attemptResumeAudio()}_handleFreeze(){}_handleResume(){this._graph?.state==="suspended"&&this.attemptResumeAudio()}_handleDocClick(){this._graph?.state==="suspended"&&this.attemptResumeAudio()}_notifyServiceWorker(e,t){"serviceWorker"in navigator&&navigator.serviceWorker.controller&&navigator.serviceWorker.controller.postMessage({type:e,...t})}_refreshDelayDisplay(){const e=this.config.delayTime,t=this.measuredFloorMs??0,i=this.fafLatencyMs,s=t+i,l=s>5?`${e} ms (~${Math.round(e+s)} ms effective)`:`${e} ms`;this._ui.updateDisplay("delayValue",l)}_handleStartError(e){this._heartbeat.stop(),this._timer.stop();const t=this._reporter.classifyMicError(e);this._reporter.audioInitFailed(e,{deviceId:this._devices.selectedDeviceId,micErrorTag:t.tag,audioContextState:this._graph?.context?.state??"not_initialized",availableDeviceCount:this._devices.availableDevices.length,hasUserMedia:!!navigator.mediaDevices?.getUserMedia,secureContext:window.isSecureContext,preAcquired:!1}),window.sendAnalyticsEvent?.("daf_initialization_error",{event_category:"DAF",event_label:t.tag,error_message:e?.message??""}),this._ui.updateStatus(t.message,"error")}}"serviceWorker"in navigator&&window.addEventListener("load",()=>{navigator.serviceWorker.register(`${Z.base}service-worker.js`).then(a=>console.log("Service Worker registered:",a.scope)).catch(a=>console.warn("Service Worker registration failed:",a))});let D=null;async function Y(){try{"wakeLock"in navigator&&(D=await navigator.wakeLock.request("screen"),D.addEventListener("release",()=>{D=null}))}catch(a){console.error("Wake Lock request failed:",a.message)}}function K(){D?.release().then(()=>{D=null}).catch(console.error)}let F=null,L=!1,E=!1,$=120,k=H,A="semitones",B=800;function x(a,e){if(a===0)return"Off";const t=Math.abs(a),i=a>0?"+":"-";return e==="semitones"?`${i}${t} ${t===1?"semitone":"semitones"}`:`${i}${t} ${t===1?"cent":"cents"}`}function N(a,e){return e==="cents"?a/100:a}let S=!1,C=2;const W=[4,-4,0,-4];function R(){return W.slice(0,C)}document.addEventListener("visibilitychange",()=>{const a=document.visibilityState==="visible";window.sendAnalyticsEvent?.("page_visibility",{visibility:a?"visible":"hidden"}),a&&window.speechProcessor&&(window.speechProcessor.attemptResumeAudio(),D||Y())});window.addEventListener("beforeunload",()=>{window.speechProcessor?.stop(),K(),window.sendAnalyticsEvent?.("session_end")});window.toggleDAF=async function(){const a=!window.speechProcessor?.isRunning;if(window.sendAnalyticsEvent?.(a?"start_daf":"stop_daf",{event_category:"user_action",event_label:a?"DAF Started":"DAF Stopped"}),a){window.speechProcessor=new Ne;const e=document.getElementById("delaySlider"),t=document.getElementById("inputGainSlider"),i=document.getElementById("pitchShiftSlider");window.speechProcessor.config.delayTime=Number(e?.value??200),window.speechProcessor.config.gain=Number(t?.value??1),S?(window.speechProcessor.config.multiFAFSemitones=R(),window.speechProcessor.config.pitchShift=0):(window.speechProcessor.config.multiFAFSemitones=[],window.speechProcessor.config.pitchShift=N(Number(i?.value??0),A)),F&&(window.speechProcessor.setPreferredDevice(F),F=null),window.speechProcessor.seedAudioConstraints(L,E),window.speechProcessor.config.pitchFloor=$,window.speechProcessor.config.fafMode=k,Y();try{await window.speechProcessor.start()}catch{}}else await window.speechProcessor?.stop(),window.speechProcessor=void 0,K()};document.addEventListener("DOMContentLoaded",()=>{const a=document.getElementById("statusMessage"),e=document.getElementById("delaySlider"),t=document.getElementById("inputGainSlider"),i=document.getElementById("pitchShiftSlider");if(a?.classList.add("status-default"),e){const n=document.getElementById("delayValue");n&&(n.textContent=`${e.value} ms`)}if(t){const n=document.getElementById("inputGainValue");n&&(n.textContent=`${t.value}x`)}if(i){const n=document.getElementById("pitchShiftValue");n&&(n.textContent=x(Number(i.value),A))}e?.addEventListener("input",n=>{const c=Number(n.target.value),r=n.target;r.setAttribute("aria-valuenow",String(c)),r.setAttribute("aria-valuetext",`${c} milliseconds`);const o=document.getElementById("delayValue");o&&(o.textContent=`${c} ms`),window.speechProcessor?.updateDelayTime(c),window.sendAnalyticsEvent?.("adjust_delay",{current_delay_ms:c},{debounce:!0,debounceMs:5e3})}),t?.addEventListener("input",n=>{const c=Number(n.target.value);n.target.setAttribute("aria-valuenow",String(c)),n.target.setAttribute("aria-valuetext",`${c}x`);const r=document.getElementById("inputGainValue");r&&(r.textContent=`${c}x`),window.speechProcessor?.updateGain(c),window.sendAnalyticsEvent?.("adjust_input_gain",{current_input_gain:c},{debounce:!0,debounceMs:5e3})}),i?.addEventListener("input",n=>{const c=Number(n.target.value),r=x(c,A),o=N(c,A),u=document.getElementById("pitchShiftValue");u&&(u.textContent=r),n.target.setAttribute("aria-valuenow",String(c)),n.target.setAttribute("aria-valuetext",r),window.speechProcessor?.updatePitchShift(o),window.sendAnalyticsEvent?.("adjust_pitch_shift",{semitones:o},{debounce:!0,debounceMs:5e3})});function s(n,c){document.querySelectorAll(`.mode-btn[data-group="${n}"]`).forEach(r=>{const o=r.dataset.value===c;r.classList.toggle("mode-btn--active",o),r.setAttribute("aria-pressed",String(o))})}s("faf-type","single"),document.querySelectorAll(".mode-btn[data-group]").forEach(n=>{n.addEventListener("click",()=>{const c=n.dataset.group,r=n.dataset.value;switch(c){case"faf-type":{const o=document.getElementById("singleFAFSection"),u=o&&!o.hidden;if(r===(S?"multi":u?"single":"off"))return;s("faf-type",r);const g=document.getElementById("multiFAFSection"),w=document.getElementById("pitchUnitSection"),b=document.getElementById("offFAFSection");if(r==="off")S=!1,b&&(b.hidden=!1),o&&(o.hidden=!0),g&&(g.hidden=!0),w&&(w.hidden=!0),i&&(i.value="0"),window.speechProcessor?.updateMultiFAFNodes([]),window.speechProcessor?.updatePitchShift(0);else if(r==="single"){S=!1,b&&(b.hidden=!0),o&&(o.hidden=!1),g&&(g.hidden=!0),w&&(w.hidden=!1),window.speechProcessor?.updateMultiFAFNodes([]);const y=Number(i?.value??0);window.speechProcessor?.updatePitchShift(N(y,A))}else S=!0,b&&(b.hidden=!0),o&&(o.hidden=!0),g&&(g.hidden=!1),w&&(w.hidden=!0),window.speechProcessor?.updateMultiFAFNodes(R());window.sendAnalyticsEvent?.("faf_type_change",{value:r});break}case"faf-count":{const o=Number(r);if(!o||o===C)return;C=o,s("faf-count",r),V(),S&&window.speechProcessor?.updateMultiFAFNodes(R()),window.sendAnalyticsEvent?.("multi_faf_count_change",{count:o});break}case"pitch-unit":{const o=r;if(o===A)return;const u=i?N(Number(i.value),A):0;A=o,s("pitch-unit",r);const _=document.getElementById("centsRangeSelector");if(_&&(_.hidden=o==="semitones"),document.querySelectorAll('.mode-btn[data-group="cents-range"]').forEach(g=>{g.disabled=o==="semitones"}),i){if(o==="semitones"){const y=Math.round(Math.max(-8,Math.min(8,u)));i.min="-8",i.max="8",i.step="1",i.value=String(y),i.setAttribute("aria-valuemin","-8"),i.setAttribute("aria-valuemax","8")}else{const y=B,X=Math.round(Math.max(-y,Math.min(y,u*100)));i.min=String(-y),i.max=String(y),i.step="1",i.value=String(X),i.setAttribute("aria-valuemin",String(-y)),i.setAttribute("aria-valuemax",String(y))}const g=Number(i.value),w=x(g,o),b=document.getElementById("pitchShiftValue");b&&(b.textContent=w),i.setAttribute("aria-valuenow",String(g)),i.setAttribute("aria-valuetext",w),window.speechProcessor?.updatePitchShift(N(g,o))}break}case"cents-range":{const o=Number(r);if(!o||o===B||A!=="cents")return;if(B=o,s("cents-range",r),i){const u=Math.max(-o,Math.min(o,Number(i.value)));i.min=String(-o),i.max=String(o),i.value=String(u),i.setAttribute("aria-valuemin",String(-o)),i.setAttribute("aria-valuemax",String(o));const _=x(u,"cents"),g=document.getElementById("pitchShiftValue");g&&(g.textContent=_),i.setAttribute("aria-valuenow",String(u)),i.setAttribute("aria-valuetext",_),window.speechProcessor?.updatePitchShift(u/100)}break}case"faf-mode":{const o=r;if(o===k)return;k=o,s("faf-mode",r),h(o),window.speechProcessor?.updateFAFMode(o),window.sendAnalyticsEvent?.("faf_mode_change",{mode:o});break}case"voice-type":{const o=Number(r);if(!o||o===$)return;$=o,s("voice-type",r),window.speechProcessor?.updateVoiceProfile(o),window.sendAnalyticsEvent?.("voice_profile_change",{pitchFloor:o});break}case"bench-mode":{const o=document.getElementById("benchmarkContainer");if(!o)return;s("bench-mode",r),o.className=o.className.replace(/\bbench-mode--\w+/g,"").trim()+` bench-mode--${r}`;break}}})});const l=document.getElementById("advancedToggle"),d=document.getElementById("advancedPanel");l?.addEventListener("click",()=>{const n=l.getAttribute("aria-checked")==="true";l.setAttribute("aria-checked",String(!n)),l.classList.toggle("toggle-switch--on",!n),d&&(d.hidden=n)});const f=(n,c,r,o)=>{const u=document.getElementById(n);u&&u.addEventListener("click",()=>{const _=!c();r(_),u.setAttribute("aria-checked",String(_)),u.classList.toggle("toggle-switch--on",_),o(_)})};f("echoCancelToggle",()=>L,n=>{L=n},()=>window.speechProcessor?.updateAudioConstraints(L,E).catch(n=>console.warn("Constraint update failed:",n))),f("noiseSuppressToggle",()=>E,n=>{E=n},()=>window.speechProcessor?.updateAudioConstraints(L,E).catch(n=>console.warn("Constraint update failed:",n)));const h=n=>{document.querySelectorAll('.mode-btn[data-group="voice-type"]').forEach(c=>{c.disabled=n==="ola",c.title=n==="ola"?"Voice type only applies in High-Fidelity mode":""}),n==="ola"?document.querySelectorAll('.mode-btn[data-group="voice-type"]').forEach(c=>{c.addEventListener("click",p,{capture:!0})}):document.querySelectorAll('.mode-btn[data-group="voice-type"]').forEach(c=>{c.removeEventListener("click",p,{capture:!0})})};function p(){const n=document.querySelector('.mode-btn[data-group="faf-mode"][data-value="psola"]');n&&(n.classList.remove("mode-btn--glow"),n.offsetWidth,n.classList.add("mode-btn--glow"),n.addEventListener("animationend",()=>n.classList.remove("mode-btn--glow"),{once:!0}))}h(k),V();const v=document.getElementById("benchmarkBtn"),M=document.getElementById("benchmarkContainer");function m(n,c){const r=M?.querySelector(`[data-bench="${n}"]`);r&&(r.textContent=c)}v?.addEventListener("click",async()=>{if(!window.speechProcessor?.isRunning){if(!document.getElementById("benchmarkInactiveMsg")){const c=document.createElement("p");c.id="benchmarkInactiveMsg",c.className="bench-inactive-msg",c.innerHTML='Measures active session. <a href="#dafButton" class="bench-inactive-link" id="benchmarkStartLink">Start auditory feedback</a> first.',v.insertAdjacentElement("afterend",c),document.getElementById("benchmarkStartLink")?.addEventListener("click",o=>{o.preventDefault();const u=document.getElementById("dafButton");u&&(u.scrollIntoView({behavior:"smooth",block:"center"}),u.focus(),u.classList.add("btn--highlight"),setTimeout(()=>u.classList.remove("btn--highlight"),1800))});const r=new MutationObserver(()=>{window.speechProcessor?.isRunning&&(c.remove(),r.disconnect())});r.observe(document.getElementById("statusMessage")??document.body,{childList:!0,subtree:!0,characterData:!0})}return}v.disabled=!0,v.textContent="Running…";try{const n=await window.speechProcessor.runBenchmark(),c=n.jitter.stddevMs<.5?"✅ Excellent":n.jitter.stddevMs<1.5?"🟡 Good":n.jitter.stddevMs<3?"🟠 Moderate":"🔴 High";m("sampleRate",n.sampleRate.toLocaleString()+" Hz"),m("estimatedBuffer",n.estimatedBufferSamples+" samples"),m("baseLatency",n.baseLatencyMs>0?n.baseLatencyMs+" ms":"0 ms (not reported by this browser)"),m("outputLatency",n.outputLatencyMs+" ms"),m("inputLatency",n.inputLatencyMs!==null?n.inputLatencyMs+" ms":"n/a"),m("fafLatency",n.fafLatencyMs>0?n.fafLatencyMs+" ms":"off"),m("totalFloor",n.totalFloorMs+" ms"),m("quantumMs",n.quantumMs+" ms"),m("jitterSamples",String(n.jitter.samples)),m("minDrift",n.jitter.minDriftMs+" ms"),m("maxDrift",n.jitter.maxDriftMs+" ms"),m("meanDrift",n.jitter.meanDriftMs+" ms"),m("p95Drift",n.jitter.p95DriftMs+" ms"),m("jitterStddev",n.jitter.stddevMs+" ms — "),m("jitterRating",c);const r=document.getElementById("jitterHighWarn");r&&(r.hidden=n.jitter.stddevMs<3),M&&(M.hidden=!1),window.sendAnalyticsEvent?.("benchmark_run",{total_floor_ms:n.totalFloorMs,jitter_stddev_ms:n.jitter.stddevMs,sample_rate:n.sampleRate})}catch(n){new O().updateStatus(`Benchmark failed: ${n.message}`,"error")}finally{v.disabled=!1,v.textContent="Run Benchmark"}}),document.getElementById("dafButton")?.addEventListener("click",()=>window.toggleDAF()),a?.addEventListener("click",()=>{window.speechProcessor&&(window.speechProcessor.attemptResumeAudio(),window.sendAnalyticsEvent?.("resume_audio_attempt"))});const T=document.getElementById("deviceSelect"),I=new O;navigator.mediaDevices?.enumerateDevices().then(n=>{const c=n.filter(r=>r.kind==="audioinput");if(c.some(r=>r.label)){const r=c[0]?.deviceId??null;I.populateDeviceDropdown(c,r),r&&!F&&(F=r)}else I.setDeviceDropdownPending()}).catch(()=>{I.setDeviceDropdownPending()}),T?.addEventListener("change",n=>{const c=n.target.value;c&&(window.speechProcessor?window.speechProcessor.selectAudioDevice(c).catch(r=>console.warn("Device select failed:",r)):F=c,window.sendAnalyticsEvent?.("device_dropdown_select",{deviceId:c}))})});function V(){const a=document.getElementById("fafSignalSliders");if(a){a.innerHTML="";for(let e=0;e<C;e++){const t=W[e]??0,i=t===0?"0 st (unshifted)":`${t>0?"+":""}${t} st`,s=document.createElement("div");s.className="faf-signal-row",s.innerHTML=`
      <label class="faf-signal-label" for="fafSignal${e}">
        Signal ${e+1}:
        <span id="fafSignalValue${e}" class="slider-value">${i}</span>
      </label>
      <input
        type="range"
        id="fafSignal${e}"
        class="faf-signal-slider"
        min="-8" max="8" step="1" value="${t}"
        aria-valuemin="-8" aria-valuemax="8"
        aria-valuenow="${t}" aria-valuetext="${i}"
        data-index="${e}"
      />
    `,a.appendChild(s),s.querySelector(".faf-signal-slider").addEventListener("input",d=>{const f=Number(d.target.dataset.index),h=Number(d.target.value);W[f]=h;const p=h===0?"0 st (unshifted)":`${h>0?"+":""}${h} st`,v=document.getElementById(`fafSignalValue${f}`);v&&(v.textContent=p),d.target.setAttribute("aria-valuenow",String(h)),d.target.setAttribute("aria-valuetext",p),S&&window.speechProcessor?.updateMultiFAFNodes(R()),window.sendAnalyticsEvent?.("adjust_multi_faf_signal",{index:f,semitones:h},{debounce:!0,debounceMs:3e3})})}}}(function(){const a=document.getElementById("statusMessage");if(!a)return;let e=a.textContent;const t=()=>{a.classList.remove("status-flash"),a.offsetWidth,a.classList.add("status-flash"),setTimeout(()=>a.classList.remove("status-flash"),1100)};new MutationObserver(()=>{const i=a.textContent;i!==e&&(e=i,t())}).observe(a,{characterData:!0,childList:!0,subtree:!0})})();

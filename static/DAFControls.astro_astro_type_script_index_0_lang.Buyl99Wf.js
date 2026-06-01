(function(){try{var n=typeof window<"u"?window:typeof global<"u"?global:typeof globalThis<"u"?globalThis:typeof self<"u"?self:{};n.SENTRY_RELEASE={id:"67981f9ed680476733fbf2be33b238e04ad755fa"};var e=new n.Error().stack;e&&(n._sentryDebugIds=n._sentryDebugIds||{},n._sentryDebugIds[e]="54ee9e47-6691-4711-98eb-8e92b3737670",n._sentryDebugIdIdentifier="sentry-dbid-54ee9e47-6691-4711-98eb-8e92b3737670")}catch{}})();function ee(n){return function(){let e=n+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function O(n,e,t){const i=t()||1e-4,s=t(),l=Math.sqrt(-2*Math.log(i))*Math.cos(2*Math.PI*s);return n+e*l}function te(n,e){if(n<30){const t=Math.exp(-n);let i=0,s=1;do i++,s*=e();while(s>t);return i-1}else{const t=O(n,Math.sqrt(n),e);return Math.max(0,Math.round(t))}}function ie(n,e,t=5){if(e<=0)return{reviews:[],meanValue:0,elementCount:0,dailyReviewCounts:[]};n=Math.max(1,Math.min(5,n));const i=ee(42),s=[],l=[];let d=0;for(let _=0;_<e;_++){const p=1.8*Math.sin(2*Math.PI*_/(e*.2))*Math.exp(-.04*_),A=n-(n-3)*Math.exp(-.02*_),a=O(0,.06,i);d+=a;const c=Math.max(1.2,Math.min(4.8,A+p+d));s.push(c);const r=(.1+2.4*Math.pow(_/e,1.5))*t;l.push(te(r,i))}const u=[],h=1.3;for(let _=0;_<e;_++){const p=l[_];if(p>0)for(let D=0;D<p;D++){const A=O(s[_],h,i),a=Math.max(1,Math.min(5,Math.round(A)));u.push([_+1,a])}}if(u.length===0)return{reviews:[],meanValue:0,elementCount:0,dailyReviewCounts:l};const v=u.reduce((_,p)=>_+p[1],0)/u.length;return{reviews:u,meanValue:v,elementCount:u.length,dailyReviewCounts:l}}const z={base:"/delayed-auditory-feedback-online/",datePublished:"2025-02-16",dateModified:new Date().toISOString().split("T")[0],lastUpdatedMonthYearFooter:new Date().toLocaleString("default",{month:"long",year:"numeric"}),currentYear:new Date().getFullYear().toString()},se=1e3*60*60*24,ne=Math.floor((new Date().getTime()-new Date(z.datePublished).getTime())/se),U=ie(4.5,ne,.5);U.meanValue.toFixed(1),U.elementCount.toString();const H="psola",Y=.6,K=256,X=Math.ceil(K/Y)+1;function ae(n){return X/n*1e3}const oe={deep:{pitchFloor:80,label:"Deep",latencyMs:25},normal:{pitchFloor:120,label:"Normal",latencyMs:16.6},high:{pitchFloor:150,label:"High-pitched",latencyMs:13.3}},re="normal";function ce(n,e){return 2*Math.floor(e/n)/e*1e3}const le=2;function V(n){return Math.pow(2,n/12)}const j=Y,de=le,ue=K,he=128,fe=X,me=8192,pe=2048,_e=8192,ge=4096,ve=1024,ye=256,we=4,Ae=.15,Se=`
(function () {
  'use strict';

  // ── Shared constants ────────────────────────────────────────────────────────
  const R_MIN = ${j};
  const R_MAX = ${de};

  // Pre-computed Hann table shared by both processors.
  const HTAB   = ${ve};
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
  // R_MIN = ${j} (safe for ±8 st slider; min reachable ratio ≈ 0.630).
  // See top-of-file NOTE for R_MIN rationale.

  const OLA_G    = ${ue};
  const OLA_H    = ${he};
  const OLA_LB   = ${fe};
  const OLA_INSZ = ${me};
  const OLA_OUTS = ${pe};
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

  const PSO_INSZ = ${_e};
  const PSO_OUTS = ${ge};
  const PSO_INM  = PSO_INSZ - 1;
  const PSO_OUTM = PSO_OUTS - 1;
  const YIN_W    = ${ye};
  const YIN_INT  = ${we};
  const YIN_THR  = ${Ae};

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
`;let T=null;async function Me(n){if(!T){const e=new Blob([Se],{type:"application/javascript"});T=URL.createObjectURL(e)}await n.audioWorklet.addModule(T)}class be{_intervalMs;_isActive;_elapsedMs;_getGraph;_getStream;_intervalId=null;constructor(e,t,i,s,l){this._intervalMs=e,this._isActive=t,this._elapsedMs=i,this._getGraph=s,this._getStream=l}start(){this._intervalId||this._isActive()&&(this._intervalId=setInterval(()=>{try{if(!this._shouldSend())return;window.sendAnalyticsEvent?.("daf_active",{event_category:"DAF",event_label:"heartbeat",daf_usage_s:Math.floor(this._elapsedMs()/1e3)})}catch(e){console.warn("Analytics heartbeat error:",e)}},this._intervalMs))}stop(){this._intervalId&&(clearInterval(this._intervalId),this._intervalId=null)}_shouldSend(){if(!this._isActive())return!1;const e=this._getGraph();if(!e||e.state!=="running")return!1;const t=this._getStream();return!t||!t.getAudioTracks?.().some(s=>s.enabled!==!1)||e.gainValue<=0?!1:typeof window.sendAnalyticsEvent=="function"}}const De=200,Fe=`
(function () {
  'use strict';

  const SAMPLES = ${De};

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
`;async function Ie(n){const e=new Blob([Fe],{type:"application/javascript"}),t=URL.createObjectURL(e);try{await n.audioWorklet.addModule(t)}finally{URL.revokeObjectURL(t)}}function Le(n){return n.reduce((e,t)=>e+t,0)/n.length}function Ee(n,e){const t=n.reduce((i,s)=>i+(s-e)**2,0)/n.length;return Math.sqrt(t)}function Ne(n){const e=[...n].sort((t,i)=>t-i);return e[Math.floor(e.length*.95)]??e[e.length-1]??0}async function xe(n,e,t){if(n.state!=="running")throw new Error(`AudioContext must be running (current state: ${n.state})`);const i=(n.baseLatency??0)*1e3,s=(n.outputLatency??0)*1e3;let l=null;try{const c=e?.getAudioTracks?.()?.[0]?.getSettings?.();c?.latency&&(l=c.latency*1e3)}catch{}const d=i+s+(l??0),u=Math.round(n.baseLatency*n.sampleRate),h=128/n.sampleRate*1e3;await Ie(n);const m=await new Promise((c,r)=>{let o=null;const f=setTimeout(()=>{try{o?.disconnect()}catch{}r(new Error("Benchmark timed out"))},5e3);try{o=new AudioWorkletNode(n,"benchmark-processor",{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]}),o.port.onmessage=g=>{clearTimeout(f);try{o.disconnect()}catch{}c(g.data.drifts)},o.onprocessorerror=g=>{clearTimeout(f),r(new Error(`Benchmark worklet error: ${g}`))},o.connect(n.destination)}catch(g){clearTimeout(f),r(g)}});if(m.length<10)throw new Error(`Too few samples collected (${m.length})`);const v=m.map(Math.abs),_=Le(m),p=Ee(m,_),D=Ne(v),A=Math.min(...m),a=Math.max(...m);return{sampleRate:n.sampleRate,baseLatencyMs:Math.round(i*10)/10,outputLatencyMs:Math.round(s*10)/10,inputLatencyMs:l!==null?Math.round(l*10)/10:null,fafLatencyMs:Math.round(t*10)/10,totalFloorMs:Math.round(d*10)/10,estimatedBufferSamples:u,quantumMs:Math.round(h*100)/100,jitter:{minDriftMs:Math.round(A*10)/10,maxDriftMs:Math.round(a*10)/10,meanDriftMs:Math.round(_*10)/10,p95DriftMs:Math.round(D*10)/10,stddevMs:Math.round(p*10)/10,samples:m.length}}}class ke{_ctx=null;_nodes={source:null,gainNode:null,delayNode:null};_fafNodes=[];_fafSumNode=null;_fafActive=!1;_workletReady=!1;_pitchFloor=oe[re].pitchFloor;_fafMode=H;measuredFloorMs=null;constructor(e){this._init(e)}get context(){return this._ctx}get state(){return this._ctx?.state??"closed"}get gainValue(){return this._nodes.gainNode?.gain.value??1}get fafLatencyMs(){return!this._fafActive||!this._ctx?0:this._fafMode==="ola"?ae(this._ctx.sampleRate):ce(this._pitchFloor,this._ctx.sampleRate)}set pitchFloor(e){this._pitchFloor=e}set fafMode(e){this._fafMode=e}connect(e,t){const i=this._ctx,s=this._nodes;s.source=i.createMediaStreamSource(e),s.gainNode=i.createGain(),s.delayNode=i.createDelay(.5);const l=1e-6;s.delayNode.delayTime.value=Math.max(l,t.delayTime/1e3),s.gainNode.gain.value=t.gain,s.source.connect(s.delayNode),s.delayNode.connect(s.gainNode),s.gainNode.connect(i.destination);const d=t.multiFAFSemitones?.length?t.multiFAFSemitones:t.pitchShift!==0?[t.pitchShift]:[];d.length>0&&this.setFAFNodes(d).catch(u=>console.warn("FAF init failed:",u))}disconnect(){this._teardownFAF();const{source:e,gainNode:t,delayNode:i}=this._nodes;[e,t,i].forEach(s=>{try{s?.disconnect()}catch{}}),this._nodes={source:null,gainNode:null,delayNode:null}}async close(){if(this.disconnect(),this._ctx&&this._ctx.state!=="closed")try{await this._ctx.close()}catch(e){console.error("Error closing AudioContext:",e)}this._ctx=null,this.measuredFloorMs=null,this._workletReady=!1}async resume(){this._ctx?.state==="suspended"&&await this._ctx.resume()}setDelayTime(e){if(!this._ctx||!this._nodes.delayNode)return;const i=e<=0?1e-6:e/1e3;this._nodes.delayNode.delayTime.setValueAtTime(i,this._ctx.currentTime)}setGain(e){!this._ctx||!this._nodes.gainNode||this._nodes.gainNode.gain.setValueAtTime(e,this._ctx.currentTime)}async setFAFSemitones(e){return this.setFAFNodes(e===0?[]:[e])}async setFAFNodes(e){if(!this._ctx||!this._nodes.source||!this._nodes.delayNode)return;const{source:t,delayNode:i}=this._nodes;if(e.length===0){if(!this._fafActive)return;this._teardownFAF();try{t.connect(i)}catch{}console.log("FAF bypassed");return}if(!this._workletReady)try{await Me(this._ctx),this._workletReady=!0}catch(d){throw console.error("PitchShifterWorklet failed to load:",d),d}if(!this._ctx||!this._nodes.source||!this._nodes.delayNode)return;if(e.length===this._fafNodes.length&&this._fafActive){for(let u=0;u<e.length;u++){const h=this._fafNodes[u].parameters.get("pitchRatio");h&&(h.value=V(e[u]))}const d=e.map(u=>`${u>0?"+":""}${u}`).join(", ");console.log(`FAF ratios updated: [${d}] st`);return}this._teardownFAF();try{this._nodes.source.disconnect(this._nodes.delayNode)}catch{}const s=e.length;this._fafSumNode=this._ctx.createGain(),this._fafSumNode.gain.value=1/s;for(const d of e){const u=this._fafMode==="ola"?"pitch-shifter-ola":"pitch-shifter-psola",h=new AudioWorkletNode(this._ctx,u,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:this._fafMode==="psola"?{pitchFloor:this._pitchFloor}:{}}),m=h.parameters.get("pitchRatio");m&&(m.value=V(d)),this._nodes.source.connect(h),h.connect(this._fafSumNode),this._fafNodes.push(h)}this._fafSumNode.connect(this._nodes.delayNode),this._fafActive=!0;const l=e.map(d=>`${d>0?"+":""}${d}`).join(", ");console.log(`FAF enabled [${s} signal${s>1?"s":""}]: [${l}] st`)}onStateChange(e){this._ctx?.addEventListener("statechange",t=>{const i=t.target.state;e(i)})}measureLatencyFloor(e){if(this._ctx)try{const t=((this._ctx.baseLatency??0)+(this._ctx.outputLatency??0))*1e3;let i=0;try{const l=e?.getAudioTracks?.()?.[0]?.getSettings?.();l?.latency&&(i=l.latency*1e3)}catch{}const s=i+t;this.measuredFloorMs=s,console.log(`Latency floor: ${t.toFixed(1)}ms (output)`+(i?` + ${i.toFixed(1)}ms (input)`:" + 0 (input unknown)")+` = ${s.toFixed(1)}ms total`),s>25&&console.warn(`Round-trip floor ${s.toFixed(1)}ms > 25ms — slap-back likely at low delay settings`)}catch{}}async benchmark(e){if(!this._ctx)throw new Error("AudioContext not initialised");return xe(this._ctx,e,this.fafLatencyMs)}_teardownFAF(){const e=this._nodes.source;for(const t of this._fafNodes){if(e)try{e.disconnect(t)}catch{}try{t.disconnect()}catch{}}if(this._fafNodes=[],this._fafSumNode){try{this._fafSumNode.disconnect()}catch{}this._fafSumNode=null}this._fafActive=!1}_init(e){const t={latencyHint:0};e&&Number.isFinite(e)&&(t.sampleRate=e);const i=window.AudioContext??window.webkitAudioContext;this._ctx=new i(t)}}class Ce{availableDevices=[];selectedDeviceId=null;micAccessGranted=!1;echoCancellation=!1;noiseSuppression=!1;_ui;_reporter;_sampleRate=null;_currentLabel="";_initialized=!1;_onDeviceChange=null;constructor(e,t){this._ui=e,this._reporter=t}async acquireStream(e=null){if(e)return this.micAccessGranted=!0,this._recordTrackMeta(e.getAudioTracks()[0]),{stream:e,sampleRate:this._sampleRate};const t={audio:{echoCancellation:this.echoCancellation,autoGainControl:!1,noiseSuppression:this.noiseSuppression,channelCount:1,...this.selectedDeviceId?{deviceId:{exact:this.selectedDeviceId}}:{}}},i=await navigator.mediaDevices.getUserMedia(t);this.micAccessGranted=!0,this._recordTrackMeta(i.getAudioTracks()[0]);try{const s=await navigator.mediaDevices.enumerateDevices();this.availableDevices=s.filter(l=>l.kind==="audioinput")}catch(s){console.warn("Could not refresh device list after mic grant:",s)}return{stream:i,sampleRate:this._sampleRate}}releaseStream(e){e&&(e.getTracks().forEach(t=>{t.stop(),t.enabled=!1}),this.micAccessGranted=!1)}async enumerate(){try{let e=null;if(!this.micAccessGranted)try{e=await navigator.mediaDevices.getUserMedia({audio:!0})}catch{}const t=await navigator.mediaDevices.enumerateDevices();return e&&e.getTracks().forEach(i=>{try{i.stop()}catch{}}),this.availableDevices=t.filter(i=>i.kind==="audioinput"),console.log("Audio inputs:",this.availableDevices),this._autoSelectHeadphone(),this._reflectSelectedDeviceInUI(),this._ui.populateDeviceDropdown(this.availableDevices,this.selectedDeviceId),this.availableDevices}catch(e){return console.error("Error enumerating audio devices:",e),this._ui.updateDeviceUI("Default microphone",!1),[]}}async selectById(e,t,i){if(!e)return!1;if(!t)return this.selectedDeviceId=e,this._ui.syncDeviceDropdown(e),!0;let s=null;try{s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:this.echoCancellation,autoGainControl:!1,noiseSuppression:this.noiseSuppression,channelCount:1,deviceId:{exact:e}}})}catch(m){const{message:v}=this._reporter.classifyMicError(m);return this._ui.updateStatus(v,"error"),this._ui.syncDeviceDropdown(this.selectedDeviceId),!1}const l=this.selectedDeviceId;if(this.selectedDeviceId=e,!await i(s))return this.selectedDeviceId=l,this._ui.syncDeviceDropdown(l),!1;const h=this.availableDevices.find(m=>m.deviceId===e)?.label??"Selected microphone";this._ui.updateDeviceUI(h,this._isHeadphoneMic(h)),this._ui.syncDeviceDropdown(e),this._ui.updateStatus(`Switched to: ${h}`,"success");try{window.sendAnalyticsEvent?.("device_switch",{to_device_name:h})}catch{}return!0}async select(e,t=null){if(!e)return!1;const i=this.selectedDeviceId;if(t){let s=null;try{s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:this.echoCancellation,autoGainControl:!1,noiseSuppression:this.noiseSuppression,channelCount:1,deviceId:{exact:e}}})}catch(d){const{message:u}=this._reporter.classifyMicError(d);return this._ui.updateStatus(u,"error"),!1}this.selectedDeviceId=e;const l=await t(s);return l||(this.selectedDeviceId=i),l}return this.selectedDeviceId=e,!0}initChangeListener(e,t){if(!this._initialized){this._onDeviceChange=async()=>{t()&&await e()};try{navigator.mediaDevices.addEventListener("devicechange",this._onDeviceChange)}catch(i){console.warn("Could not attach devicechange listener:",i),this._onDeviceChange=null}this._initialized=!0}}destroy(){try{this._onDeviceChange&&navigator.mediaDevices.removeEventListener("devicechange",this._onDeviceChange)}catch{}this._initialized=!1,this._onDeviceChange=null,this.availableDevices=[],this.selectedDeviceId=null,this.micAccessGranted=!1}_recordTrackMeta(e){if(!e)return;const t=e.getSettings?.()??{};this._sampleRate=t.sampleRate??null,t.deviceId&&(this.selectedDeviceId=t.deviceId);const i=e.label||"";this._currentLabel=i||"Default microphone";const s=this._isHeadphoneMic(i);this._ui.updateDeviceUI(this._currentLabel,s),this._reporter.micAcquired(t,i),console.log("Selected microphone settings:",t)}_autoSelectHeadphone(){const e=this.availableDevices.find(t=>{const i=(t.label||"").toLowerCase();return i.includes("bluetooth")||i.includes("airpod")?!1:i.includes("headphone")||i.includes("headset")||i.includes("earphone")});e&&this.selectedDeviceId!==e.deviceId&&(this.selectedDeviceId=e.deviceId,console.log("Auto-selected headphone mic:",e.label),this._ui.updateDeviceUI(e.label,!0))}_reflectSelectedDeviceInUI(){if(this.selectedDeviceId){const t=this.availableDevices.find(i=>i.deviceId===this.selectedDeviceId);if(t){this._ui.updateDeviceUI(t.label,this._isHeadphoneMic(t.label)),this._ui.syncDeviceDropdown(t.deviceId);return}}const e=this.availableDevices.find(t=>t.deviceId==="default"||t.deviceId==="")??this.availableDevices[0];e?(this._ui.updateDeviceUI(e.label,this._isHeadphoneMic(e.label)),this._ui.syncDeviceDropdown(e.deviceId)):this._ui.updateDeviceUI("Default microphone",!1)}_isHeadphoneMic(e){if(!e)return!1;const t=e.toLowerCase();return t.includes("bluetooth")||t.includes("airpod")?!1:t.includes("headphone")||t.includes("headset")||t.includes("earphone")}}class Re{classifyMicError(e){const t=e,i=t?.name??"",s=(t?.message??"").toLowerCase();return i==="NotAllowedError"&&s.includes("system")?{tag:"permission_denied_system",message:"Your operating system is blocking microphone access. Please check your system privacy settings (macOS: System Settings → Privacy & Security → Microphone; Windows: Settings → Privacy → Microphone) and allow access, then try again."}:i==="NotAllowedError"&&s.includes("avaudiosession")?{tag:"permission_denied_ios_no_device",message:"No microphone was found on your device. Please plug in a headset or enable microphone access in Settings → Safari → Microphone, then try again."}:i==="NotAllowedError"&&s.includes("dismiss")?{tag:"permission_dismissed",message:'Microphone access was dismissed. Please tap "Start DAF" again and click "Allow" when prompted.'}:i==="NotAllowedError"||i==="PermissionDeniedError"||s.includes("not allowed")||s.includes("denied")?{tag:"permission_denied_user",message:`Microphone access was denied. Please click the 🔒 / 🎙️ icon in your browser's address bar, set Microphone to "Allow", refresh the page, and try again.`}:i==="NotFoundError"||s.includes("not found")||s.includes("device")?{tag:"device_not_found",message:"The selected microphone could not be found. It may have been unplugged. Please check your microphone connection and try again."}:{tag:"unknown",message:"Could not access your microphone. Please make sure a microphone is connected and this page has permission to use it, then try again."}}audioInitFailed(e,{deviceId:t=null,micErrorTag:i="unknown",audioContextState:s="not_initialized",availableDeviceCount:l=0,hasUserMedia:d=!!navigator.mediaDevices?.getUserMedia,secureContext:u=window.isSecureContext,preAcquired:h=!1}={}){this._capture(m=>m.captureException(e,{tags:{mechanism:"audio_init",mic_error_type:i,secure_context:u},extra:{requestedDeviceId:t,audioContextState:s,availableDeviceCount:l,hasUserMedia:d,preAcquired:h}}))}audioResumedAfterRetries(e){e<=1||this._capture(t=>t.captureMessage("Audio resumed after multiple attempts",{level:"warning",extra:{attempts:e}}))}micAcquired(e,t){const i={autoGainControl:e.autoGainControl,echoCancellation:e.echoCancellation,noiseSuppression:e.noiseSuppression,sampleRate:e.sampleRate,label:t||"Unknown"};this._capture(s=>{typeof s.setContext=="function"?s.setContext("mic_settings",i):typeof s.configureScope=="function"&&s.configureScope(l=>l.setContext("mic_settings",i))})}visibilityChanged(e){this._capture(t=>t.addBreadcrumb({category:"ui.lifecycle",message:`Visibility changed to ${e}`,level:"info"}))}_capture(e){if(window.Sentry)try{e(window.Sentry)}catch(t){console.warn("ErrorReporter: Sentry call failed",t)}}}class Pe{_intervalId=null;_startTime=0;elapsedMs=0;start(){const e=document.getElementById("dafTimer");e&&(this._startTime=performance.now(),this.elapsedMs=0,e.textContent="00:00",e.classList.add("timer-running"),this._tick(e))}resume(){const e=document.getElementById("dafTimer");!e||this._intervalId||(this._startTime=performance.now()-this.elapsedMs,e.classList.add("timer-running"),this._tick(e))}pause(){this._intervalId&&(clearInterval(this._intervalId),this._intervalId=null)}stop(){this.pause(),this.elapsedMs=0;const e=document.getElementById("dafTimer");e&&(e.textContent="00:00",e.classList.remove("timer-running"))}_tick(e){this._intervalId=setInterval(()=>{this.elapsedMs=performance.now()-this._startTime;const t=Math.floor(this.elapsedMs/1e3),i=String(Math.floor(t/60)).padStart(2,"0"),s=String(t%60).padStart(2,"0");e.textContent=`${i}:${s}`},1e3)}}const Te={success:"status-success",error:"status-error",loading:"status-loading",warning:"status-warning",info:"status-info"};class ${updateStatus(e,t="info"){const i=document.getElementById("statusMessage");i&&(i.textContent=e,i.classList.remove("status-success","status-error","status-warning","status-info","status-default","status-loading"),i.classList.add(Te[t]??"status-default"))}updateDisplay(e,t){const i=document.getElementById(e);i&&(i.textContent=t)}updateControls(e){const t=document.getElementById("dafButton");t&&(t.textContent=e?"Stop DAF":"Start DAF",t.setAttribute("aria-pressed",String(e)))}updateDeviceUI(e,t){const i=document.getElementById("deviceIcon");i&&(i.textContent=t?"🎧":"🎙️")}populateDeviceDropdown(e,t){const i=document.getElementById("deviceSelect");if(i){if(i.innerHTML="",e.length===0){const s=document.createElement("option");s.value="",s.textContent="No microphones found",i.appendChild(s),i.disabled=!0;return}i.disabled=!1,e.forEach((s,l)=>{const d=document.createElement("option");d.value=s.deviceId,d.textContent=s.label||`Microphone ${l+1}`,s.deviceId===t&&(d.selected=!0),i.appendChild(d)}),!i.value&&e.length>0&&(i.options[0].selected=!0)}}setDeviceDropdownPending(){const e=document.getElementById("deviceSelect");if(!e)return;e.innerHTML="";const t=document.createElement("option");t.value="",t.textContent="Start DAF to see available microphones",e.appendChild(t),e.disabled=!0}syncDeviceDropdown(e){if(!e)return;const t=document.getElementById("deviceSelect");t&&(t.value=e,!t.value&&t.options.length>0&&(t.options[0].selected=!0))}}class Be{config={delayTime:200,gain:1,pitchShift:0,multiFAFSemitones:[],pitchFloor:120,fafMode:H};_ui;_reporter;_devices;_timer;_heartbeat;_graph=null;_stream=null;_resumeAttempts=0;_maxResumeAttempts=5;_isAppVisible=document.visibilityState==="visible";_onVisibilityChange;_onFreeze;_onResume;_onDocClick;constructor(){this._ui=new $,this._reporter=new Re,this._devices=new Ce(this._ui,this._reporter),this._timer=new Pe,this._heartbeat=new be(6e4,()=>this.isRunning,()=>this._timer.elapsedMs,()=>this._graph,()=>this._stream),this._onVisibilityChange=this._handleVisibilityChange.bind(this),this._onFreeze=this._handleFreeze.bind(this),this._onResume=this._handleResume.bind(this),this._onDocClick=this._handleDocClick.bind(this),document.addEventListener("visibilitychange",this._onVisibilityChange),"onfreeze"in document&&document.addEventListener("freeze",this._onFreeze),"onresume"in document&&document.addEventListener("resume",this._onResume),document.addEventListener("click",this._onDocClick),this._ui.updateDeviceUI('Click "Start DAF" to select your microphone',!1)}get isRunning(){return!!this._graph&&this._graph.state==="running"}get measuredFloorMs(){return this._graph?.measuredFloorMs??null}get fafLatencyMs(){return this._graph?.fafLatencyMs??0}async start(e=null){this._ui.updateStatus("Starting audio connection…","loading");try{const{stream:t,sampleRate:i}=await this._devices.acquireStream(e);this._stream=t,this._graph=new ke(i),this._graph.pitchFloor=this.config.pitchFloor,this._graph.fafMode=this.config.fafMode,this._graph.onStateChange(s=>this._onGraphStateChange(s)),this._graph.connect(t,this.config),this._graph.state==="running"&&(this._graph.measureLatencyFloor(this._stream),this._refreshDelayDisplay(),setTimeout(()=>{this.isRunning&&this._graph&&(this._graph.measureLatencyFloor(this._stream),this._refreshDelayDisplay())},200)),this._ui.updateControls(!0),this._ui.updateStatus("Auditory Feedback Active","success"),this._timer.elapsedMs>0?this._timer.resume():this._timer.start(),this._heartbeat.start(),await this._devices.enumerate(),this._devices.initChangeListener(()=>this._devices.enumerate(),()=>this.isRunning)}catch(t){throw this._handleStartError(t),t}}async stop({preserveTimer:e=!1}={}){this._heartbeat.stop(),e?this._timer.pause():this._timer.stop(),this._devices.releaseStream(this._stream),this._stream=null,await this._graph?.close(),this._graph=null,this._resumeAttempts=0,this._ui.updateStatus("Auditory Feedback Stopped","info"),this._ui.updateControls(!1),this._ui.updateDeviceUI('Click "Start DAF" to select your microphone',!1)}async restartWithNewDevice(e=null){const t={...this.config,multiFAFSemitones:[...this.config.multiFAFSemitones]};return await this.stop({preserveTimer:!0}),await new Promise(i=>setTimeout(i,300)),this.config=t,await this.start(e),!0}updateDelayTime(e){this.config.delayTime=e,this._graph?.setDelayTime(e),this._refreshDelayDisplay()}updateGain(e){this.config.gain=e,this._graph?.setGain(e),this._ui.updateDisplay("inputGainValue",`${e}x`)}updateInputGain(e){this.updateGain(e)}updatePitchShift(e){this.config.pitchShift=e,this._refreshDelayDisplay(),this._graph?.setFAFSemitones(e).then(()=>this._refreshDelayDisplay()).catch(t=>console.warn("FAF update failed:",t))}updateMultiFAFNodes(e){this.config.multiFAFSemitones=e,this._refreshDelayDisplay(),this._graph?.setFAFNodes(e).then(()=>this._refreshDelayDisplay()).catch(t=>console.warn("Multi-FAF update failed:",t))}setPreferredDevice(e){this._devices.selectedDeviceId=e}updateVoiceProfile(e){if(this.config.pitchFloor=e,this._graph){this._graph.pitchFloor=e;const t=this.config.multiFAFSemitones.length?this.config.multiFAFSemitones:this.config.pitchShift!==0?[this.config.pitchShift]:[];t.length>0&&this._graph.setFAFNodes([]).then(()=>this._graph?.setFAFNodes(t)).then(()=>this._refreshDelayDisplay()).catch(i=>console.warn("Voice profile FAF rebuild failed:",i)),this._refreshDelayDisplay()}}updateFAFMode(e){if(this.config.fafMode=e,this._graph){this._graph.fafMode=e;const t=this.config.multiFAFSemitones.length?this.config.multiFAFSemitones:this.config.pitchShift!==0?[this.config.pitchShift]:[];t.length>0&&this._graph.setFAFNodes([]).then(()=>this._graph?.setFAFNodes(t)).then(()=>this._refreshDelayDisplay()).catch(i=>console.warn("FAF mode switch failed:",i)),this._refreshDelayDisplay()}}seedAudioConstraints(e,t){this._devices.echoCancellation=e,this._devices.noiseSuppression=t}async updateAudioConstraints(e,t){this._devices.echoCancellation=e,this._devices.noiseSuppression=t,this.isRunning&&await this.restartWithNewDevice(null)}async selectAudioDevice(e){await this._devices.selectById(e,this.isRunning,t=>this.restartWithNewDevice(t))}async runBenchmark(){if(!this._graph)throw new Error("DAF is not running");return this._graph.benchmark(this._stream)}async destroy(){await this.stop(),this._devices.destroy(),document.removeEventListener("visibilitychange",this._onVisibilityChange),document.removeEventListener("freeze",this._onFreeze),document.removeEventListener("resume",this._onResume),document.removeEventListener("click",this._onDocClick),console.log("SpeechProcessor destroyed")}async attemptResumeAudio(){if(!(!this._graph||this._graph.state!=="suspended")&&!(this._resumeAttempts>=this._maxResumeAttempts)){this._resumeAttempts++;try{await this._graph.resume(),this._resumeAttempts=0}catch{if(this._resumeAttempts>1&&this._reporter.audioResumedAfterRetries(this._resumeAttempts),this._resumeAttempts<this._maxResumeAttempts){const e=Math.pow(2,this._resumeAttempts)*100;setTimeout(()=>this.attemptResumeAudio(),e)}else this._ui.updateStatus("Audio paused — tap to resume","error"),this._heartbeat.stop()}}}_onGraphStateChange(e){this._notifyServiceWorker("AUDIO_STATE",{state:e}),e==="running"&&this._graph&&(this._graph.measureLatencyFloor(this._stream),this._refreshDelayDisplay()),e==="suspended"&&this._isAppVisible&&this._graph&&this.attemptResumeAudio()}_handleVisibilityChange(){this._isAppVisible=document.visibilityState==="visible",this._reporter.visibilityChanged(document.visibilityState),this._notifyServiceWorker("VISIBILITY_CHANGE",{isVisible:this._isAppVisible}),this._isAppVisible&&this._graph?.state==="suspended"&&this.attemptResumeAudio()}_handleFreeze(){}_handleResume(){this._graph?.state==="suspended"&&this.attemptResumeAudio()}_handleDocClick(){this._graph?.state==="suspended"&&this.attemptResumeAudio()}_notifyServiceWorker(e,t){"serviceWorker"in navigator&&navigator.serviceWorker.controller&&navigator.serviceWorker.controller.postMessage({type:e,...t})}_refreshDelayDisplay(){const e=this.config.delayTime,t=this.measuredFloorMs??0,i=this.fafLatencyMs,s=t+i,l=s>5?`${e} ms (~${Math.round(e+s)} ms effective)`:`${e} ms`;this._ui.updateDisplay("delayValue",l)}_handleStartError(e){this._heartbeat.stop(),this._timer.stop();const t=this._reporter.classifyMicError(e);this._reporter.audioInitFailed(e,{deviceId:this._devices.selectedDeviceId,micErrorTag:t.tag,audioContextState:this._graph?.context?.state??"not_initialized",availableDeviceCount:this._devices.availableDevices.length,hasUserMedia:!!navigator.mediaDevices?.getUserMedia,secureContext:window.isSecureContext,preAcquired:!1}),window.sendAnalyticsEvent?.("daf_initialization_error",{event_category:"DAF",event_label:t.tag,error_message:e?.message??""}),this._ui.updateStatus(t.message,"error")}}"serviceWorker"in navigator&&window.addEventListener("load",()=>{navigator.serviceWorker.register(`${z.base}service-worker.js`).then(n=>console.log("Service Worker registered:",n.scope)).catch(n=>console.warn("Service Worker registration failed:",n))});let I=null;async function Z(){try{"wakeLock"in navigator&&(I=await navigator.wakeLock.request("screen"),I.addEventListener("release",()=>{I=null}))}catch(n){console.error("Wake Lock request failed:",n.message)}}function J(){I?.release().then(()=>{I=null}).catch(console.error)}let L=null,E=!1,N=!1,W=120,C=H,b="semitones",B=800;function k(n,e){if(n===0)return"Off";const t=Math.abs(n),i=n>0?"+":"-";return e==="semitones"?`${i}${t} ${t===1?"semitone":"semitones"}`:`${i}${t} ${t===1?"cent":"cents"}`}function x(n,e){return e==="cents"?n/100:n}let F=!1,R=2;const G=[4,-4,0,2];function P(){return G.slice(0,R)}document.addEventListener("visibilitychange",()=>{const n=document.visibilityState==="visible";window.sendAnalyticsEvent?.("page_visibility",{visibility:n?"visible":"hidden"}),n&&window.speechProcessor&&(window.speechProcessor.attemptResumeAudio(),I||Z())});window.addEventListener("beforeunload",()=>{window.speechProcessor?.stop(),J(),window.sendAnalyticsEvent?.("session_end")});window.toggleDAF=async function(){const n=!window.speechProcessor?.isRunning;if(window.sendAnalyticsEvent?.(n?"start_daf":"stop_daf",{event_category:"user_action",event_label:n?"DAF Started":"DAF Stopped"}),n){window.speechProcessor=new Be;const e=document.getElementById("delaySlider"),t=document.getElementById("inputGainSlider"),i=document.getElementById("pitchShiftSlider");window.speechProcessor.config.delayTime=Number(e?.value??200),window.speechProcessor.config.gain=Number(t?.value??1),F?(window.speechProcessor.config.multiFAFSemitones=P(),window.speechProcessor.config.pitchShift=0):(window.speechProcessor.config.multiFAFSemitones=[],window.speechProcessor.config.pitchShift=x(Number(i?.value??0),b)),L&&(window.speechProcessor.setPreferredDevice(L),L=null),window.speechProcessor.seedAudioConstraints(E,N),window.speechProcessor.config.pitchFloor=W,window.speechProcessor.config.fafMode=C,Z();try{await window.speechProcessor.start()}catch{}}else await window.speechProcessor?.stop(),window.speechProcessor=void 0,J()};document.addEventListener("DOMContentLoaded",()=>{const n=document.getElementById("statusMessage"),e=document.getElementById("delaySlider"),t=document.getElementById("inputGainSlider"),i=document.getElementById("pitchShiftSlider");if(n?.classList.add("status-default"),e){const a=document.getElementById("delayValue");a&&(a.textContent=`${e.value} ms`)}if(t){const a=document.getElementById("inputGainValue");a&&(a.textContent=`${t.value}x`)}if(i){const a=document.getElementById("pitchShiftValue");a&&(a.textContent=k(Number(i.value),b))}e?.addEventListener("input",a=>{const c=Number(a.target.value),r=a.target;r.setAttribute("aria-valuenow",String(c)),r.setAttribute("aria-valuetext",`${c} milliseconds`);const o=document.getElementById("delayValue");o&&(o.textContent=`${c} ms`),window.speechProcessor?.updateDelayTime(c),window.sendAnalyticsEvent?.("adjust_delay",{current_delay_ms:c},{debounce:!0,debounceMs:5e3})}),t?.addEventListener("input",a=>{const c=Number(a.target.value);a.target.setAttribute("aria-valuenow",String(c)),a.target.setAttribute("aria-valuetext",`${c}x`);const r=document.getElementById("inputGainValue");r&&(r.textContent=`${c}x`),window.speechProcessor?.updateGain(c),window.sendAnalyticsEvent?.("adjust_input_gain",{current_input_gain:c},{debounce:!0,debounceMs:5e3})}),i?.addEventListener("input",a=>{const c=Number(a.target.value),r=k(c,b),o=x(c,b),f=document.getElementById("pitchShiftValue");f&&(f.textContent=r),a.target.setAttribute("aria-valuenow",String(c)),a.target.setAttribute("aria-valuetext",r),window.speechProcessor?.updatePitchShift(o),window.sendAnalyticsEvent?.("adjust_pitch_shift",{semitones:o},{debounce:!0,debounceMs:5e3})});function s(a,c){document.querySelectorAll(`.mode-btn[data-group="${a}"]`).forEach(r=>{const o=r.dataset.value===c;r.classList.toggle("mode-btn--active",o),r.setAttribute("aria-pressed",String(o))})}s("faf-type","single"),document.querySelectorAll(".mode-btn[data-group]").forEach(a=>{a.addEventListener("click",()=>{const c=a.dataset.group,r=a.dataset.value;switch(c){case"faf-type":{const o=document.getElementById("singleFAFSection"),f=o&&!o.hidden;if(r===(F?"multi":f?"single":"off"))return;s("faf-type",r);const y=document.getElementById("multiFAFSection"),S=document.getElementById("pitchUnitSection"),M=document.getElementById("offFAFSection");if(r==="off")F=!1,M&&(M.hidden=!1),o&&(o.hidden=!0),y&&(y.hidden=!0),S&&(S.hidden=!0),i&&(i.value="0"),window.speechProcessor?.updateMultiFAFNodes([]),window.speechProcessor?.updatePitchShift(0);else if(r==="single"){F=!1,M&&(M.hidden=!0),o&&(o.hidden=!1),y&&(y.hidden=!0),S&&(S.hidden=!1),window.speechProcessor?.updateMultiFAFNodes([]);const w=Number(i?.value??0);window.speechProcessor?.updatePitchShift(x(w,b))}else F=!0,M&&(M.hidden=!0),o&&(o.hidden=!0),y&&(y.hidden=!1),S&&(S.hidden=!0),window.speechProcessor?.updateMultiFAFNodes(P());window.sendAnalyticsEvent?.("faf_type_change",{value:r});break}case"faf-count":{const o=Number(r);if(!o||o===R)return;R=o,s("faf-count",r),q(),F&&window.speechProcessor?.updateMultiFAFNodes(P()),window.sendAnalyticsEvent?.("multi_faf_count_change",{count:o});break}case"pitch-unit":{const o=r;if(o===b)return;const f=i?x(Number(i.value),b):0;b=o,s("pitch-unit",r);const g=document.getElementById("centsRangeSelector");if(g&&(g.hidden=o==="semitones"),document.querySelectorAll('.mode-btn[data-group="cents-range"]').forEach(y=>{y.disabled=o==="semitones"}),i){if(o==="semitones"){const w=Math.round(Math.max(-8,Math.min(8,f)));i.min="-8",i.max="8",i.step="1",i.value=String(w),i.setAttribute("aria-valuemin","-8"),i.setAttribute("aria-valuemax","8")}else{const w=B,Q=Math.round(Math.max(-w,Math.min(w,f*100)));i.min=String(-w),i.max=String(w),i.step="1",i.value=String(Q),i.setAttribute("aria-valuemin",String(-w)),i.setAttribute("aria-valuemax",String(w))}const y=Number(i.value),S=k(y,o),M=document.getElementById("pitchShiftValue");M&&(M.textContent=S),i.setAttribute("aria-valuenow",String(y)),i.setAttribute("aria-valuetext",S),window.speechProcessor?.updatePitchShift(x(y,o))}break}case"cents-range":{const o=Number(r);if(!o||o===B||b!=="cents")return;if(B=o,s("cents-range",r),i){const f=Math.max(-o,Math.min(o,Number(i.value)));i.min=String(-o),i.max=String(o),i.value=String(f),i.setAttribute("aria-valuemin",String(-o)),i.setAttribute("aria-valuemax",String(o));const g=k(f,"cents"),y=document.getElementById("pitchShiftValue");y&&(y.textContent=g),i.setAttribute("aria-valuenow",String(f)),i.setAttribute("aria-valuetext",g),window.speechProcessor?.updatePitchShift(f/100)}break}case"faf-mode":{const o=r;if(o===C)return;C=o,s("faf-mode",r),h(o),window.speechProcessor?.updateFAFMode(o),window.sendAnalyticsEvent?.("faf_mode_change",{mode:o});break}case"voice-type":{const o=Number(r);if(!o||o===W)return;W=o,s("voice-type",r),window.speechProcessor?.updateVoiceProfile(o),window.sendAnalyticsEvent?.("voice_profile_change",{pitchFloor:o});break}case"bench-mode":{const o=document.getElementById("benchmarkContainer");if(!o)return;s("bench-mode",r),o.className=o.className.replace(/\bbench-mode--\w+/g,"").trim()+` bench-mode--${r}`;break}}})});const l=document.getElementById("advancedToggle"),d=document.getElementById("advancedPanel");l?.addEventListener("click",()=>{const a=l.getAttribute("aria-checked")==="true";l.setAttribute("aria-checked",String(!a)),l.classList.toggle("toggle-switch--on",!a),d&&(d.hidden=a)});const u=(a,c,r,o)=>{const f=document.getElementById(a);f&&f.addEventListener("click",()=>{const g=!c();r(g),f.setAttribute("aria-checked",String(g)),f.classList.toggle("toggle-switch--on",g),o(g)})};u("echoCancelToggle",()=>E,a=>{E=a},()=>window.speechProcessor?.updateAudioConstraints(E,N).catch(a=>console.warn("Constraint update failed:",a))),u("noiseSuppressToggle",()=>N,a=>{N=a},()=>window.speechProcessor?.updateAudioConstraints(E,N).catch(a=>console.warn("Constraint update failed:",a)));const h=a=>{document.querySelectorAll('.mode-btn[data-group="voice-type"]').forEach(c=>{c.disabled=a==="ola",c.title=a==="ola"?"Voice type only applies in High-Fidelity mode":""}),a==="ola"?document.querySelectorAll('.mode-btn[data-group="voice-type"]').forEach(c=>{c.addEventListener("click",m,{capture:!0})}):document.querySelectorAll('.mode-btn[data-group="voice-type"]').forEach(c=>{c.removeEventListener("click",m,{capture:!0})})};function m(){const a=document.querySelector('.mode-btn[data-group="faf-mode"][data-value="psola"]');a&&(a.classList.remove("mode-btn--glow"),a.offsetWidth,a.classList.add("mode-btn--glow"),a.addEventListener("animationend",()=>a.classList.remove("mode-btn--glow"),{once:!0}))}h(C),q();const v=document.getElementById("benchmarkBtn"),_=document.getElementById("benchmarkContainer");function p(a,c){const r=_?.querySelector(`[data-bench="${a}"]`);r&&(r.textContent=c)}v?.addEventListener("click",async()=>{if(!window.speechProcessor?.isRunning){if(!document.getElementById("benchmarkInactiveMsg")){const c=document.createElement("p");c.id="benchmarkInactiveMsg",c.className="bench-inactive-msg",c.innerHTML='Measures active session. <a href="#dafButton" class="bench-inactive-link" id="benchmarkStartLink">Start auditory feedback</a> first.',v.insertAdjacentElement("afterend",c),document.getElementById("benchmarkStartLink")?.addEventListener("click",o=>{o.preventDefault();const f=document.getElementById("dafButton");f&&(f.scrollIntoView({behavior:"smooth",block:"center"}),f.focus(),f.classList.add("btn--highlight"),setTimeout(()=>f.classList.remove("btn--highlight"),1800))});const r=new MutationObserver(()=>{window.speechProcessor?.isRunning&&(c.remove(),r.disconnect())});r.observe(document.getElementById("statusMessage")??document.body,{childList:!0,subtree:!0,characterData:!0})}return}v.disabled=!0,v.textContent="Running…";try{const a=await window.speechProcessor.runBenchmark(),c=a.jitter.stddevMs<.5?"✅ Excellent":a.jitter.stddevMs<1.5?"🟡 Good":a.jitter.stddevMs<3?"🟠 Moderate":"🔴 High";p("sampleRate",a.sampleRate.toLocaleString()+" Hz"),p("estimatedBuffer",a.estimatedBufferSamples+" samples"),p("baseLatency",a.baseLatencyMs>0?a.baseLatencyMs+" ms":"0 ms (not reported by this browser)"),p("outputLatency",a.outputLatencyMs+" ms"),p("inputLatency",a.inputLatencyMs!==null?a.inputLatencyMs+" ms":"n/a"),p("fafLatency",a.fafLatencyMs>0?a.fafLatencyMs+" ms":"off"),p("totalFloor",a.totalFloorMs+" ms"),p("quantumMs",a.quantumMs+" ms"),p("jitterSamples",String(a.jitter.samples)),p("minDrift",a.jitter.minDriftMs+" ms"),p("maxDrift",a.jitter.maxDriftMs+" ms"),p("meanDrift",a.jitter.meanDriftMs+" ms"),p("p95Drift",a.jitter.p95DriftMs+" ms"),p("jitterStddev",a.jitter.stddevMs+" ms — "),p("jitterRating",c);const r=document.getElementById("jitterHighWarn");r&&(r.hidden=a.jitter.stddevMs<3),_&&(_.hidden=!1),window.sendAnalyticsEvent?.("benchmark_run",{total_floor_ms:a.totalFloorMs,jitter_stddev_ms:a.jitter.stddevMs,sample_rate:a.sampleRate})}catch(a){new $().updateStatus(`Benchmark failed: ${a.message}`,"error")}finally{v.disabled=!1,v.textContent="Run Benchmark"}}),document.getElementById("dafButton")?.addEventListener("click",()=>window.toggleDAF()),n?.addEventListener("click",()=>{window.speechProcessor&&(window.speechProcessor.attemptResumeAudio(),window.sendAnalyticsEvent?.("resume_audio_attempt"))});const D=document.getElementById("deviceSelect"),A=new $;navigator.mediaDevices?.enumerateDevices().then(a=>{const c=a.filter(r=>r.kind==="audioinput");if(c.some(r=>r.label)){const r=c[0]?.deviceId??null;A.populateDeviceDropdown(c,r),r&&!L&&(L=r)}else A.setDeviceDropdownPending()}).catch(()=>{A.setDeviceDropdownPending()}),D?.addEventListener("change",a=>{const c=a.target.value;c&&(window.speechProcessor?window.speechProcessor.selectAudioDevice(c).catch(r=>console.warn("Device select failed:",r)):L=c,window.sendAnalyticsEvent?.("device_dropdown_select",{deviceId:c}))})});function q(){const n=document.getElementById("fafSignalSliders");if(n){n.innerHTML="";for(let e=0;e<R;e++){const t=G[e]??0,i=t===0?"0 st (unshifted)":`${t>0?"+":""}${t} st`,s=document.createElement("div");s.className="faf-signal-row",s.innerHTML=`
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
    `,n.appendChild(s),s.querySelector(".faf-signal-slider").addEventListener("input",d=>{const u=Number(d.target.dataset.index),h=Number(d.target.value);G[u]=h;const m=h===0?"0 st (unshifted)":`${h>0?"+":""}${h} st`,v=document.getElementById(`fafSignalValue${u}`);v&&(v.textContent=m),d.target.setAttribute("aria-valuenow",String(h)),d.target.setAttribute("aria-valuetext",m),F&&window.speechProcessor?.updateMultiFAFNodes(P()),window.sendAnalyticsEvent?.("adjust_multi_faf_signal",{index:u,semitones:h},{debounce:!0,debounceMs:3e3})})}}}(function(){const n=document.getElementById("statusMessage");if(!n)return;let e=n.textContent;const t=()=>{n.classList.remove("status-flash"),n.offsetWidth,n.classList.add("status-flash"),setTimeout(()=>n.classList.remove("status-flash"),1100)};new MutationObserver(()=>{const i=n.textContent;i!==e&&(e=i,t())}).observe(n,{characterData:!0,childList:!0,subtree:!0})})();

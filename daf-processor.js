// Speech Processing and Delayed Auditory Feedback (DAF) Module
class SpeechProcessor {
    constructor() {
        // Core audio processing components
        this.audioContext = null;
        this.audioStream = null;
        this.audioNodes = {
            source: null,
            inputGain: null,
            delayNode: null,
            outputGain: null,
            noiseGate: null,
            lowpassFilter: null,
            highpassFilter: null,
            compressor: null,
            pitchShifter: null
        };

        // Speech processing configuration
        this.config = {
            delayTime: 50,        // ms, optimal for speech DAF
            inputGain: 1,         // default gain
            noiseReduction: 50,   // percentage
            pitchShift: 0,        // semitones
            speechFrequencyMin: 85,   // Hz, lower speech frequency bound
            speechFrequencyMax: 3400  // Hz, upper speech frequency bound
        };
    }

    async initializeAudio() {
        const constraints = {
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                channelCount: 1
            }
        };

        try {
            // Request microphone access
            this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Create audio context with low latency
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'interactive'
            });

            // Initialize audio processing nodes
            this._createAudioNodes();
            this._configureAudioNodes();
            this._connectAudioNodes();

            return true;
        } catch (error) {
            console.error('Speech Processor Initialization Error:', error);
            this._updateStatus(`Error: ${error.message}`, 'error');
            return false;
        }
    }

    _createAudioNodes() {
        const ctx = this.audioContext;
        const nodes = this.audioNodes;

        nodes.source = ctx.createMediaStreamSource(this.audioStream);
        nodes.inputGain = ctx.createGain();
        nodes.delayNode = ctx.createDelay(1);
        nodes.outputGain = ctx.createGain();
        
        // Advanced noise reduction
        nodes.noiseGate = ctx.createDynamicsCompressor();
        nodes.lowpassFilter = ctx.createBiquadFilter();
        nodes.highpassFilter = ctx.createBiquadFilter();
        nodes.compressor = ctx.createDynamicsCompressor();
    }

    _configureAudioNodes() {
        const nodes = this.audioNodes;
        const cfg = this.config;
        const ctx = this.audioContext;

        // High-pass filter for speech low-frequency range
        nodes.highpassFilter.type = 'highpass';
        nodes.highpassFilter.frequency.setValueAtTime(cfg.speechFrequencyMin, ctx.currentTime);
        
        // Low-pass filter for speech high-frequency range
        nodes.lowpassFilter.type = 'lowpass';
        nodes.lowpassFilter.frequency.setValueAtTime(cfg.speechFrequencyMax, ctx.currentTime);
        
        // Noise gate configuration
        nodes.noiseGate.threshold.setValueAtTime(-40, ctx.currentTime);
        nodes.noiseGate.knee.setValueAtTime(20, ctx.currentTime);
        nodes.noiseGate.ratio.setValueAtTime(10, ctx.currentTime);
        
        // Compressor for speech clarity
        nodes.compressor.threshold.setValueAtTime(-18, ctx.currentTime);
        nodes.compressor.knee.setValueAtTime(15, ctx.currentTime);
        nodes.compressor.ratio.setValueAtTime(8, ctx.currentTime);
        
        // Initial gain and delay settings
        nodes.inputGain.gain.setValueAtTime(cfg.inputGain, ctx.currentTime);
        nodes.delayNode.delayTime.setValueAtTime(cfg.delayTime / 1000, ctx.currentTime);
    }

    _connectAudioNodes() {
        const nodes = this.audioNodes;

        // Optimized audio routing with noise reduction
        nodes.source.connect(nodes.inputGain);
        nodes.inputGain.connect(nodes.highpassFilter);
        nodes.highpassFilter.connect(nodes.lowpassFilter);
        nodes.lowpassFilter.connect(nodes.noiseGate);
        nodes.noiseGate.connect(nodes.compressor);
        nodes.compressor.connect(nodes.delayNode);
        nodes.delayNode.connect(nodes.outputGain);
        nodes.outputGain.connect(this.audioContext.destination);
    }

    start() {
        this.initializeAudio()
            .then(success => {
                if (success) {
                    this._updateStatus('Speech Processing Active', 'success');
                    this._updateUIControls(true);
                }
            });
    }

    stop() {
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext) {
            try {
                // Disconnect all nodes
                Object.values(this.audioNodes).forEach(node => {
                    if (node && typeof node.disconnect === 'function') {
                        node.disconnect();
                    }
                });

                this.audioContext.close();
            } catch (error) {
                console.error('Shutdown Error:', error);
            }

            // Reset audio context and nodes
            this.audioContext = null;
            Object.keys(this.audioNodes).forEach(key => {
                this.audioNodes[key] = null;
            });
        }

        this._updateStatus('Speech Processing Stopped', 'warning');
        this._updateUIControls(false);
    }

    updateDelayTime(value) {
        this.config.delayTime = value;
        if (this.audioNodes.delayNode && this.audioContext) {
            this.audioNodes.delayNode.delayTime.setValueAtTime(
                value / 1000, 
                this.audioContext.currentTime
            );
        }
        this._updateUIDisplay('delayValue', `${value} ms`);
    }

    updateInputGain(value) {
        this.config.inputGain = value;
        if (this.audioNodes.inputGain && this.audioContext) {
            this.audioNodes.inputGain.gain.setValueAtTime(
                value, 
                this.audioContext.currentTime
            );
        }
        this._updateUIDisplay('inputGainValue', `${value}x`);
    }

    updateNoiseReduction(value) {
        this.config.noiseReduction = value;
        const percentage = Math.round(value);
        
        if (this.audioNodes.lowpassFilter && 
            this.audioNodes.highpassFilter && 
            this.audioNodes.noiseGate) {
            
            const frequencyValue = value === 0 ? 20000 : 3000 / (value / 100);
            const thresholdValue = -50 + (value * 0.5);
            
            this.audioNodes.lowpassFilter.frequency.setValueAtTime(
                frequencyValue, 
                this.audioContext.currentTime
            );
            
            this.audioNodes.highpassFilter.frequency.setValueAtTime(
                100 + (value * 2), 
                this.audioContext.currentTime
            );
            
            this.audioNodes.noiseGate.threshold.setValueAtTime(
                thresholdValue, 
                this.audioContext.currentTime
            );
        }
        
        this._updateUIDisplay('noiseReductionValue', `${percentage}%`);
    }

    updatePitchShift(value) {
        this.config.pitchShift = value;
        this._updateUIDisplay('pitchValue', `${value} semitones`);
        console.log(`Pitch shift set to ${value} semitones`);
        // Future: Implement advanced pitch-shifting algorithm
    }

    _updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('statusMessage');
        statusElement.textContent = message;
        
        // Remove all status classes
        statusElement.classList.remove('status-success', 'status-error', 'status-default');
        
        // Add appropriate class based on status type
        if (type === 'success') {
            statusElement.classList.add('status-success');
        } else if (type === 'error') {
            statusElement.classList.add('status-error');
        } else {
            statusElement.classList.add('status-default');
        }
    }

    _updateUIDisplay(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    }

    _updateUIControls(isActive) {
        const toggleButton = document.getElementById('dafButton');
        if (toggleButton) {
            toggleButton.textContent = isActive ? 'Stop DAF' : 'Start DAF';
            toggleButton.setAttribute('aria-pressed', isActive.toString());
        }
    }
}

// Instantiate and set up event listeners
document.addEventListener('DOMContentLoaded', () => {
    const speechProcessor = new SpeechProcessor();
    
    // Initialize status message with default class
    const statusElement = document.getElementById('statusMessage');
    statusElement.classList.add('status-default');
    
    document.getElementById('dafButton').addEventListener('click', (e) => {
        const isStarting = e.target.textContent === 'Start DAF';
        
        // Track button click using the analytics.js function
        trackDAFEvent(isStarting ? 'start_daf' : 'stop_daf', isStarting ? 'DAF Started' : 'DAF Stopped');
        
        if (isStarting) {
            speechProcessor.start();
        } else {
            speechProcessor.stop();
        }
    });

    document.getElementById('delaySlider').addEventListener('input', (e) => {
        speechProcessor.updateDelayTime(e.target.value);
        // Track control adjustment
        trackControlEvent('delay_time', `${e.target.value} ms`);
    });

    document.getElementById('inputGainSlider').addEventListener('input', (e) => {
        speechProcessor.updateInputGain(e.target.value);
        // Track control adjustment
        trackControlEvent('input_gain', `${e.target.value}x`);
    });

    document.getElementById('noiseReductionSlider').addEventListener('input', (e) => {
        speechProcessor.updateNoiseReduction(e.target.value);
        // Track control adjustment
        trackControlEvent('noise_reduction', `${e.target.value}%`);
    });

    document.getElementById('pitchSlider').addEventListener('input', (e) => {
        speechProcessor.updatePitchShift(e.target.value);
        // Track control adjustment
        trackControlEvent('pitch_shift', `${e.target.value} semitones`);
    });
});
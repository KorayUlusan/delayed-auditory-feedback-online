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
            pitchShifter: null,
            channelSplitter: null,
            channelMerger: null
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
        
        // Timer functionality
        this.timerInterval = null;
        this.startTime = 0;
        this.elapsedTime = 0;
        
        // Wake lock to prevent device sleep
        this.wakeLock = null;
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
        
        // For stereo output (both ears)
        nodes.channelSplitter = ctx.createChannelSplitter(2);
        nodes.channelMerger = ctx.createChannelMerger(2);
        
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
        const cfg = this.config;

        // Basic direct connection for minimum latency when no processing is needed
        if (cfg.noiseReduction === 0 && cfg.inputGain === 1) {
            // Optimized shortest path: source -> delayNode -> output
            nodes.source.connect(nodes.delayNode);
            this._connectDelayToOutput();
            console.log('Using optimized latency path (bypassing noise reduction and gain)');
            return;
        }

        // Standard processing path with all nodes
        nodes.source.connect(nodes.inputGain);
        
        // Conditionally include noise reduction
        if (cfg.noiseReduction > 0) {
            // Full processing chain with noise reduction
            nodes.inputGain.connect(nodes.highpassFilter);
            nodes.highpassFilter.connect(nodes.lowpassFilter);
            nodes.lowpassFilter.connect(nodes.noiseGate);
            nodes.noiseGate.connect(nodes.compressor);
            nodes.compressor.connect(nodes.delayNode);
        } else {
            // Skip noise reduction nodes
            nodes.inputGain.connect(nodes.delayNode);
        }
        
        this._connectDelayToOutput();
    }
    
    // Helper method to connect delay node to output (stereo)
    _connectDelayToOutput() {
        const nodes = this.audioNodes;
        
        // Ensure stereo output by duplicating the signal to both channels
        nodes.delayNode.connect(nodes.channelSplitter);
        
        // Connect each channel from the splitter to both inputs of the merger
        nodes.channelSplitter.connect(nodes.channelMerger, 0, 0); // Left to left
        nodes.channelSplitter.connect(nodes.channelMerger, 0, 1); // Left to right
        
        nodes.channelMerger.connect(nodes.outputGain);
        nodes.outputGain.connect(this.audioContext.destination);
    }

    async start() {
        this.initializeAudio()
            .then(async success => {
                if (success) {
                    this._updateStatus('Speech Processing Active', 'success');
                    this._updateUIControls(true);
                    this._startTimer();
                    
                    // Request wake lock to prevent device from sleeping
                    await this._requestWakeLock();
                    
                    // Handle visibility change (app going to background)
                    document.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
                }
            });
    }

    async stop() {
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
        this._stopTimer();
        
        // Release wake lock when stopping
        await this._releaseWakeLock();
        
        // Remove visibility change listener
        document.removeEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
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
        const previousValue = this.config.inputGain;
        this.config.inputGain = value;
        
        if (this.audioNodes.inputGain && this.audioContext) {
            this.audioNodes.inputGain.gain.setValueAtTime(
                value, 
                this.audioContext.currentTime
            );
            
            // Check if we're crossing the threshold between optimized and normal path
            if ((previousValue === 1 && value > 1) || (previousValue > 1 && value === 1)) {
                this._rebuildAudioPath();
            }
        }
        
        this._updateUIDisplay('inputGainValue', `${value}x`);
    }

    updateNoiseReduction(value) {
        const previousValue = this.config.noiseReduction;
        this.config.noiseReduction = value;
        const percentage = Math.round(value);
        
        if (this.audioContext) {
            // Apply noise reduction settings when the nodes exist
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
            
            // Check if we're crossing the threshold between optimized and normal path
            if ((previousValue === 0 && value > 0) || (previousValue > 0 && value === 0)) {
                this._rebuildAudioPath();
            }
        }
        
        this._updateUIDisplay('noiseReductionValue', `${percentage}%`);
    }
    
    // Method to rebuild the audio path when configuration changes require it
    _rebuildAudioPath() {
        // Only rebuild if we have an active audio context
        if (!this.audioContext || !this.audioNodes.source) {
            return;
        }
        
        console.log('Rebuilding audio path for optimal latency');
        
        // Disconnect all existing connections
        Object.values(this.audioNodes).forEach(node => {
            if (node && typeof node.disconnect === 'function') {
                node.disconnect();
            }
        });
        
        // Rebuild connections with current settings
        this._connectAudioNodes();
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
    
    _startTimer() {
        const timerElement = document.getElementById('dafTimer');
        if (!timerElement) return;
        
        // Reset and show timer
        this.startTime = Date.now();
        this.elapsedTime = 0;
        timerElement.textContent = '00:00';
        timerElement.style.display = 'block';
        
        // Update timer every second
        this.timerInterval = setInterval(() => {
            this.elapsedTime = Date.now() - this.startTime;
            const seconds = Math.floor(this.elapsedTime / 1000);
            const minutes = Math.floor(seconds / 60);
            const displaySeconds = String(seconds % 60).padStart(2, '0');
            const displayMinutes = String(minutes).padStart(2, '0');
            
            timerElement.textContent = `${displayMinutes}:${displaySeconds}`;
        }, 1000);
    }
    
    _stopTimer() {
        // Clear timer interval
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        
        // Hide timer display
        const timerElement = document.getElementById('dafTimer');
        if (timerElement) {
            timerElement.style.display = 'none';
        }
    }
    
    async _requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                // Request a screen wake lock
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock is active');
                
                // Listen for wake lock release
                this.wakeLock.addEventListener('release', () => {
                    console.log('Wake Lock was released');
                });
            } else {
                console.log('Wake Lock API not supported on this device');
                this._setupAudioContext();
            }
        } catch (err) {
            console.error(`Failed to obtain wake lock: ${err.message}`);
            this._setupAudioContext();
        }
    }
    
    async _releaseWakeLock() {
        if (this.wakeLock) {
            try {
                await this.wakeLock.release();
                this.wakeLock = null;
                console.log('Wake Lock released');
            } catch (err) {
                console.error(`Error releasing wake lock: ${err.message}`);
            }
        }
    }
    
    // Handle visibility changes (browser tab/app going to background)
    async _handleVisibilityChange() {
        if (document.visibilityState === 'visible' && !this.wakeLock) {
            // Re-request wake lock if page becomes visible and we don't have an active wake lock
            await this._requestWakeLock();
        }
        
        if (document.visibilityState === 'hidden') {
            // Keep audio processing active using a silent audio context when in background
            this._setupAudioContext();
        }
    }
    
    _setupAudioContext() {
        // Create a silent audio context to keep the app running in background
        // This is a fallback method when wake lock isn't available
        if (!this._silentAudio && this.audioContext) {
            this._silentAudio = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 0.001; // Nearly silent
            this._silentAudio.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            this._silentAudio.start();
            console.log('Silent audio started to maintain background processing');
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
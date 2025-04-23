// Speech Processing and Delayed Auditory Feedback (DAF) Module

// Global reference to speech processor instance
let globalSpeechProcessor = null;

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
            speechFrequencyMax: 3400,  // Hz, upper speech frequency bound
            useZeroLatencyMode: true,  // New option for ultra-low latency
            bufferSize: 256       // Buffer size for ScriptProcessor (lower = less latency but more CPU)
        };
        
        // Timer functionality
        this.timerInterval = null;
        this.startTime = 0;
        this.elapsedTime = 0;
        
        // Wake lock to prevent device sleep
        this.wakeLock = null;
        
        // App visibility and audio state tracking
        this.isAppVisible = true;
        this.isAudioRunning = false;
        this.audioSuspendedByBackground = false;
        this.resumeAttempts = 0;
        this.maxResumeAttempts = 5;
        
        // Direct mode components (for zero latency)
        this.directModeEnabled = false;
        this.directOutput = null;
    }

    async initializeAudio() {
        const constraints = {
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                channelCount: 1,
                latency: 0.001 // Request minimal latency if supported
            }
        };

        try {
            // Request microphone access
            this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Create audio context with absolute minimal latency
            const contextOptions = {
                latencyHint: 'interactive', // Use 'playback' for more stability or 'interactive' for lower latency
                sampleRate: 48000 // Higher sample rates can reduce latency on some devices
            };
            
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);
            
            // Log system audio info for debugging latency issues
            console.log(`Audio context state: ${this.audioContext.state}`);
            console.log(`Sample rate: ${this.audioContext.sampleRate}Hz`);
            console.log(`Base latency: ${this.audioContext.baseLatency || 'not supported'}`);
            console.log(`Output latency: ${this.audioContext.outputLatency || 'not supported'}`);
            
            // Add event listener for state changes
            this.audioContext.addEventListener('statechange', () => {
                console.log(`Audio context state changed to: ${this.audioContext.state}`);
                this._notifyServiceWorker('AUDIO_STATE', this.audioContext.state);
                
                // If returning from suspension and app is visible, attempt to resume
                if (this.audioContext.state === 'suspended' && this.isAppVisible && this.isAudioRunning) {
                    this._attemptResumeAudio();
                }
            });

            // Initialize audio processing nodes
            this._createAudioNodes();
            this._configureAudioNodes();
            
            // Choose appropriate connection strategy based on latency needs
            if (this.config.useZeroLatencyMode && this.config.delayTime <= 5) {
                this._setupDirectMode();
            } else {
                this._connectAudioNodes();
            }
            
            // Set audio running state
            this.isAudioRunning = true;

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
        
        // For zero latency, we need smallest possible delay (0.01ms)
        nodes.delayNode = ctx.createDelay(1); 
        nodes.delayNode.delayTime.value = Math.max(0.00001, this.config.delayTime / 1000);
        
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

    // Setup ultra-low latency direct output mode
    _setupDirectMode() {
        console.log('Using zero-latency direct mode');
        this.directModeEnabled = true;
        
        // Disconnect any existing nodes
        Object.values(this.audioNodes).forEach(node => {
            if (node && typeof node.disconnect === 'function') {
                node.disconnect();
            }
        });
        
        const ctx = this.audioContext;
        const source = this.audioNodes.source;
        
        // For ultra-low latency, connect directly to output with minimal processing
        if (this.config.delayTime <= 0) {
            // Direct pass-through but ensure stereo output
            // First create a stereo splitter for the mono source
            const splitter = ctx.createChannelSplitter();
            const merger = ctx.createChannelMerger(2);
            
            // Connect source to splitter
            source.connect(splitter);
            
            // Connect the single channel to both left and right outputs
            splitter.connect(merger, 0, 0); // Connect to left channel
            splitter.connect(merger, 0, 1); // Connect to right channel
            
            // Connect the merger to the destination
            merger.connect(ctx.destination);
            
            // Store for cleanup later
            this.directOutput = {
                splitter: splitter,
                merger: merger,
                disconnect: function() {
                    this.splitter.disconnect();
                    this.merger.disconnect();
                }
            };
            
            return;
        }
        
        // For very small delays, simplify the path as much as possible
        const delayNode = this.audioNodes.delayNode;
        const outputGain = this.audioNodes.outputGain;
        
        // Create channel splitter and merger to ensure stereo output
        const splitter = ctx.createChannelSplitter();
        const merger = ctx.createChannelMerger(2);
        
        // Simplified signal path: source -> delay -> splitter -> merger -> output
        source.connect(delayNode);
        delayNode.connect(splitter);
        
        // Connect the mono channel to both left and right outputs
        splitter.connect(merger, 0, 0); // Connect to left channel
        splitter.connect(merger, 0, 1); // Connect to right channel
        
        // Connect to output
        merger.connect(outputGain);
        outputGain.connect(ctx.destination);
        
        // Store for cleanup
        this.directOutput = {
            splitter: splitter,
            merger: merger,
            disconnect: function() {
                this.splitter.disconnect();
                this.merger.disconnect();
            }
        };
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
        nodes.noiseGate.attack.setValueAtTime(0, ctx.currentTime); // Reduced for less latency
        nodes.noiseGate.release.setValueAtTime(0.1, ctx.currentTime); // Reduced for less latency
        
        // Compressor for speech clarity
        nodes.compressor.threshold.setValueAtTime(-18, ctx.currentTime);
        nodes.compressor.knee.setValueAtTime(15, ctx.currentTime);
        nodes.compressor.ratio.setValueAtTime(8, ctx.currentTime);
        nodes.compressor.attack.setValueAtTime(0, ctx.currentTime); // Reduced for less latency
        nodes.compressor.release.setValueAtTime(0.05, ctx.currentTime); // Reduced for less latency
        
        // Initial gain and delay settings
        nodes.inputGain.gain.setValueAtTime(cfg.inputGain, ctx.currentTime);
        nodes.delayNode.delayTime.setValueAtTime(Math.max(0.00001, cfg.delayTime / 1000), ctx.currentTime);
    }

    _connectAudioNodes() {
        const nodes = this.audioNodes;
        const cfg = this.config;

        // Optimize for minimum latency when delay is very low or noise reduction is disabled
        if (cfg.delayTime < 20 || (cfg.noiseReduction === 0 && cfg.inputGain === 1)) {
            // Ultra-optimized path for minimum latency: source -> delayNode -> output
            nodes.source.connect(nodes.delayNode);
            this._connectDelayToOutput();
            console.log('Using optimized ultra-low latency path (bypassing all processing)');
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
            // Skip noise reduction nodes for lower latency
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
        const success = await this.initializeAudio();
        if (success) {
            this._updateStatus('Speech Processing Active', 'success');
            this._updateUIControls(true);
            this._startTimer();
            this.isAudioRunning = true;
            
            // Request wake lock to prevent device from sleeping
            await this._requestWakeLock();
            
            // Set up visibility change handler
            document.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
            
            // Set up page lifecycle events if available
            if ('onfreeze' in document) {
                document.addEventListener('freeze', this._handleFreeze.bind(this));
            }
            
            if ('onresume' in document) {
                document.addEventListener('resume', this._handleResume.bind(this));
            }
            
            // Create a service worker message listener
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.addEventListener('message', this._handleServiceWorkerMessage.bind(this));
            }
            
            // Apply current user settings
            if (this.config.delayTime <= 5) {
                this._updateStatus('Zero-latency mode active', 'success');
            }
        }
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

                // If we have a direct mode active, clean it up
                if (this.directOutput) {
                    this.directOutput.disconnect();
                    this.directOutput = null;
                }

                await this.audioContext.close();
            } catch (error) {
                console.error('Shutdown Error:', error);
            }

            // Reset audio context and nodes
            this.audioContext = null;
            Object.keys(this.audioNodes).forEach(key => {
                this.audioNodes[key] = null;
            });
            
            this.directModeEnabled = false;
        }

        this.isAudioRunning = false;
        this._updateStatus('Speech Processing Stopped', 'warning');
        this._updateUIControls(false);
        this._stopTimer();
        
        // Release wake lock when stopping
        await this._releaseWakeLock();
        
        // Remove event listeners
        document.removeEventListener('visibilitychange', this._handleVisibilityChange);
        
        if ('onfreeze' in document) {
            document.removeEventListener('freeze', this._handleFreeze);
        }
        
        if ('onresume' in document) {
            document.removeEventListener('resume', this._handleResume);
        }
        
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.removeEventListener('message', this._handleServiceWorkerMessage);
        }
    }

    // Attempt to resume audio context after suspension
    async _attemptResumeAudio() {
        if (!this.audioContext || this.audioContext.state !== 'suspended' || this.resumeAttempts >= this.maxResumeAttempts) {
            return false;
        }
        
        this.resumeAttempts++;
        console.log(`Attempting to resume audio context (attempt ${this.resumeAttempts}/${this.maxResumeAttempts})`);
        
        try {
            await this.audioContext.resume();
            console.log(`Audio context successfully resumed after ${this.resumeAttempts} attempts`);
            this.resumeAttempts = 0;
            
            // If this was suspended by background, rebuild audio path
            if (this.audioSuspendedByBackground) {
                this._rebuildAudioPath();
                this.audioSuspendedByBackground = false;
            }
            
            return true;
        } catch (error) {
            console.error('Failed to resume audio context:', error);
            
            // Try again with exponential backoff if we have attempts left
            if (this.resumeAttempts < this.maxResumeAttempts) {
                const delay = Math.pow(2, this.resumeAttempts) * 100;
                setTimeout(() => this._attemptResumeAudio(), delay);
            } else {
                console.error('Max resume attempts reached. User interaction needed.');
                this._updateStatus('Tap to resume audio', 'error');
                return false;
            }
        }
    }
    
    // Handle messages from the service worker
    _handleServiceWorkerMessage(event) {
        // Handle keep-alive confirmation
        if (event.data && event.data.type === 'KEEP_ALIVE_CONFIRMATION') {
            console.log('Received keep-alive confirmation from service worker');
        }
        
        // Handle visibility updates from other tabs/instances
        if (event.data && event.data.type === 'VISIBILITY_UPDATE') {
            console.log(`Received visibility update: ${event.data.isVisible ? 'visible' : 'hidden'}`);
        }
        
        // Handle audio state updates from other tabs/instances
        if (event.data && event.data.type === 'AUDIO_STATE_UPDATE') {
            console.log(`Received audio state update: ${event.data.state}`);
        }
    }
    
    // Send message to service worker
    _notifyServiceWorker(type, data) {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: type,
                ...data
            });
        }
    }
    
    // Handle page freeze event (when browser hibernates the page)
    _handleFreeze() {
        console.log('Page is being frozen. Saving audio state.');
        
        // Save state for when the page unfreezes
        if (this.audioContext && this.audioContext.state === 'running') {
            this.audioSuspendedByBackground = true;
        }
    }
    
    // Handle page resume event (when returning from hibernation)
    _handleResume() {
        console.log('Page is resuming from frozen state. Restoring audio.');
        
        if (this.isAudioRunning && this.audioContext && this.audioContext.state === 'suspended') {
            this._attemptResumeAudio();
        }
    }

    // Handle visibility changes (browser tab/app going to background)
    async _handleVisibilityChange() {
        const isVisible = document.visibilityState === 'visible';
        this.isAppVisible = isVisible;
        
        console.log(`Page visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
        
        // Notify service worker about visibility change
        this._notifyServiceWorker('VISIBILITY_CHANGE', { isVisible });
        
        if (isVisible) {
            // Page is now visible
            if (this.isAudioRunning && this.audioContext && this.audioContext.state === 'suspended') {
                // Try to resume audio context
                this._attemptResumeAudio();
            }
            
            // Re-request wake lock if needed
            if (!this.wakeLock && this.isAudioRunning) {
                await this._requestWakeLock();
            }
        } else {
            // Page is now hidden
            
            // On iOS, we'll likely get suspended, so prepare for that
            if (this.audioContext && this.audioContext.state === 'running') {
                // Keep a record that we were running when backgrounded
                this.audioSuspendedByBackground = true;
            }
            
            // Keep audio processing active using a silent audio context
            this._setupAudioContext();
        }
    }

    updateDelayTime(value) {
        const previousDelay = this.config.delayTime;
        this.config.delayTime = value;
        
        if (!this.audioContext) return;
        
        // Set minimum possible delay if zero is requested
        const actualDelay = value <= 0 ? 0.00001 : value / 1000; // Minimum value to avoid errors
        
        if (this.audioNodes.delayNode) {
            this.audioNodes.delayNode.delayTime.setValueAtTime(
                actualDelay, 
                this.audioContext.currentTime
            );
        }
        
        // Check if we need to switch between direct and normal modes
        const wasVeryLowLatency = previousDelay <= 5;
        const isVeryLowLatency = value <= 5;
        
        // If switching between latency modes, rebuild audio path
        if (this.config.useZeroLatencyMode && (wasVeryLowLatency !== isVeryLowLatency)) {
            if (isVeryLowLatency) {
                this._setupDirectMode();
                this._updateStatus('Zero-latency mode active', 'success');
            } else {
                this.directModeEnabled = false;
                this._rebuildAudioPath();
            }
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
        
        if (this.directOutput) {
            this.directOutput.disconnect();
            this.directOutput = null;
        }
        
        // Determine if we should use direct mode for ultra-low latency
        if (this.config.useZeroLatencyMode && this.config.delayTime <= 5) {
            this._setupDirectMode();
            this._updateStatus('Zero-latency mode active', 'success');
        } else {
            // Rebuild connections with current settings
            this._connectAudioNodes();
            
            // If previously in direct mode, update status
            if (this.directModeEnabled) {
                this.directModeEnabled = false;
                this._updateStatus('Speech Processing Active', 'success');
            }
        }
    }

    updatePitchShift(value) {
        this.config.pitchShift = value;
        this._updateUIDisplay('pitchValue', `${value} semitones`);
        console.log(`Pitch shift set to ${value} semitones`);
        // Future: Implement advanced pitch-shifting algorithm
    }

    _updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('statusMessage');
        if (!statusElement) return;
        
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
                    this.wakeLock = null;
                    
                    // Try to reacquire wake lock if audio is still running and page is visible
                    if (this.isAudioRunning && this.isAppVisible) {
                        setTimeout(() => this._requestWakeLock(), 1000);
                    }
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
    
    _setupAudioContext() {
        // Create a silent audio context to keep the app running in background
        // This is a fallback method when wake lock isn't available
        if (!this._silentAudio && this.audioContext) {
            try {
                this._silentAudio = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                gainNode.gain.value = 0.001; // Nearly silent
                this._silentAudio.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                this._silentAudio.start();
                console.log('Silent audio started to maintain background processing');
            } catch (e) {
                console.error('Failed to create silent audio context:', e);
            }
        }
    }
}

// Initialize the global speech processor on DOM content load
document.addEventListener('DOMContentLoaded', () => {
    // Create a single global instance
    globalSpeechProcessor = new SpeechProcessor();
    
    // Initialize status message with default class
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
        statusElement.classList.add('status-default');
    }
    
    document.getElementById('dafButton').addEventListener('click', (e) => {
        const isStarting = e.target.textContent === 'Start DAF';
        
        // Track button click using the analytics.js function
        if (typeof trackDAFEvent === 'function') {
            trackDAFEvent(isStarting ? 'start_daf' : 'stop_daf', isStarting ? 'DAF Started' : 'DAF Stopped');
        }
        
        if (isStarting) {
            globalSpeechProcessor.start();
        } else {
            globalSpeechProcessor.stop();
        }
    });

    document.getElementById('delaySlider').addEventListener('input', (e) => {
        globalSpeechProcessor.updateDelayTime(e.target.value);
        // Track control adjustment
        if (typeof trackControlEvent === 'function') {
            trackControlEvent('delay_time', `${e.target.value} ms`);
        }
    });

    document.getElementById('inputGainSlider').addEventListener('input', (e) => {
        globalSpeechProcessor.updateInputGain(e.target.value);
        // Track control adjustment
        if (typeof trackControlEvent === 'function') {
            trackControlEvent('input_gain', `${e.target.value}x`);
        }
    });

    document.getElementById('noiseReductionSlider').addEventListener('input', (e) => {
        globalSpeechProcessor.updateNoiseReduction(e.target.value);
        // Track control adjustment
        if (typeof trackControlEvent === 'function') {
            trackControlEvent('noise_reduction', `${e.target.value}%`);
        }
    });

    document.getElementById('pitchSlider').addEventListener('input', (e) => {
        globalSpeechProcessor.updatePitchShift(e.target.value);
        // Track control adjustment
        if (typeof trackControlEvent === 'function') {
            trackControlEvent('pitch_shift', `${e.target.value} semitones`);
        }
    });
    
    // Add click handler to the status message to resume audio context
    // This helps on iOS when the context gets suspended
    document.getElementById('statusMessage').addEventListener('click', () => {
        if (globalSpeechProcessor && 
            globalSpeechProcessor.audioContext && 
            globalSpeechProcessor.audioContext.state === 'suspended') {
            
            globalSpeechProcessor._attemptResumeAudio();
        }
    });
});
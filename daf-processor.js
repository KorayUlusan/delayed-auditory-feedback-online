// Speech Processing and Delayed Auditory Feedback (DAF) Module
class SpeechProcessor {
    constructor() {
        // Core audio processing components
        this.audioContext = null;
        this.audioStream = null;
        this.audioNodes = {
            source: null,
            gainNode: null, // Single gain node instead of separate input/output
            delayNode: null,
            channelSplitter: null,
            channelMerger: null,
        };

        // Speech processing configuration
        this.config = {
            delayTime: 50,        // ms, optimal for speech DAF
            gain: 1,              // unified gain control
        };

        // State tracking
        this.isAudioRunning = false;
        this.isAppVisible = document.visibilityState === 'visible';
        this.directModeEnabled = false;
        this.audioSuspendedByBackground = false;

        // Audio resume handling
        this.resumeAttempts = 0;
        this.maxResumeAttempts = 5;

        // Timer functionality
        this.timerInterval = null;
        this.startTime = 0;
        this.elapsedTime = 0;

        // Add event listeners for visibility and freeze/resume events
        this._setupEventListeners();
    }

    // LIFECYCLE METHODS

    async initializeAudio() {
        try {
            await this._requestMicrophoneAccess();
            this._createAudioContext();
            this._logAudioContextInfo();
            this._createAudioNodes();
            this._configureAudioNodes();
            this._connectAudioNodes();

            this.isAudioRunning = true;
            return true;
        } catch (error) {
            console.error('Speech Processor Initialization Error:', error);
            this._updateStatus(`Error: ${error.message}`, 'error');
            return false;
        }
    }

    async start() {
        const success = await this.initializeAudio();
        if (success) {
            this._updateStatus('Speech Processing Active', 'success');
            this._updateUIControls(true);
            this._startTimer();

            // Apply current user settings
            if (this.config.delayTime <= 5) {
                this._updateStatus('Direct audio mode active', 'success');
            }
        }
    }

    async stop() {
        this._stopAudioStream();
        await this._closeAudioContext();
        this._resetAudioState();

        this._updateStatus('Speech Processing Stopped', 'warning');
        this._updateUIControls(false);
        this._stopTimer();
    }

    // AUDIO SETUP METHODS

    async _requestMicrophoneAccess() {
        const constraints = {
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                channelCount: 1,
                latency: 0.0, // Request absolute minimal latency
                sampleRate: 48000 // Higher sample rates can reduce latency
            }
        };

        this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
    }

    _createAudioContext() {
        // Create audio context with absolute minimal latency
        const contextOptions = {
            latencyHint: 0.0, // Override with lowest possible latency
            sampleRate: 48000 // Higher sample rate for lower latency
        };

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);

        // Add event listener for state changes
        this.audioContext.addEventListener('statechange', this._handleAudioContextStateChange.bind(this));
    }

    _logAudioContextInfo() {
        console.log(`Audio context state: ${this.audioContext.state}`);
        console.log(`Sample rate: ${this.audioContext.sampleRate}Hz`);
        console.log(`Base latency: ${this.audioContext.baseLatency || 'not supported'}`);
        console.log(`Output latency: ${this.audioContext.outputLatency || 'not supported'}`);
    }

    _createAudioNodes() {
        const ctx = this.audioContext;
        const nodes = this.audioNodes;

        nodes.source = ctx.createMediaStreamSource(this.audioStream);
        
        // Single gain node for all gain control
        nodes.gainNode = ctx.createGain();
        
        // Create delay node with minimal delay buffer size
        nodes.delayNode = ctx.createDelay(0.5); // Reduce max delay to 500ms for better performance
        
        // Use the smallest possible delay value when setting to zero
        const minDelay = 0.000001; // 1 microsecond, effectively zero
        nodes.delayNode.delayTime.value = Math.max(minDelay, this.config.delayTime / 1000);
        
        // For stereo output (both ears)
        // Create a stereo splitter even though our source is mono
        nodes.channelSplitter = ctx.createChannelSplitter(1);
        nodes.channelMerger = ctx.createChannelMerger(2);
    }

    _configureAudioNodes() {
        const nodes = this.audioNodes;
        const cfg = this.config;
        const ctx = this.audioContext;
        
        // Use the minimum possible delay value when setting to zero
        const minDelay = 0.000001; // 1 microsecond, effectively zero
        const actualDelay = cfg.delayTime <= 0 ? minDelay : cfg.delayTime / 1000;
        
        // Set gain and delay settings with immediate application
        nodes.gainNode.gain.setValueAtTime(cfg.gain, ctx.currentTime);
        nodes.delayNode.delayTime.setValueAtTime(actualDelay, ctx.currentTime);
    }

    _connectAudioNodes() {
        const nodes = this.audioNodes;
        
        // Connect source to delay node
        nodes.source.connect(nodes.delayNode);
        
        // Apply stereo output through splitter and merger for proper stereo panning
        nodes.delayNode.connect(nodes.channelSplitter);
        
        // Connect the mono source to both left and right channels
        // This ensures the audio is heard in both ears
        nodes.channelSplitter.connect(nodes.channelMerger, 0, 0); // Left channel
        nodes.channelSplitter.connect(nodes.channelMerger, 0, 1); // Right channel
        
        // Connect merger to gain node then to destination
        nodes.channelMerger.connect(nodes.gainNode);
        nodes.gainNode.connect(this.audioContext.destination);
        
        // Mark as direct mode
        this.directModeEnabled = true;
        
        console.log('Optimized stereo audio path connected with delay:', this.config.delayTime + 'ms');
    }


    _disconnectAllNodes() {
        Object.values(this.audioNodes).forEach(node => {
            if (node && typeof node.disconnect === 'function') {
                node.disconnect();
            }
        });
    }

    _stopAudioStream() {
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
    }

    async _closeAudioContext() {
        if (this.audioContext) {
            this._disconnectAllNodes();
            try {
                await this.audioContext.close();
            } catch (error) {
                console.error('Error closing audio context:', error);
            }
        }
    }

    _resetAudioState() {
        this.audioContext = null;
        Object.keys(this.audioNodes).forEach(key => {
            this.audioNodes[key] = null;
        });

        this.isAudioRunning = false;
        this.directModeEnabled = false;
        this.audioSuspendedByBackground = false;
        this.resumeAttempts = 0;
    }

    // EVENT HANDLERS

    _setupEventListeners() {
        // Setup visibility change handler
        document.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));

        // Setup freeze/resume handlers if supported
        if ('onfreeze' in document) {
            document.addEventListener('freeze', this._handleFreeze.bind(this));
        }

        if ('onresume' in document) {
            document.addEventListener('resume', this._handleResume.bind(this));
        }

        // Setup service worker message handler
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', this._handleServiceWorkerMessage.bind(this));
        }
    }

    _handleAudioContextStateChange() {
        if (!this.audioContext) return;

        console.log(`Audio context state changed to: ${this.audioContext.state}`);
        this._notifyServiceWorker('AUDIO_STATE', this.audioContext.state);

        // If returning from suspension and app is visible, attempt to resume
        if (this.audioContext.state === 'suspended' && this.isAppVisible && this.isAudioRunning) {
            this._attemptResumeAudio();
        }
    }

    _handleVisibilityChange() {
        const isVisible = document.visibilityState === 'visible';
        this.isAppVisible = isVisible;

        console.log(`Page visibility changed: ${isVisible ? 'visible' : 'hidden'}`);

        // Notify service worker about visibility change
        this._notifyServiceWorker('VISIBILITY_CHANGE', { isVisible });

        if (isVisible) {
            // Page is now visible
            if (this.isAudioRunning && this.audioContext && this.audioContext.state === 'suspended') {
                this._attemptResumeAudio();
            }
        } else {
            // Page is now hidden
            if (this.audioContext && this.audioContext.state === 'running') {
                // Keep a record that we were running when backgrounded
                this.audioSuspendedByBackground = true;
            }
        }
    }

    _handleFreeze() {
        console.log('Page is being frozen. Saving audio state.');

        // Save state for when the page unfreezes
        if (this.audioContext && this.audioContext.state === 'running') {
            this.audioSuspendedByBackground = true;
        }
    }

    _handleResume() {
        console.log('Page is resuming from frozen state. Restoring audio.');

        if (this.isAudioRunning && this.audioContext && this.audioContext.state === 'suspended') {
            this._attemptResumeAudio();
        }
    }

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

    // AUDIO CONTROL METHODS

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

    _notifyServiceWorker(type, data) {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: type,
                ...data
            });
        }
    }

    // USER PARAMETER CONTROL METHODS

    updateDelayTime(value) {
        this.config.delayTime = value;

        if (!this.audioContext || !this.audioNodes.delayNode) return;

        // Use minimum possible delay value when setting to zero
        const minDelay = 0.000001; // 1 microsecond, effectively zero
        const actualDelay = value <= 0 ? minDelay : value / 1000;

        // Set delay time immediately with no ramp for lowest latency
        this.audioNodes.delayNode.delayTime.setValueAtTime(
            actualDelay,
            this.audioContext.currentTime
        );
        console.log(`Delay time updated to: ${actualDelay.toFixed(6)} seconds (${value} ms)`);

        this._updateUIDisplay('delayValue', `${value} ms`);
    }

    updateGain(value) {
        this.config.gain = value;
        
        if (!this.audioContext || !this.audioNodes.gainNode) return;
        
        this.audioNodes.gainNode.gain.setValueAtTime(
            value, 
            this.audioContext.currentTime
        );
        
        this._updateUIDisplay('gainValue', `${value}x`);
    }

    // For backward compatibility with existing UI controls
    updateInputGain(value) {
        this.updateGain(value);
    }

    // UI METHODS

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

    // TIMER METHODS

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
}

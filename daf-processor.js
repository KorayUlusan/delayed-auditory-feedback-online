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
            channelSplitter: null,
            channelMerger: null,
        };

        // Speech processing configuration
        this.config = {
            delayTime: 50,        // ms, optimal for speech DAF
            inputGain: 1,         // default gain
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
                latency: 0.001 // Request minimal latency if supported
            }
        };

        this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
    }

    _createAudioContext() {
        // Create audio context with absolute minimal latency
        const contextOptions = {
            latencyHint: 'interactive', // Use 'playback' for more stability or 'interactive' for lower latency
            sampleRate: 48000 // Higher sample rates can reduce latency on some devices
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
        nodes.inputGain = ctx.createGain();

        // Create delay node with minimal delay
        nodes.delayNode = ctx.createDelay(1);
        nodes.delayNode.delayTime.value = Math.max(0.00001, this.config.delayTime / 1000);

        nodes.outputGain = ctx.createGain();

        // For stereo output (both ears)
        nodes.channelSplitter = ctx.createChannelSplitter(2);
        nodes.channelMerger = ctx.createChannelMerger(2);
    }

    _configureAudioNodes() {
        const nodes = this.audioNodes;
        const cfg = this.config;
        const ctx = this.audioContext;

        // Initial gain and delay settings
        nodes.inputGain.gain.setValueAtTime(cfg.inputGain, ctx.currentTime);
        nodes.delayNode.delayTime.setValueAtTime(Math.max(0.00001, cfg.delayTime / 1000), ctx.currentTime);
    }

    _connectAudioNodes() {
        const nodes = this.audioNodes;

        // Simplified audio path: source -> input gain -> delay -> output
        nodes.source.connect(nodes.inputGain);
        nodes.inputGain.connect(nodes.delayNode);

        // Ensure stereo output by duplicating the signal to both channels
        nodes.delayNode.connect(nodes.channelSplitter);

        // Connect each channel from the splitter to both inputs of the merger
        nodes.channelSplitter.connect(nodes.channelMerger, 0, 0); // Left to left
        nodes.channelSplitter.connect(nodes.channelMerger, 0, 1); // Left to right

        nodes.channelMerger.connect(nodes.outputGain);
        nodes.outputGain.connect(this.audioContext.destination);

        // Mark as direct mode since we're using the optimized path
        this.directModeEnabled = true;

        console.log('Audio path connected with delay:', this.config.delayTime + 'ms');
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

        // Set minimum possible delay if zero is requested
        const actualDelay = value <= 0 ? 0.00001 : value / 1000; // Minimum value to avoid errors

        this.audioNodes.delayNode.delayTime.setValueAtTime(
            actualDelay,
            this.audioContext.currentTime
        );
        console.log(`Delay time updated to: ${actualDelay.toFixed(5)} seconds (${value} ms)`);

        this._updateUIDisplay('delayValue', `${value} ms`);
    }

    updateInputGain(value) {
        this.config.inputGain = value;

        if (!this.audioContext || !this.audioNodes.inputGain) return;

        this.audioNodes.inputGain.gain.setValueAtTime(
            value,
            this.audioContext.currentTime
        );

        this._updateUIDisplay('inputGainValue', `${value}x`);
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

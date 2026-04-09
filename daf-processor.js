// Delayed Auditory Feedback (DAF) Module
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

        // Auditory Feedback configuration
        this.config = {
            delayTime: 50,        // ms, optimal for speech DAF
            gain: 1,              // unified gain control
        };

        // State tracking
        this.isAudioRunning = false;
        this.isAppVisible = document.visibilityState === 'visible';
        this.audioSuspendedByBackground = false;

        // Audio resume handling
        this.resumeAttempts = 0;
        this.maxResumeAttempts = 5;

        // Timer functionality
        this.timerInterval = null;
        this.startTime = 0;
        this.elapsedTime = 0;
        // Analytics heartbeat (send gtag every 60s while DAF active)
        this.analyticsIntervalId = null;
        this.analyticsIntervalMs = 60000; // 60 seconds

        // Device selection
        this.selectedDeviceId = null;
        this.availableDevices = [];
        this.micAccessGranted = false;
        this._deviceDetectionInitialized = false;

        // Add event listeners for visibility and freeze/resume events
        this._setupEventListeners();

        // Initialize device status UI with default values (no permissions yet)
        this._updateDeviceUI('Click "Start DAF" to select your microphone', false);
    }

    // LIFECYCLE METHODS

    // Accept an optional preAcquiredStream so getUserMedia can be called
    // synchronously within a user gesture (avoids UA blocking the request).
    async initializeAudio(preAcquiredStream = null) {
        try {
            // If a stream was provided (pre-acquired during a click), use it
            if (preAcquiredStream) {
                this.audioStream = preAcquiredStream;
                this.micAccessGranted = true;
            } else {
                await this._requestMicrophoneAccess();
            }
            this._createAudioContext();
            this._logAudioContextInfo();
            this._createAudioNodes();
            this._configureAudioNodes();
            this._connectAudioNodes();

            this.isAudioRunning = true;
            return true;
        } catch (error) {
            console.error('Speech Processor Initialization Error:', error);

            // TODO: i need a good way to log errors. 
            window.sendAnalyticsEvent('daf_initialization_error', {
                event_category: 'DAF',
                event_label: error.name || 'Unknown Error',
                error_message: error.message || 'No message'
            });

            // Ensure analytics heartbeat is stopped when initialization fails
            try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }

            const isLocalFile = window.location.href.includes('file://');

            // Check if the error is related to AudioContext
            if (!isLocalFile && (
                error.name === 'NotSupportedError' ||
                error.message.includes('AudioContext') ||
                error.message.includes('audio') ||
                !window.AudioContext && !window.webkitAudioContext)) {
                this._updateStatus('Sorry, we don\'t support your browser yet.', 'error');
            } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                this._updateStatus('Microphone access is required to use DAF. Please allow access and try again.', 'error');
            } 
            // we handle this case outside the class in app.js
            throw new Error('Failed to start audio processing');
        }
    }

    async start() {
        const success = await this.initializeAudio();
        if (success) {
            // Support legacy config property `inputGain` set by older UI code
            if (typeof this.config.inputGain !== 'undefined') {
                this.config.gain = this.config.inputGain;
            }

            // Ensure applied audio node values reflect the current config
            if (this.audioContext && this.audioNodes) {
                if (typeof this.updateGain === 'function') {
                    this.updateGain(this.config.gain);
                }
                if (typeof this.updateDelayTime === 'function') {
                    this.updateDelayTime(this.config.delayTime);
                }
            }
            this._updateUIControls(true);
        }
    }

    async stop(preserveTimer = false) {
        this._stopAudioStream();
        await this._closeAudioContext();
        this._resetAudioState();

        // Reset mic access flag when stopping DAF
        this.micAccessGranted = false;

        // Reset device UI to show microphone is no longer in use
        this._updateDeviceUI('Click "Start DAF" to select your microphone', false);

        this._updateStatus('Auditory Feedback Stopped', 'warning');
        this._updateUIControls(false);
        // Only stop the visible session timer when not preserving (e.g. full stop/destroy).
        if (!preserveTimer) this._stopTimer();
        // stop periodic analytics heartbeat when DAF stops
        this._stopAnalyticsHeartbeat();
    }

    // AUDIO SETUP METHODS

    async _requestMicrophoneAccess() {
        try {
            // First get available audio formats for the selected device
            const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
            let constraints = {
                audio: {
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                    channelCount: 1,
                    latencyHint: 'interactive',
                    deviceId: this.selectedDeviceId ? { exact: this.selectedDeviceId } : undefined
                }
            };

            // Get the stream with initial constraints
            this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.micAccessGranted = true;

            // Get actual track settings to match audio context settings
            const audioTrack = this.audioStream.getAudioTracks()[0];
            const settings = audioTrack.getSettings();

            console.log('Selected microphone settings:', settings);

            // Store the actual sample rate for creating a matching audio context
            this.deviceSampleRate = settings.sampleRate;

            return this.audioStream;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            throw error;
        }
    }

    _createAudioContext() {
        // Create audio context with settings that match the input device
        const contextOptions = {
            latencyHint: 'interactive'
        };
        // Only set sampleRate when the device explicitly reports one.
        // For many browsers the device sample rate is not exposed and forcing
        // a sampleRate can cause "different sample-rate" errors when creating
        // a MediaStreamSource. Let the UA pick a compatible sample rate when
        // none is available.
        if (this.deviceSampleRate && Number.isFinite(this.deviceSampleRate)) {
            contextOptions.sampleRate = this.deviceSampleRate;
            console.log(`Creating audio context with matching sample rate: ${this.deviceSampleRate}Hz`);
        }

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);
        this.audioContext.addEventListener('statechange', this._handleAudioContextStateChange.bind(this));
    }

    _logAudioContextInfo() {
        // Reduced console logs to essential information only
        console.log(`Audio context: ${this.audioContext.state}, Sample rate: ${this.audioContext.sampleRate}Hz`);
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
            // Ensure all tracks are properly stopped to fully release the microphone
            this.audioStream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
            this.audioStream = null;
            console.log('Microphone access fully released');
        }
    }

    async _closeAudioContext() {
        if (this.audioContext) {
            // First disconnect all nodes
            this._disconnectAllNodes();

            try {
                // Check if context is not already closed
                if (this.audioContext.state !== 'closed') {
                    await this.audioContext.close();
                    console.log('Audio context closed successfully');
                } else {
                    console.log('Audio context already closed, skipping close operation');
                }
            } catch (error) {
                console.error('Error closing audio context:', error);
            }

            // Always set to null to prevent reuse of a closed context
            this.audioContext = null;
            // Stop analytics heartbeat when the audio context is closed
            try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
        }
    }

    _resetAudioState() {
        this.audioContext = null;
        Object.keys(this.audioNodes).forEach(key => {
            this.audioNodes[key] = null;
        });

        this.isAudioRunning = false;
        this.audioSuspendedByBackground = false;
        this.resumeAttempts = 0;
        // Ensure analytics heartbeat is stopped whenever we fully reset audio state
        try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
    }

    // EVENT HANDLERS

    _setupEventListeners() {
        // Setup visibility change handler (store bound handlers so we can remove them later)
        this._onVisibilityChange = this._handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this._onVisibilityChange);

        // Setup freeze/resume handlers if supported
        if ('onfreeze' in document) {
            this._onFreeze = this._handleFreeze.bind(this);
            document.addEventListener('freeze', this._onFreeze);
        }

        if ('onresume' in document) {
            this._onResume = this._handleResume.bind(this);
            document.addEventListener('resume', this._onResume);
        }

        // Setup service worker message handler (store bound handler)
        if ('serviceWorker' in navigator) {
            this._onServiceWorkerMessage = this._handleServiceWorkerMessage.bind(this);
            try {
                navigator.serviceWorker.addEventListener('message', this._onServiceWorkerMessage);
            } catch (e) {
                // Some environments may not expose addEventListener; ignore removal in destroy
            }
        }
    }

    _handleAudioContextStateChange() {
        if (!this.audioContext) return;

        this._notifyServiceWorker('AUDIO_STATE', this.audioContext.state);

        // If returning from suspension and app is visible, attempt to resume
        if (this.audioContext.state === 'suspended' && this.isAppVisible && this.isAudioRunning) {
            this._attemptResumeAudio();
        }
    }

    _handleVisibilityChange() {
        const isVisible = document.visibilityState === 'visible';
        this.isAppVisible = isVisible;

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
        // Save state for when the page unfreezes
        if (this.audioContext && this.audioContext.state === 'running') {
            this.audioSuspendedByBackground = true;
        }
    }

    _handleResume() {
        if (this.isAudioRunning && this.audioContext && this.audioContext.state === 'suspended') {
            this._attemptResumeAudio();
        }
    }

    _handleServiceWorkerMessage(event) {
        // Handle keep-alive confirmation
        if (event.data && event.data.type === 'KEEP_ALIVE_CONFIRMATION') {
            // Processing without logging
        }

        // Handle visibility updates from other tabs/instances
        if (event.data && event.data.type === 'VISIBILITY_UPDATE') {
            // Processing without logging
        }

        // Handle audio state updates from other tabs/instances
        if (event.data && event.data.type === 'AUDIO_STATE_UPDATE') {
            // Processing without logging
        }
    }

    // AUDIO CONTROL METHODS

    async _attemptResumeAudio() {
        if (!this.audioContext || this.audioContext.state !== 'suspended' || this.resumeAttempts >= this.maxResumeAttempts) {
            return false;
        }

        this.resumeAttempts++;

        try {
            await this.audioContext.resume();
            this.resumeAttempts = 0;
            return true;
        } catch (error) {
            // Try again with exponential backoff if we have attempts left
            if (this.resumeAttempts < this.maxResumeAttempts) {
                const delay = Math.pow(2, this.resumeAttempts) * 100;
                setTimeout(() => this._attemptResumeAudio(), delay);
            } else {
                this._updateStatus('Tap to resume audio', 'error');
                // If we couldn't resume audio after retries, stop heartbeat
                try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
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

        // Remove all status classes including loading
        statusElement.classList.remove('status-success', 'status-error', 'status-default', 'status-loading');

        // Add appropriate class based on status type
        if (type === 'success') {
            statusElement.classList.add('status-success');
        } else if (type === 'error') {
            statusElement.classList.add('status-error');
        } else if (type === 'loading') {
            // Use a distinct loading style that pulses to indicate activity
            statusElement.classList.add('status-loading');
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

        // Reset and show timer (use class-based visibility to avoid layout jumps)
        this.startTime = Date.now();
        this.elapsedTime = 0;
        timerElement.textContent = '00:00';
        timerElement.classList.add('timer-running');

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

        // Keep timer in layout but mark it not running (no display:none to avoid jumps)
        const timerElement = document.getElementById('dafTimer');
        if (timerElement) {
            timerElement.classList.remove('timer-running');
        }
    }

    // ANALYTICS HEARTBEAT METHODS

    _startAnalyticsHeartbeat() {
        // Avoid duplicate intervals
        if (this.analyticsIntervalId) return;

        // Only start if DAF is active
        if (!this.isAudioRunning) return;

        const sendEvent = () => {
            try {
                // Only send heartbeat when audio is actively running and audible
                if (!this.isAudioRunning) return;
                if (!this.audioContext || this.audioContext.state !== 'running') return;

                // If we don't have audio nodes or a stream, don't send heartbeats
                if (!this.audioNodes) return;
                if (!this.audioStream) return;

                // If we have a gain node, treat gain === 0 as muted
                if (this.audioNodes && this.audioNodes.gainNode && this.audioNodes.gainNode.gain) {
                    const gainVal = this.audioNodes.gainNode.gain.value;
                    if (typeof gainVal === 'number' && gainVal <= 0) return;
                }

                // Best-effort: treat tab as muted if all HTMLMediaElements are muted or at zero volume
                // (There is no direct Web API to read a browser tab's mute state.)
                try {
                    const mediaEls = (typeof document !== 'undefined') ? document.querySelectorAll('audio,video') : [];
                    if (mediaEls && mediaEls.length > 0) {
                        let anyUnmuted = false;
                        for (let i = 0; i < mediaEls.length; i++) {
                            const el = mediaEls[i];
                            try {
                                if (!el.muted && el.volume > 0) { anyUnmuted = true; break; }
                            } catch (e) { /* ignore stale/cross-origin elements */ }
                        }
                        if (!anyUnmuted) return;
                    }
                } catch (e) { /* ignore DOM access errors */ }

                // If microphone tracks exist, ensure at least one is enabled
                if (this.audioStream && this.audioStream.getAudioTracks) {
                    const anyEnabled = this.audioStream.getAudioTracks().some(t => t.enabled !== false);
                    if (!anyEnabled) return;
                }

                const elapsedSeconds = Math.floor(this.elapsedTime / 1000);

                // Send heartbeat via canonical analytics API
                if (typeof window.sendAnalyticsEvent === 'function') {
                    // console.log('Sending DAF heartbeat analytics event at time elapsed:', elapsedSeconds, 'seconds');
                    window.sendAnalyticsEvent('daf_active', {
                        event_category: 'DAF',
                        event_label: 'heartbeat',
                        daf_usage_s: elapsedSeconds
                    });
                }
            } catch (e) {
                // swallow analytics errors
                console.warn('Analytics heartbeat failed:', e);
            }
        };

        // Send first event immediately if we've already been running for >=60s
        // otherwise wait for the first interval tick
        this.analyticsIntervalId = setInterval(sendEvent, this.analyticsIntervalMs);
    }

    _stopAnalyticsHeartbeat() {
        if (this.analyticsIntervalId) {
            clearInterval(this.analyticsIntervalId);
            this.analyticsIntervalId = null;
        }
    }

    // DEVICE SELECTION METHODS

    /**
     * Enumerate all available audio input devices
     * @returns {Promise<Array>} List of audio input devices
     */
    async enumerateAudioDevices() {
        try {
            // First ensure we have permission to access media devices.
            // Some browsers require an active getUserMedia call to expose device labels.
            // Use a temporary stream and stop it immediately to avoid leaving the mic active.
            let tempStream = null;
            try {
                tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (permErr) {
                // If permission denied or not available, proceed to enumerateDevices which
                // may still return limited information.
                console.warn('Temporary getUserMedia failed during device enumeration:', permErr);
            }

            // Get all media devices
            const devices = await navigator.mediaDevices.enumerateDevices();

            // Immediately stop the temporary stream to release the microphone
            if (tempStream) {
                try {
                    tempStream.getTracks().forEach(t => {
                        try { t.stop(); } catch (e) { /* ignore */ }
                    });
                } catch (stopErr) {
                    console.warn('Failed to stop temporary device enumeration stream:', stopErr);
                }
                tempStream = null;
            }

            // Filter to only audio input devices
            this.availableDevices = devices.filter(device => device.kind === 'audioinput');

            console.log('Available audio input devices:', this.availableDevices);

            // Look for likely headset/headphone mics
            const headphoneMic = this.availableDevices.find(device => {
                const label = device.label.toLowerCase();
                return label.includes('headphone') ||
                    label.includes('headset') ||
                    label.includes('earphone') ||
                    label.includes('airpod') ||
                    label.includes('bluetooth');
            });

            // Auto-select headphone mic if available and not already selected
            if (headphoneMic && (!this.selectedDeviceId || this.selectedDeviceId !== headphoneMic.deviceId)) {
                this.selectedDeviceId = headphoneMic.deviceId;
                console.log('Auto-selected headphone microphone:', headphoneMic.label);

                // Update UI to reflect the headphone mic selection
                this._updateDeviceUI(headphoneMic.label, true);

                // If already running, restart with new device
                if (this.isAudioRunning) {
                    await this.restartWithNewDevice();
                }
            } else if (this.selectedDeviceId) {
                // Find the currently selected device to update UI
                const selectedDevice = this.availableDevices.find(device => device.deviceId === this.selectedDeviceId);
                if (selectedDevice) {
                    const isHeadphoneMic = this._isHeadphoneMic(selectedDevice.label);
                    this._updateDeviceUI(selectedDevice.label, isHeadphoneMic);
                }
            } else {
                // No specific device selected, likely using default
                const defaultDevice = this.availableDevices.find(device => device.deviceId === 'default' || device.deviceId === '');
                if (defaultDevice) {
                    const isHeadphoneMic = this._isHeadphoneMic(defaultDevice.label);
                    this._updateDeviceUI(defaultDevice.label, isHeadphoneMic);
                } else if (this.availableDevices.length > 0) {
                    // Just use the first available device if no default is identified
                    const firstDevice = this.availableDevices[0];
                    const isHeadphoneMic = this._isHeadphoneMic(firstDevice.label);
                    this._updateDeviceUI(firstDevice.label, isHeadphoneMic);
                } else {
                    this._updateDeviceUI('Default microphone', false);
                }
            }

            return this.availableDevices;
        } catch (error) {
            console.error('Error enumerating audio devices:', error);
            this._updateDeviceUI('Default microphone', false);
            // If device enumeration fails while DAF isn't running, ensure heartbeat is stopped
            try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
            return [];
        }
    }

    /**
     * Check if device label indicates it's a headphone microphone
     * @param {string} label - Device label to check
     * @returns {boolean} - True if it appears to be a headphone mic
     */
    _isHeadphoneMic(label) {
        if (!label) return false;
        const lowerLabel = label.toLowerCase();
        return lowerLabel.includes('headphone') ||
            lowerLabel.includes('headset') ||
            lowerLabel.includes('earphone') ||
            lowerLabel.includes('airpod') ||
            lowerLabel.includes('bluetooth');
    }

    /**
     * Update the device UI to show which microphone is being used
     * @param {string} deviceName - Name of the device to display
     * @param {boolean} isHeadphoneMic - Whether this is a headphone microphone
     */
    _updateDeviceUI(deviceName, isHeadphoneMic) {
        const deviceNameEl = document.getElementById('deviceName');
        const deviceIconEl = document.getElementById('deviceIcon');
        const deviceStatusEl = document.getElementById('deviceStatus');

        if (!deviceNameEl || !deviceIconEl || !deviceStatusEl) return;

        // Simplify the device name for displayw
        let displayName = deviceName || 'Default microphone';
        let lengthCutoff = 55;
        if (displayName.length > lengthCutoff) {
            displayName = displayName.substring(0, lengthCutoff) + '...';
        }

        // Update the name and icon
        deviceNameEl.textContent = displayName;
        deviceIconEl.textContent = isHeadphoneMic ? '🎧' : '🎙️';

        // Update the status class
        if (isHeadphoneMic) {
            deviceStatusEl.classList.add('headphone-mic');
        } else {
            deviceStatusEl.classList.remove('headphone-mic');
        }
    }

    /**
     * Select a specific audio input device by ID
     * @param {string} deviceId - The ID of the device to select
     * @returns {Promise<boolean>} - Success or failure
     */
    async selectAudioDevice(deviceId) {
        if (!deviceId) return false;

        // Store previous device ID for logging
        const previousDeviceId = this.selectedDeviceId;

        // If already running, try to pre-acquire the new device stream
        // during the user gesture, so the UA won't block getUserMedia.
        if (this.isAudioRunning) {
            console.log(`Switching from device ${previousDeviceId} to ${deviceId}`);
            try {
                const constraints = {
                    audio: {
                        echoCancellation: false,
                        autoGainControl: false,
                        noiseSuppression: false,
                        channelCount: 1,
                        latencyHint: 'interactive',
                        deviceId: { exact: deviceId }
                    }
                };

                // Call getUserMedia immediately (inside the click handler callstack)
                const preAcquiredStream = await navigator.mediaDevices.getUserMedia(constraints);

                // Pass the pre-acquired stream into the restart flow so we don't
                // trigger another getUserMedia after async awaits (which may be blocked).
                const restarted = await this.restartWithNewDevice(preAcquiredStream);
                if (restarted) {
                    // Only set as selected if restart succeeded
                    this.selectedDeviceId = deviceId;
                } else {
                    // revert selectedDeviceId on failure
                    this.selectedDeviceId = previousDeviceId;
                }
                return restarted;
            } catch (err) {
                console.error('Failed to acquire selected device stream:', err);
                // Give the user actionable feedback
                if (err && err.name === 'NotAllowedError') {
                    this._updateStatus('Microphone permission denied for that device', 'error');
                } else {
                    this._updateStatus('Could not switch microphone', 'error');
                }
                // revert selectedDeviceId on failure
                this.selectedDeviceId = previousDeviceId;
                try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
                return false;
            }
        }

        // If not running, simply update selectedDeviceId
        this.selectedDeviceId = deviceId;
        return true;

        return true;
    }

    /**
     * Restart the audio processing with a new input device
     * @returns {Promise<boolean>} - Success or failure
     */
    /**
     * Restart the audio processing with a new input device.
     * If `preAcquiredStream` is provided it will be used instead of calling
     * getUserMedia again (useful to keep the call inside a user gesture).
     * @returns {Promise<boolean>}
     */
    async restartWithNewDevice(preAcquiredStream = null) {
        try {
            // Save current configuration
            const currentConfig = { ...this.config };

            // Stop current processing and release previous microphone, but preserve the
            // visible session timer so device switches don't reset the timer display.
            await this.stop(true);


            // Small delay to ensure clean shutdown and release of previous mic
            await new Promise(resolve => setTimeout(resolve, 300));

            // Restore configuration
            this.config = currentConfig;

            // If a pre-acquired stream was provided, set it so initializeAudio
            // will reuse it instead of requesting permission again.
            if (preAcquiredStream) {
                this.audioStream = preAcquiredStream;
                this.micAccessGranted = true;
            }

            // Start with (possibly pre-acquired) new device
            await this.start();

            return true;
        } catch (error) {
            console.error('Error restarting with new device:', error);
            // Ensure heartbeat is stopped when a restart attempt fails
            try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
            return false;
        }
    }

    /**
     * Initialize device detection and handling for headphones
     */
    async initializeDeviceDetection() {
        // Make this idempotent so repeated start/stop cycles don't attach duplicate listeners
        if (this._deviceDetectionInitialized) return;

        // First enumeration
        await this.enumerateAudioDevices();

        // Set up device change listener
        this._onDeviceChange = async () => {
            console.log('Audio devices changed, re-enumerating...');

            // Only react to device changes if DAF is active
            if (this.isAudioRunning) {
                await this.enumerateAudioDevices();
            } else {
                console.log('DAF not active, ignoring microphone change');
            }
        };

        try {
            navigator.mediaDevices.addEventListener('devicechange', this._onDeviceChange);
        } catch (e) {
            // Some browsers may not support addEventListener on mediaDevices
            console.warn('Could not attach devicechange listener:', e);
            this._onDeviceChange = null;
        }

        // Monitor headphone connection events when supported
        if ('onheadphoneschange' in navigator) {
            this._onHeadphonesChange = async () => {
                console.log('Headphone connection state changed');

                // Only react to headphone changes if DAF is active
                if (this.isAudioRunning) {
                    await this.enumerateAudioDevices();
                } else {
                    console.log('DAF not active, ignoring headphone change');
                }
            };

            try {
                navigator.onheadphoneschange = this._onHeadphonesChange;
            } catch (e) {
                this._onHeadphonesChange = null;
            }
        }

        // Set up click handler for device switching
        const deviceStatusEl = document.getElementById('deviceStatus');
        if (deviceStatusEl) {
            deviceStatusEl.style.cursor = 'pointer'; // Show it's clickable

            // Add a hint to the title attribute
            deviceStatusEl.title = 'Click to cycle through available microphones';

            this._onDeviceStatusClick = () => { this.cycleToNextAudioDevice(); };
            deviceStatusEl.addEventListener('click', this._onDeviceStatusClick);
        }

        this._deviceDetectionInitialized = true;
    }

    /**
     * Cycle to the next available audio device in the list
     */
    async cycleToNextAudioDevice() {
        if (!this.micAccessGranted) {
            // If no microphone access yet, show a message
            this._updateStatus('Please start DAF first to access microphones', 'warning');
            return false;
        }

        if (this.availableDevices.length <= 1) {
            // If only one device is available, nothing to cycle through
            this._updateStatus('Only one microphone available', 'info');
            return false;
        }

        // Find current device index
        let currentIndex = -1;
        if (this.selectedDeviceId) {
            currentIndex = this.availableDevices.findIndex(device =>
                device.deviceId === this.selectedDeviceId);
        }

        // Get next device (or first if at end or not found)
        const nextIndex = currentIndex === -1 || currentIndex >= this.availableDevices.length - 1
            ? 0
            : currentIndex + 1;

        const nextDevice = this.availableDevices[nextIndex];
        const previousDevice = currentIndex >= 0 ? this.availableDevices[currentIndex] : null;

        console.log(`Switching from device ${previousDevice ? previousDevice.label : 'default'} to ${nextDevice.label}`);
        // Analytics: record device switches if analytics helper is present
        try {
            if (typeof window.sendAnalyticsEvent === 'function') {
                window.sendAnalyticsEvent('device_switch', {
                    from: previousDevice ? previousDevice.label : 'default',
                    to_device_name: nextDevice.label
                });
            }
        } catch (e) {
            // ignore analytics failures
        }

        // Try to select the device. If selection fails, don't overwrite UI.
        const switched = await this.selectAudioDevice(nextDevice.deviceId);
        if (switched) {
            const isHeadphoneMic = this._isHeadphoneMic(nextDevice.label);
            this._updateDeviceUI(nextDevice.label, isHeadphoneMic);

            // Show feedback to the user
            this._updateStatus(`Switched to: ${nextDevice.label}`, 'success');

            return true;
        } else {
            // Selection failed; inform the user and keep previous UI state
            this._updateStatus(`Failed to switch to: ${nextDevice.label}`, 'error');
            return false;
        }
    }

    /**
     * Destroy the SpeechProcessor instance: stop audio, remove event listeners,
     * stop timers and analytics, and clear internal references so the instance
     * can be GC'd.
     */
    async destroy() {
        // mark destroyed to avoid spurious reactions
        this._destroyed = true;

        try {
            await this.stop();
        } catch (e) {
            // ignore stop errors but ensure we continue cleanup
        }

        // Remove document-level handlers
        try { if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange); } catch (e) { /* ignore */ }
        try { if (this._onFreeze) document.removeEventListener('freeze', this._onFreeze); } catch (e) { /* ignore */ }
        try { if (this._onResume) document.removeEventListener('resume', this._onResume); } catch (e) { /* ignore */ }

        // Service worker
        try {
            if ('serviceWorker' in navigator && this._onServiceWorkerMessage && navigator.serviceWorker) {
                navigator.serviceWorker.removeEventListener('message', this._onServiceWorkerMessage);
            }
        } catch (e) { /* ignore */ }

        // Media devices
        try {
            if (this._onDeviceChange && navigator.mediaDevices && typeof navigator.mediaDevices.removeEventListener === 'function') {
                navigator.mediaDevices.removeEventListener('devicechange', this._onDeviceChange);
            }
        } catch (e) { /* ignore */ }

        // Headphones change
        try {
            if ('onheadphoneschange' in navigator && this._onHeadphonesChange) {
                if (navigator.onheadphoneschange === this._onHeadphonesChange) navigator.onheadphoneschange = null;
            }
        } catch (e) { /* ignore */ }

        // UI element click handler
        try {
            const deviceStatusEl = document.getElementById('deviceStatus');
            if (deviceStatusEl && this._onDeviceStatusClick) {
                deviceStatusEl.removeEventListener('click', this._onDeviceStatusClick);
            }
        } catch (e) { /* ignore */ }

        // Stop timers and analytics redundantly
        try { this._stopTimer(); } catch (e) { /* ignore */ }
        try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }

        // Clear stored handler references
        this._onVisibilityChange = null;
        this._onFreeze = null;
        this._onResume = null;
        this._onServiceWorkerMessage = null;
        this._onDeviceChange = null;
        this._onHeadphonesChange = null;
        this._onDeviceStatusClick = null;

        // Clear device detection state
        this._deviceDetectionInitialized = false;
        this.availableDevices = [];
        this.selectedDeviceId = null;

        console.log('SpeechProcessor destroyed');
    }
}

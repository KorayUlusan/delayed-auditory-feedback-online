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
        this.audioSuspendedByBackground = false;

        // Audio resume handling
        this.resumeAttempts = 0;
        this.maxResumeAttempts = 5;

        // Timer functionality
        this.timerInterval = null;
        this.startTime = 0;
        this.elapsedTime = 0;
        
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
            
            const isLocalFile = window.location.href.includes('file://');
            
            // Check if the error is related to AudioContext
            if (!isLocalFile && (
                error.name === 'NotSupportedError' || 
                error.message.includes('AudioContext') || 
                error.message.includes('audio') ||
                !window.AudioContext && !window.webkitAudioContext)) {
                this._updateStatus('Sorry, we don\'t support your browser yet.', 'error');
            } else {
                this._updateStatus(`Error: ${error.message}`, 'error');
            }
            
            return false;
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
                try {
                    if (typeof this.updateGain === 'function') {
                        this.updateGain(this.config.gain);
                    }
                    if (typeof this.updateDelayTime === 'function') {
                        this.updateDelayTime(this.config.delayTime);
                    }
                } catch (e) {
                    console.warn('Failed to apply initial gain/delay settings:', e);
                }
            }

            this._updateStatus('Speech Processing Active', 'success');
            this._updateUIControls(true);
            this._startTimer();
        }
    }

    async stop() {
        this._stopAudioStream();
        await this._closeAudioContext();
        this._resetAudioState();

        // Reset mic access flag when stopping DAF
        this.micAccessGranted = false;
        
        // Reset device UI to show microphone is no longer in use
        this._updateDeviceUI('Click "Start DAF" to select your microphone', false);

        this._updateStatus('Speech Processing Stopped', 'warning');
        this._updateUIControls(false);
        this._stopTimer();
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
            displayName = displayName.substring(0,lengthCutoff) + '...';
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
        
        // Update the selected device ID
        this.selectedDeviceId = deviceId;
        
        // If already running, properly close previous connection and restart
        if (this.isAudioRunning) {
            console.log(`Switching from device ${previousDeviceId} to ${deviceId}`);
            return await this.restartWithNewDevice();
        }
        
        return true;
    }
    
    /**
     * Restart the audio processing with a new input device
     * @returns {Promise<boolean>} - Success or failure
     */
    async restartWithNewDevice() {
        try {
            // Save current configuration
            const currentConfig = { ...this.config };
            
            // Stop current processing and release previous microphone
            await this.stop();
            
            // Small delay to ensure clean shutdown and release of previous mic
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Restore configuration
            this.config = currentConfig;
            
            // Start with new device
            await this.start();
            
            return true;
        } catch (error) {
            console.error('Error restarting with new device:', error);
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
        navigator.mediaDevices.addEventListener('devicechange', async () => {
            console.log('Audio devices changed, re-enumerating...');
            
            // Only react to device changes if DAF is active
            if (this.isAudioRunning) {
                await this.enumerateAudioDevices();
            } else {
                console.log('DAF not active, ignoring microphone change');
            }
        });
        
        // Monitor headphone connection events when supported
        if ('onheadphoneschange' in navigator) {
            navigator.onheadphoneschange = async () => {
                console.log('Headphone connection state changed');
                
                // Only react to headphone changes if DAF is active
                if (this.isAudioRunning) {
                    await this.enumerateAudioDevices();
                } else {
                    console.log('DAF not active, ignoring headphone change');
                }
            };
        }
        
        // Set up click handler for device switching
        const deviceStatusEl = document.getElementById('deviceStatus');
        if (deviceStatusEl) {
            deviceStatusEl.style.cursor = 'pointer'; // Show it's clickable
            
            // Add a hint to the title attribute
            deviceStatusEl.title = 'Click to cycle through available microphones';
            
            deviceStatusEl.addEventListener('click', () => {
                this.cycleToNextAudioDevice();
            });
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
            if (typeof window.sendGtagEvent === 'function') {
                window.sendGtagEvent('device_switch', {
                    from: previousDevice ? previousDevice.label : 'default',
                    to: nextDevice.label
                });
            }
        } catch (e) {
            // ignore analytics failures
        }
        
        // Select and display the device - this will handle closing the previous mic connection
        await this.selectAudioDevice(nextDevice.deviceId);
        const isHeadphoneMic = this._isHeadphoneMic(nextDevice.label);
        this._updateDeviceUI(nextDevice.label, isHeadphoneMic);
        
        // Show feedback to the user
        this._updateStatus(`Switched to: ${nextDevice.label}`, 'success');
        
        return true;
    }
}

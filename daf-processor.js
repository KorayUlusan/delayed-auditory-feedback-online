// Delayed Auditory Feedback (DAF) Module
class SpeechProcessor {
    constructor() {
        // Core audio processing components
        this.audioContext = null;
        this.audioStream = null;
        this.audioNodes = {
            source: null,
            gainNode: null,
            delayNode: null,
        };

        // Auditory Feedback configuration
        this.config = {
            delayTime: 200,        // ms, optimal for speech DAF
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
        // Measured round-trip floor in milliseconds (input + output)
        this.measuredFloorMs = null;

        // Add event listeners for visibility and freeze/resume events
        this._setupEventListeners();

        // Initialize device status UI with default values (no permissions yet)
        this._updateDeviceUI('Click "Start DAF" to select your microphone', false);
    }

    // ---------------------------------------------------------------------------
    // ERROR CLASSIFICATION
    // ---------------------------------------------------------------------------

    /**
     * Map a getUserMedia / AudioContext error to a short, actionable string
     * and a Sentry fingerprint tag so similar errors group correctly.
     *
     * Covers every error class seen in the Sentry dashboard:
     *   - NotAllowedError  (permission denied by user OR by OS/system)
     *   - NotAllowedError  (permission prompt dismissed)
     *   - NotAllowedError  (iOS "No AVAudioSessionCaptureDevice device")
     *   - NotFoundError    (requested device not found / unplugged)
     *   - Generic fallback
     *
     * @param {Error} error
     * @returns {{ message: string, tag: string }}
     */
    _classifyMicError(error) {
        const name = error?.name ?? '';
        const message = (error?.message ?? '').toLowerCase();

        // ── OS-level block (macOS/Windows privacy settings, managed devices) ───
        // Sentry: "Permission denied by system"
        if (name === 'NotAllowedError' && message.includes('system')) {
            return {
                tag: 'permission_denied_system',
                message:
                    'Your operating system is blocking microphone access. ' +
                    'Please check your system privacy settings ' + 
                    '(macOS: System Settings → Privacy & Security → Microphone; ' +
                    'Windows: Settings → Privacy → Microphone) and allow access, then try again.',
            };
        }

        // ── iOS / Safari: no capture device available ──────────────────────────
        // Sentry: "No AVAudioSessionCaptureDevice device"
        if (name === 'NotAllowedError' && message.includes('avaudiosession')) {
            return {
                tag: 'permission_denied_ios_no_device',
                message:
                    'No microphone was found on your device. ' +
                    'Please plug in a headset or enable microphone access in ' +
                    'Settings → Safari → Microphone, then try again.',
            };
        }

        // ── User dismissed the permission prompt (didn't explicitly deny) ──────
        // Sentry: "Permission dismissed"
        if (name === 'NotAllowedError' && message.includes('dismiss')) {
            return {
                tag: 'permission_dismissed',
                message:
                    'Microphone access was dismissed. ' +
                    'Please tap "Start DAF" again and click "Allow" when prompted.',
            };
        }

        // ── User (or browser policy) explicitly denied permission ──────────────
        // Sentry: "Permission denied", "The request is not allowed by the user agent…"
        if (
            name === 'NotAllowedError' ||
            name === 'PermissionDeniedError' ||
            message.includes('not allowed') ||
            message.includes('denied')
        ) {
            return {
                tag: 'permission_denied_user',
                message:
                    'Microphone access was denied. ' +
                    'Please click the 🔒 / 🎙️ icon in your browser\'s address bar, ' +
                    'set Microphone to "Allow", refresh the page, and try again.',
            };
        }

        // ── Device not found (unplugged, switched off, wrong ID) ───────────────
        // Sentry: "Requested device not found"
        if (name === 'NotFoundError' || message.includes('not found') || message.includes('device')) {
            return {
                tag: 'device_not_found',
                message:
                    'The selected microphone could not be found. ' +
                    'It may have been unplugged. Please check your microphone ' +
                    'connection and try again.',
            };
        }

        // ── Fallback ───────────────────────────────────────────────────────────
        return {
            tag: 'unknown',
            message:
                'Could not access your microphone. ' +
                'Please make sure a microphone is connected and this page has ' +
                'permission to use it, then try again.',
        };
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
            } else if (this.audioStream && this.micAccessGranted) {
                // Reuse an already-set stream (e.g. from restartWithNewDevice)
            } else {
                await this._requestMicrophoneAccess();
            }

            this._createAudioContext();
            this._createAudioNodes();
            this._connectAudioNodes();

            this.isAudioRunning = true;
            return true;
        } catch (error) {
            console.error('Speech Processor Initialization Error:', error);

            // Classify the error before reporting / displaying it
            const classified = this._classifyMicError(error);

            if (window.Sentry) {
                Sentry.captureException(error, {
                    tags: {
                        mechanism: 'audio_init',
                        mic_error_type: classified.tag,
                        secure_context: window.isSecureContext
                    },
                    extra: {
                        audioContextState: this.audioContext ? this.audioContext.state : 'not_initialized',
                        requestedDeviceId: this.selectedDeviceId,
                        availableDeviceCount: this.availableDevices.length,
                        preAcquired: !!preAcquiredStream,
                        hasUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
                    }
                });
            }

            window.sendAnalyticsEvent('daf_initialization_error', {
                event_category: 'DAF',
                event_label: classified.tag,
                error_message: error.message || 'No message'
            });

            // Ensure analytics heartbeat is stopped when initialization fails
            try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }

            const isLocalFile = window.location.href.includes('file://');

            // AudioContext not supported at all
            if (!isLocalFile && (
                error.name === 'NotSupportedError' ||
                error.message?.includes('AudioContext') ||
                (!window.AudioContext && !window.webkitAudioContext)
            )) {
                this._updateStatus(
                    "Sorry, your browser doesn't support audio processing. " +
                    "Please try Chrome, Edge, or Safari.",
                    'error'
                );
            } else {
                // Use the human-readable classified message for everything else
                this._updateStatus(classified.message, 'error');
            }

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

            // Apply current config to live nodes (values may have changed before start)
            try {
                this.updateGain(this.config.gain);
                this.updateDelayTime(this.config.delayTime);
            } catch (e) {
                console.warn('Failed to apply initial config to nodes:', e);
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
        if (!preserveTimer) this._stopTimer();
        this._stopAnalyticsHeartbeat();
    }

    // AUDIO SETUP METHODS

    async _requestMicrophoneAccess() {
        try {
            let constraints = {
                audio: {
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                    channelCount: 1,
                    deviceId: this.selectedDeviceId ? { exact: this.selectedDeviceId } : undefined
                }
            };

            this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.micAccessGranted = true;

            const audioTrack = this.audioStream.getAudioTracks()[0];
            const settings = audioTrack.getSettings();

            if (audioTrack && window.Sentry) {
                try {
                    Sentry.configureScope((scope) => {
                        scope.setContext("mic_settings", {
                            autoGainControl: settings?.autoGainControl,
                            echoCancellation: settings?.echoCancellation,
                            noiseSuppression: settings?.noiseSuppression,
                            sampleRate: settings?.sampleRate,
                            label: audioTrack?.label
                        });
                    });
                } catch (e) {
                    console.warn("Failed to log mic settings to Sentry", e);
                }
            }
            console.log('Selected microphone settings:', settings);

            this.deviceSampleRate = settings.sampleRate;

            try {
                if (settings && settings.deviceId) {
                    this.selectedDeviceId = settings.deviceId;
                }
                const trackLabel = audioTrack.label || (settings && settings.label) || '';
                this.currentDeviceName = trackLabel || 'Default microphone';
                const isHeadphone = this._isHeadphoneMic(trackLabel);
                this._updateDeviceUI(this.currentDeviceName, isHeadphone);
            } catch (e) {
                console.warn('Could not determine active device id/label:', e);
            }

            return this.audioStream;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            // Re-throw so initializeAudio can classify and display the right message
            throw error;
        }
    }

    _createAudioContext() {
        const contextOptions = {
            latencyHint: 0,
        };
        if (this.deviceSampleRate && Number.isFinite(this.deviceSampleRate)) {
            contextOptions.sampleRate = this.deviceSampleRate;
        }
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);
        this.audioContext.addEventListener('statechange', this._handleAudioContextStateChange.bind(this));
    }

    _createAudioNodes() {
        const ctx = this.audioContext;
        const nodes = this.audioNodes;

        nodes.source = ctx.createMediaStreamSource(this.audioStream);
        nodes.gainNode = ctx.createGain();

        const minDelay = 0.000001;
        nodes.delayNode = ctx.createDelay(0.5);
        nodes.delayNode.delayTime.value = Math.max(minDelay, this.config.delayTime / 1000);
    }

    _connectAudioNodes() {
        const nodes = this.audioNodes;
        nodes.source.connect(nodes.delayNode);
        nodes.delayNode.connect(nodes.gainNode);
        nodes.gainNode.connect(this.audioContext.destination);
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
            this._disconnectAllNodes();
            try {
                if (this.audioContext.state !== 'closed') {
                    await this.audioContext.close();
                    console.log('Audio context closed successfully');
                }
            } catch (error) {
                console.error('Error closing audio context:', error);
            }
            this.audioContext = null;
            try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
        }
    }

    _resetAudioState() {
        this.audioContext = null;
        this.deviceSampleRate = null;
        Object.keys(this.audioNodes).forEach(key => {
            this.audioNodes[key] = null;
        });
        this.isAudioRunning = false;
        this.audioSuspendedByBackground = false;
        this.resumeAttempts = 0;
        try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
    }

    // EVENT HANDLERS

    _setupEventListeners() {
        this._onVisibilityChange = this._handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this._onVisibilityChange);

        if ('onfreeze' in document) {
            this._onFreeze = this._handleFreeze.bind(this);
            document.addEventListener('freeze', this._onFreeze);
        }

        if ('onresume' in document) {
            this._onResume = this._handleResume.bind(this);
            document.addEventListener('resume', this._onResume);
        }
    }

    _handleAudioContextStateChange() {
        if (!this.audioContext) return;

        if (this.audioContext.state === 'running') {
            try {
                const outputMs = ((this.audioContext.baseLatency ?? 0) + (this.audioContext.outputLatency ?? 0)) * 1000;
                let inputMs = 0;
                try {
                    const track = this.audioStream?.getAudioTracks?.()[0];
                    const settings = track?.getSettings?.();
                    if (settings?.latency) inputMs = settings.latency * 1000;
                } catch (e) { /* ignore */ }

                const totalMs = (inputMs || 0) + (outputMs || 0);
                this.measuredFloorMs = totalMs;

                console.log(
                    `Latency floor: ${outputMs.toFixed(1)}ms (output)` +
                    (inputMs ? ` + ${inputMs.toFixed(1)}ms (input)` : ' + 0 (input latency unknown)') +
                    ` = ${totalMs.toFixed(1)}ms total`
                );

                if (totalMs > 25) {
                    console.warn(`Round-trip floor ${totalMs.toFixed(1)}ms exceeds 25ms threshold — slap-back likely at low delay settings`);
                }
            } catch (e) { /* ignore */ }
        }

        this._notifyServiceWorker('AUDIO_STATE', this.audioContext.state);

        if (this.audioContext.state === 'suspended' && this.isAppVisible && this.isAudioRunning) {
            this._attemptResumeAudio();
        }
    }

    _handleVisibilityChange() {
        const isVisible = document.visibilityState === 'visible';
        this.isAppVisible = isVisible;
        if (window.Sentry) {
            Sentry.addBreadcrumb({
                category: 'ui.lifecycle',
                message: `Visibility changed to ${document.visibilityState}`,
                level: 'info'
            });
        }

        this._notifyServiceWorker('VISIBILITY_CHANGE', { isVisible });

        if (isVisible) {
            if (this.isAudioRunning && this.audioContext && this.audioContext.state === 'suspended') {
                this._attemptResumeAudio();
            }
        } else {
            if (this.audioContext && this.audioContext.state === 'running') {
                this.audioSuspendedByBackground = true;
            }
        }
    }

    _handleFreeze() {
        if (this.audioContext && this.audioContext.state === 'running') {
            this.audioSuspendedByBackground = true;
        }
    }

    _handleResume() {
        if (this.isAudioRunning && this.audioContext && this.audioContext.state === 'suspended') {
            this._attemptResumeAudio();
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
            if (this.resumeAttempts > 1 && window.Sentry) {
                Sentry.captureMessage("Audio resumed after multiple attempts", {
                    level: "warning",
                    extra: { attempts: this.resumeAttempts }
                });
            }
            if (this.resumeAttempts < this.maxResumeAttempts) {
                const delay = Math.pow(2, this.resumeAttempts) * 100;
                setTimeout(() => this._attemptResumeAudio(), delay);
            } else {
                this._updateStatus('Audio paused — tap to resume', 'error');
                try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
                return false;
            }
        }
    }

    _notifyServiceWorker(type, data) {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type, ...data });
        }
    }

    // USER PARAMETER CONTROL METHODS

    updateDelayTime(value) {
        this.config.delayTime = value;

        if (!this.audioContext || !this.audioNodes.delayNode) return;

        const minDelay = 0.000001;
        const actualDelay = value <= 0 ? minDelay : value / 1000;

        this.audioNodes.delayNode.delayTime.setValueAtTime(
            actualDelay,
            this.audioContext.currentTime
        );

        const floor = this.measuredFloorMs ?? 0;
        if (floor > 5) {
            const effective = Math.round(value + floor);
            this._updateUIDisplay('delayValue', `${value} ms (~${effective} ms effective)`);
        } else {
            this._updateUIDisplay('delayValue', `${value} ms`);
        }
    }

    updateGain(value) {
        this.config.gain = value;

        if (!this.audioContext || !this.audioNodes.gainNode) return;

        this.audioNodes.gainNode.gain.setValueAtTime(
            value,
            this.audioContext.currentTime
        );

        this._updateUIDisplay('inputGainValue', `${value}x`);
    }

    updateInputGain(value) {
        this.updateGain(value);
    }

    // UI METHODS

    _updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('statusMessage');
        if (!statusElement) return;

        statusElement.textContent = message;

        statusElement.classList.remove('status-success', 'status-error', 'status-warning', 'status-default', 'status-loading');
        const classMap = {
            success: 'status-success',
            error: 'status-error',
            loading: 'status-loading',
            warning: 'status-warning'
        };
        statusElement.classList.add(classMap[type] || 'status-default');
    }

    _updateUIDisplay(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) element.textContent = value;
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

        this.startTime = Date.now();
        this.elapsedTime = 0;
        timerElement.textContent = '00:00';
        timerElement.classList.add('timer-running');

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
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        const timerElement = document.getElementById('dafTimer');
        if (timerElement) timerElement.classList.remove('timer-running');
    }

    // ANALYTICS HEARTBEAT METHODS

    _startAnalyticsHeartbeat() {
        if (this.analyticsIntervalId) return;
        if (!this.isAudioRunning) return;

        const sendEvent = () => {
            try {
                if (!this.isAudioRunning) return;
                if (!this.audioContext || this.audioContext.state !== 'running') return;
                if (!this.audioNodes || !this.audioStream) return;

                if (this.audioNodes.gainNode?.gain) {
                    const gainVal = this.audioNodes.gainNode.gain.value;
                    if (typeof gainVal === 'number' && gainVal <= 0) return;
                }

                if (this.audioStream?.getAudioTracks) {
                    const anyEnabled = this.audioStream.getAudioTracks().some(t => t.enabled !== false);
                    if (!anyEnabled) return;
                }

                const elapsedSeconds = Math.floor(this.elapsedTime / 1000);

                if (typeof window.sendAnalyticsEvent === 'function') {
                    window.sendAnalyticsEvent('daf_active', {
                        event_category: 'DAF',
                        event_label: 'heartbeat',
                        daf_usage_s: elapsedSeconds
                    });
                }
            } catch (e) {
                console.warn('Analytics heartbeat failed:', e);
            }
        };

        this.analyticsIntervalId = setInterval(sendEvent, this.analyticsIntervalMs);
    }

    _stopAnalyticsHeartbeat() {
        if (this.analyticsIntervalId) {
            clearInterval(this.analyticsIntervalId);
            this.analyticsIntervalId = null;
        }
    }

    // DEVICE SELECTION METHODS

    async enumerateAudioDevices() {
        try {
            let tempStream = null;
            if (!this.micAccessGranted) {
                try {
                    tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                } catch (permErr) {
                    console.warn('Temporary getUserMedia failed during device enumeration:', permErr);
                }
            }

            const devices = await navigator.mediaDevices.enumerateDevices();

            if (tempStream) {
                try {
                    tempStream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* ignore */ } });
                } catch (e) { /* ignore */ }
                tempStream = null;
            }

            this.availableDevices = devices.filter(device => device.kind === 'audioinput');
            console.log('Available audio input devices:', this.availableDevices);

            const headphoneMic = this.availableDevices.find(device => {
                const label = (device.label || '').toLowerCase();
                const isBluetooth = label.includes('bluetooth') || label.includes('airpod');
                if (isBluetooth) return false;
                return label.includes('headphone') || label.includes('headset') || label.includes('earphone');
            });

            if (headphoneMic && (!this.selectedDeviceId || this.selectedDeviceId !== headphoneMic.deviceId)) {
                this.selectedDeviceId = headphoneMic.deviceId;
                console.log('Auto-selected headphone microphone:', headphoneMic.label);
                this._updateDeviceUI(headphoneMic.label, true);
                if (this.isAudioRunning) await this.restartWithNewDevice();
            } else if (this.selectedDeviceId) {
                const selectedDevice = this.availableDevices.find(d => d.deviceId === this.selectedDeviceId);
                if (selectedDevice) {
                    this._updateDeviceUI(selectedDevice.label, this._isHeadphoneMic(selectedDevice.label));
                }
            } else {
                const defaultDevice = this.availableDevices.find(d => d.deviceId === 'default' || d.deviceId === '');
                if (defaultDevice) {
                    this._updateDeviceUI(defaultDevice.label, this._isHeadphoneMic(defaultDevice.label));
                } else if (this.availableDevices.length > 0) {
                    const firstDevice = this.availableDevices[0];
                    this._updateDeviceUI(firstDevice.label, this._isHeadphoneMic(firstDevice.label));
                } else {
                    this._updateDeviceUI('Default microphone', false);
                }
            }

            return this.availableDevices;
        } catch (error) {
            console.error('Error enumerating audio devices:', error);
            this._updateDeviceUI('Default microphone', false);
            try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
            return [];
        }
    }

    _isHeadphoneMic(label) {
        if (!label) return false;
        const l = label.toLowerCase();
        if (l.includes('bluetooth') || l.includes('airpod')) return false;
        return l.includes('headphone') || l.includes('headset') || l.includes('earphone');
    }

    _updateDeviceUI(deviceName, isHeadphoneMic) {
        const deviceNameEl = document.getElementById('deviceName');
        const deviceIconEl = document.getElementById('deviceIcon');
        const deviceStatusEl = document.getElementById('deviceStatus');

        if (!deviceNameEl || !deviceIconEl || !deviceStatusEl) return;

        const raw = deviceName || 'Default microphone';
        deviceNameEl.textContent = raw.length > 55 ? raw.slice(0, 55) + '…' : raw;
        deviceIconEl.textContent = isHeadphoneMic ? '🎧' : '🎙️';

        if (isHeadphoneMic) {
            deviceStatusEl.classList.add('headphone-mic');
        } else {
            deviceStatusEl.classList.remove('headphone-mic');
        }
    }

    async selectAudioDevice(deviceId) {
        if (!deviceId) return false;

        const previousDeviceId = this.selectedDeviceId;

        if (this.isAudioRunning) {
            console.log(`Switching from device ${previousDeviceId} to ${deviceId}`);
            try {
                const constraints = {
                    audio: {
                        echoCancellation: false,
                        autoGainControl: false,
                        noiseSuppression: false,
                        channelCount: 1,
                        deviceId: { exact: deviceId }
                    }
                };

                const preAcquiredStream = await navigator.mediaDevices.getUserMedia(constraints);
                const restarted = await this.restartWithNewDevice(preAcquiredStream);

                if (restarted) {
                    this.selectedDeviceId = deviceId;
                } else {
                    this.selectedDeviceId = previousDeviceId;
                }
                return restarted;
            } catch (err) {
                console.error('Failed to acquire selected device stream:', err);
                const { message } = this._classifyMicError(err);
                this._updateStatus(message, 'error');
                this.selectedDeviceId = previousDeviceId;
                try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
                return false;
            }
        }

        this.selectedDeviceId = deviceId;
        return true;
    }

    async restartWithNewDevice(preAcquiredStream = null) {
        try {
            const currentConfig = { ...this.config };
            await this.stop(true);
            await new Promise(resolve => setTimeout(resolve, 300));

            this.config = currentConfig;

            if (preAcquiredStream) {
                this.audioStream = preAcquiredStream;
                this.micAccessGranted = true;
            }

            await this.start();

            try { this._startAnalyticsHeartbeat(); } catch (e) { /* ignore */ }

            try {
                const timerEl = document.getElementById('dafTimer');
                if (timerEl) {
                    this.startTime = Date.now() - (this.elapsedTime || 0);
                    if (!this.timerInterval) {
                        timerEl.classList.add('timer-running');
                        this.timerInterval = setInterval(() => {
                            this.elapsedTime = Date.now() - this.startTime;
                            const s = Math.floor(this.elapsedTime / 1000);
                            timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
                        }, 1000);
                    }
                }
            } catch (e) { /* ignore */ }

            return true;
        } catch (error) {
            console.error('Error restarting with new device:', error);
            try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }
            return false;
        }
    }

    async initializeDeviceDetection() {
        if (this._deviceDetectionInitialized) return;

        await this.enumerateAudioDevices();

        this._onDeviceChange = async () => {
            console.log('Audio devices changed, re-enumerating…');
            if (this.isAudioRunning) {
                await this.enumerateAudioDevices();
            } else {
                console.log('DAF not active, ignoring microphone change');
            }
        };

        try {
            navigator.mediaDevices.addEventListener('devicechange', this._onDeviceChange);
        } catch (e) {
            console.warn('Could not attach devicechange listener:', e);
            this._onDeviceChange = null;
        }

        if ('onheadphoneschange' in navigator) {
            this._onHeadphonesChange = async () => {
                console.log('Headphone connection state changed');
                if (this.isAudioRunning) {
                    await this.enumerateAudioDevices();
                }
            };
            try {
                navigator.onheadphoneschange = this._onHeadphonesChange;
            } catch (e) {
                this._onHeadphonesChange = null;
            }
        }

        this._deviceDetectionInitialized = true;
    }

    async cycleToNextAudioDevice() {
        if (!this.micAccessGranted) {
            this._updateStatus('Please start DAF first to access microphones', 'warning');
            return false;
        }

        if (this.availableDevices.length <= 1) {
            this._updateStatus('Only one microphone available', 'info');
            return false;
        }

        let currentIndex = -1;
        if (this.selectedDeviceId) {
            currentIndex = this.availableDevices.findIndex(d => d.deviceId === this.selectedDeviceId);
        }

        const nextIndex = currentIndex === -1 || currentIndex >= this.availableDevices.length - 1
            ? 0
            : currentIndex + 1;

        const nextDevice = this.availableDevices[nextIndex];
        const previousDevice = currentIndex >= 0 ? this.availableDevices[currentIndex] : null;

        console.log(`Switching from ${previousDevice?.label ?? 'default'} to ${nextDevice.label}`);

        try {
            if (typeof window.sendAnalyticsEvent === 'function') {
                window.sendAnalyticsEvent('device_switch', {
                    from: previousDevice ? previousDevice.label : 'default',
                    to_device_name: nextDevice.label
                });
            }
        } catch (e) { /* ignore */ }

        const switched = await this.selectAudioDevice(nextDevice.deviceId);
        if (switched) {
            this._updateDeviceUI(nextDevice.label, this._isHeadphoneMic(nextDevice.label));
            this._updateStatus(`Switched to: ${nextDevice.label}`, 'success');
            return true;
        } else {
            // selectAudioDevice already showed the classified error message
            return false;
        }
    }

    async destroy() {
        this._destroyed = true;

        try { await this.stop(); } catch (e) { /* ignore */ }

        try { if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange); } catch (e) { /* ignore */ }
        try { if (this._onFreeze) document.removeEventListener('freeze', this._onFreeze); } catch (e) { /* ignore */ }
        try { if (this._onResume) document.removeEventListener('resume', this._onResume); } catch (e) { /* ignore */ }

        try {
            if (this._onDeviceChange && navigator.mediaDevices?.removeEventListener) {
                navigator.mediaDevices.removeEventListener('devicechange', this._onDeviceChange);
            }
        } catch (e) { /* ignore */ }

        try {
            if ('onheadphoneschange' in navigator && this._onHeadphonesChange) {
                if (navigator.onheadphoneschange === this._onHeadphonesChange) navigator.onheadphoneschange = null;
            }
        } catch (e) { /* ignore */ }

        try { this._stopTimer(); } catch (e) { /* ignore */ }
        try { this._stopAnalyticsHeartbeat(); } catch (e) { /* ignore */ }

        this._onVisibilityChange = null;
        this._onFreeze = null;
        this._onResume = null;
        this._onDeviceChange = null;
        this._onHeadphonesChange = null;

        this._deviceDetectionInitialized = false;
        this.availableDevices = [];
        this.selectedDeviceId = null;

        console.log('SpeechProcessor destroyed');
    }
}
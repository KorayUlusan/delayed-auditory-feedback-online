// app.js - Main application logic for DAF Online

// Register service worker for PWA support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch(err => console.log('Service Worker registration failed:', err));
    });
}

// Wake Lock variable to store reference
let wakeLock = null;

// NOTE: analytics should be sent via `window.sendAnalyticsEvent` only.
// Other helpers were removed to enforce a single analytics surface.

// Lazy-load the speech processor script when needed to avoid blocking initial load
function loadSpeechProcessorScript() {
    return new Promise((resolve, reject) => {
        if (window.SpeechProcessor) return resolve();

        const existing = document.querySelector('script[data-daf-processor]');
        if (existing) {
            // If the script element is present, check if it has already loaded.
            // Some browsers won't re-fire the load event for listeners added after
            // the event occurred, so use a flag attribute to detect that.
            if (existing.getAttribute('data-loaded') === '1' || typeof window.SpeechProcessor !== 'undefined') {
                return resolve();
            }

            existing.addEventListener('load', () => {
                existing.setAttribute('data-loaded', '1');
                resolve();
            });
            existing.addEventListener('error', (e) => reject(e));
            return;
        }

        const script = document.createElement('script');
        script.src = 'daf-processor.js';
        script.async = true;
        script.setAttribute('data-daf-processor', '1');
        script.onload = () => {
            script.setAttribute('data-loaded', '1');
            resolve();
        };
        script.onerror = (e) => reject(e);
        document.body.appendChild(script);
    });
}

// Function to request wake lock
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock is active');

            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock was released');
                wakeLock = null;
            });
        } else {
            console.log('Wake Lock API not supported in this browser');
        }
    } catch (err) {
        console.error(`Failed to request Wake Lock: ${err.message}`);
    }
}

// Function to release wake lock
function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release()
            .then(() => {
                console.log('Wake Lock released by function call');
                wakeLock = null;
            })
            .catch((err) => {
                console.error(`Error releasing Wake Lock: ${err.message}`);
            });
    }
}

// Handle page visibility changes
document.addEventListener('visibilitychange', function () {
    const isVisible = document.visibilityState === 'visible';
    console.log(`Page visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
    // Report visibility changes to analytics
    if (typeof window.sendAnalyticsEvent === 'function') {
        window.sendAnalyticsEvent('page_visibility', { visibility: isVisible ? 'visible' : 'hidden' });
    }

    // If page is visible and we have active audio that's suspended, try to resume it
    if (isVisible && window.speechProcessor &&
        window.speechProcessor.audioContext &&
        window.speechProcessor.audioContext.state === 'suspended') {

        console.log('Attempting to resume audio context after visibility change');
        window.speechProcessor._attemptResumeAudio();
    }

    // Re-request wake lock if it was released due to page becoming hidden
    if (isVisible && window.speechProcessor && window.speechProcessor.isAudioRunning && !wakeLock) {
        console.log('Page visible again, re-requesting wake lock');
        requestWakeLock();
    }
});

// Handle page unload/closing
window.addEventListener('beforeunload', function () {
    // Stop audio processing if running before the page closes
    if (window.speechProcessor && window.speechProcessor.isAudioRunning) {
        window.speechProcessor.stop();
    }

    // Release wake lock when page is closed
    releaseWakeLock();
    // Log session end
    if (typeof window.sendAnalyticsEvent === 'function') {
        window.sendAnalyticsEvent('session_end');
    }
});

// Functions to handle UI controls and pass values to the speech processor
function updateDelayTime(value) {
    document.getElementById('delayValue').textContent = `${value} ms`;
    if (window.speechProcessor && typeof window.speechProcessor.updateDelayTime === 'function') {
        window.speechProcessor.updateDelayTime(value);
    }
}

function updateInputGain(value) {
    document.getElementById('inputGainValue').textContent = `${value}x`;
    if (window.speechProcessor && typeof window.speechProcessor.updateInputGain === 'function') {
        window.speechProcessor.updateInputGain(value);
    }
}

// Create a document-level tap handler to help resume audio on iOS
document.addEventListener('click', function () {
    if (window.speechProcessor &&
        window.speechProcessor.audioContext &&
        window.speechProcessor.audioContext.state === 'suspended' &&
        window.speechProcessor.isAudioRunning) {

        console.log('Document clicked, attempting to resume audio context');
        window.speechProcessor._attemptResumeAudio();
    }
});

// Make toggleDAF function globally available for HTML onclick attribute
window.toggleDAF = async function (button) {
    const isStarting = button.textContent === 'Start DAF';

    // Track DAF button click via canonical analytics API
    if (typeof window.sendAnalyticsEvent === 'function') {
        window.sendAnalyticsEvent(isStarting ? 'start_daf' : 'stop_daf', {
            event_category: 'user_action',
            event_label: isStarting ? 'DAF Started' : 'DAF Stopped'
        });
    }
    console.log(`DAF ${isStarting ? 'start' : 'stop'} event tracked`);

    // Prevent creating multiple instances or starting multiple times
    if (isStarting) {
        if (window.speechProcessor && window.speechProcessor.isAudioRunning) {
            console.log('DAF is already running, ignoring start request');
            return;
        }

        // Lazy start flow: load processor script if needed, then instantiate and start
        const startWithProcessor = async () => {
            console.log('startWithProcessor: begin');
            try {
                if (!window.SpeechProcessor) {
                    console.log('startWithProcessor: loading daf-processor.js');
                    await loadSpeechProcessorScript();
                    console.log('startWithProcessor: daf-processor.js loaded');
                }
            } catch (err) {
                console.error('Failed to load DAF processor:', err);
                return;
            }

            console.log('startWithProcessor: creating SpeechProcessor instance');
            try {
                window.speechProcessor = new SpeechProcessor();
            } catch (e) {
                console.error('Failed to construct SpeechProcessor instance:', e);
                return;
            }
            console.log('startWithProcessor: SpeechProcessor instance created');

            // Initialize with current slider values before starting
            const delayValue = document.getElementById('delaySlider').value;
            const inputGainValue = document.getElementById('inputGainSlider').value;

            window.speechProcessor.config.delayTime = delayValue;
            window.speechProcessor.config.inputGain = inputGainValue;

            // Request wake lock when starting DAF
            console.log('startWithProcessor: requesting wake lock');
            requestWakeLock();

            // Start the speech processor and await completion so we can resume the
            // audio context immediately in the same user gesture path if needed.
            try {
                console.log('startWithProcessor: calling start()');
                // Inform the user that we're beginning the audio connection
                try {
                    if (window.speechProcessor && typeof window.speechProcessor._updateStatus === 'function') {
                        window.speechProcessor._updateStatus('Starting audio connection...', 'info');
                    }
                } catch (e) {
                    console.warn('Failed to set starting status message:', e);
                }
                await window.speechProcessor.start();
                console.log('startWithProcessor: start() completed');

                // Some browsers leave the newly-created AudioContext in a suspended
                // state unless resumed directly from a user gesture. Attempt to resume
                // deterministically here.
                if (window.speechProcessor.audioContext &&
                    window.speechProcessor.audioContext.state === 'suspended') {
                    try {
                        await window.speechProcessor._attemptResumeAudio();
                    } catch (e) {
                        console.warn('AudioContext resume attempt failed:', e);
                    }
                }
            } catch (startErr) {
                console.error('Failed to start speech processor:', startErr);
            }

            // Initialize device detection to automatically find headphone microphones
            window.speechProcessor.initializeDeviceDetection().then(() => {
                console.log('Audio device detection initialized');
                // Inform the user that we're beginning the audio connection
                try {
                    if (window.speechProcessor && typeof window.speechProcessor._updateStatus === 'function') {
                        window.speechProcessor._updateStatus('Auditory Feedback Active', 'success');
                    }
                } catch (e) {
                    console.warn('Failed to set starting status message:', e);
                }
            });
        };

        // Await the async starter so any thrown errors are visible in this user gesture
        await startWithProcessor();
    } else {
        if (window.speechProcessor) {
            try {
                await window.speechProcessor.stop();
            } catch (e) {
                console.warn('Error while stopping speech processor:', e);
            }
            // Null out instance to ensure a fresh start next time
            try { window.speechProcessor = null; } catch (e) { /* ignore */ }
        }

        // Release wake lock when stopping DAF
        releaseWakeLock();
    }
};

// Initialize the speech processor on DOM content load
document.addEventListener('DOMContentLoaded', () => {
    // Initialize status message with default class
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
        statusElement.classList.add('status-default');
    }

    // Don't initialize device detection on page load
    // Only do it when user clicks Start DAF

    // Set initial values from sliders for UI
    const delaySlider = document.getElementById('delaySlider');
    const inputGainSlider = document.getElementById('inputGainSlider');
    if (delaySlider && inputGainSlider) {
        document.getElementById('delayValue').textContent = `${delaySlider.value} ms`;
        document.getElementById('inputGainValue').textContent = `${inputGainSlider.value}x`;
        console.log(`Initial values set - Delay: ${delaySlider.value}ms, Mic Boost: ${inputGainSlider.value}x`);
    }

    // Setup event listeners for sliders
    document.getElementById('delaySlider').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('delayValue').textContent = `${val} ms`;
        if (window.speechProcessor && typeof window.speechProcessor.updateDelayTime === 'function') {
            window.speechProcessor.updateDelayTime(val);
        }
        // Track control adjustment
        if (typeof window.sendAnalyticsEvent === 'function') {
            window.sendAnalyticsEvent('adjust_delay', { current_delay_ms: val }, { debounce: true, debounceMs: 5000 });
        }
    });

    document.getElementById('inputGainSlider').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('inputGainValue').textContent = `${val}x`;
        if (window.speechProcessor && typeof window.speechProcessor.updateInputGain === 'function') {
            window.speechProcessor.updateInputGain(val);
        }
        // Track control adjustment
        if (typeof window.sendAnalyticsEvent === 'function') {
            window.sendAnalyticsEvent('adjust_input_gain', { current_input_gain: val }, { debounce: true, debounceMs: 5000 });
        }
    });

    // Preload speech processor after page has loaded to improve responsiveness.
    // Use requestIdleCallback when available to avoid blocking initial rendering.
    if (typeof loadSpeechProcessorScript === 'function') {
        const preload = () => {
            // Avoid unnecessary work if already loaded or loading
            if (window.SpeechProcessor || document.querySelector('script[data-daf-processor]')) return;
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => loadSpeechProcessorScript().catch(err => console.warn('Preload failed:', err)));
            } else {
                setTimeout(() => loadSpeechProcessorScript().catch(err => console.warn('Preload failed:', err)), 2000);
            }
        };

        // Schedule preload after initial UI setup completes
        setTimeout(preload, 0);
    }

    // Attach click handler to the main DAF toggle button so the UI button
    // triggers the shared `toggleDAF` logic defined on `window`.
    const dafButton = document.getElementById('dafButton');
    if (dafButton) {
        dafButton.addEventListener('click', function () {
            try {
                if (typeof window.toggleDAF === 'function') {
                    window.toggleDAF(this);
                }
            } catch (err) {
                console.error('Error invoking toggleDAF from button:', err);
            }
        });
    }

    // Add click handler to the status message to resume audio context
    document.getElementById('statusMessage').addEventListener('click', () => {
        if (window.speechProcessor &&
            window.speechProcessor.audioContext &&
            window.speechProcessor.audioContext.state === 'suspended') {

            window.speechProcessor._attemptResumeAudio();
            if (typeof window.sendAnalyticsEvent === 'function') {
                window.sendAnalyticsEvent('resume_audio_attempt');
            }
        }
    });

    // When user clicks the device status area while DAF is not active,
    // display a helpful message in the statusMessage element.
    const deviceStatusEl = document.getElementById('deviceStatus');
    if (deviceStatusEl) {
        deviceStatusEl.addEventListener('click', () => {
            const statusEl = document.getElementById('statusMessage');

            // If there is no active speech processor or audio isn't running,
            // instruct the user to start DAF to enable device detection.
            if (!window.speechProcessor || !window.speechProcessor.isAudioRunning) {
                if (statusEl) {
                    statusEl.textContent = "DAF is not active — click 'Start DAF' to enable device detection and microphone status.";
                    // ensure a visible state class (styling may be defined elsewhere)
                    statusEl.classList.remove('status-default');
                    statusEl.classList.add('status-info');
                }
                if (typeof window.sendAnalyticsEvent === 'function') {
                    window.sendAnalyticsEvent('device_status_click_inactive');
                }
                return;
            }

            // If DAF is active, show the currently selected device name if available
            try {
                const deviceNameEl = document.getElementById('deviceName');
                const deviceName = (window.speechProcessor && window.speechProcessor.currentDeviceName) || (deviceNameEl && deviceNameEl.textContent) || 'Unknown device';
                if (statusEl) {
                    statusEl.textContent = `Active device: ${deviceName}`;
                    statusEl.classList.remove('status-default', 'status-info');
                    statusEl.classList.add('status-success');
                }
                if (typeof window.sendAnalyticsEvent === 'function') {
                    window.sendAnalyticsEvent('device_status_click_active', { device: deviceName });
                }
            } catch (e) {
                console.warn('Error handling deviceStatus click:', e);
            }
        });
    }

    // Initialize FAQ accordion functionality
    const faqQuestions = document.querySelectorAll('#faq [itemscope][itemprop="mainEntity"] h3');
    faqQuestions.forEach(question => {
        // Initially hide all answers
        const answer = question.nextElementSibling;
        answer.style.display = 'none';

        // Add click event to toggle answers
        question.addEventListener('click', () => {
            // Toggle the answer visibility
            const isVisible = answer.style.display !== 'none';
            answer.style.display = isVisible ? 'none' : 'block';

            // Toggle active class for styling
            question.classList.toggle('active', !isVisible);

            // Analytics
            if (typeof window.sendAnalyticsEvent === 'function') {
                window.sendAnalyticsEvent('faq_interaction', { faq_question: question.textContent });
            }
        });

        // Add accessibility attributes
        question.setAttribute('aria-expanded', 'false');
        question.setAttribute('role', 'button');
        question.setAttribute('tabindex', '0');

        // Allow keyboard navigation
        question.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                question.click();
            }
        });
    });
});

// Keep this function but make it call window.toggleDAF to ensure we use the same logic
function toggleDAF(button) {
    window.toggleDAF(button);
}

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

// Helper to safely send Google tag events if gtag is available
function sendGtagEvent(action, params = {}) {
    try {
        // Prefer the real gtag if available
        if (typeof window.gtag === 'function') {
            window.gtag('event', action, params);
            return;
        }

        // If the analytics wrapper is present, use its robust sender
        if (typeof window.sendAnalyticsEvent === 'function') {
            window.sendAnalyticsEvent(action, params);
            return;
        }

        // Fallback: ensure dataLayer exists and push an event so it is queued
        window.dataLayer = window.dataLayer || [];
        // Use the array-style push compatible with gtag/dataLayer
        window.dataLayer.push(['event', action, params]);
    } catch (e) {
        // Last-resort: log so developers can debug missing analytics
        console.warn('gtag event failed:', e);
    }
}

// Expose helper globally so other modules can use it
try { window.sendGtagEvent = sendGtagEvent; } catch (e) { /* ignore */ }

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
document.addEventListener('visibilitychange', function() {
    const isVisible = document.visibilityState === 'visible';
    console.log(`Page visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
    // Report visibility changes to analytics
    sendGtagEvent('page_visibility', { visibility: isVisible ? 'visible' : 'hidden' });
    
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
window.addEventListener('beforeunload', function() {
    // Stop audio processing if running before the page closes
    if (window.speechProcessor && window.speechProcessor.isAudioRunning) {
        window.speechProcessor.stop();
    }
    
    // Release wake lock when page is closed
    releaseWakeLock();
    // Log session end
    sendGtagEvent('session_end');
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
document.addEventListener('click', function() {
    if (window.speechProcessor && 
        window.speechProcessor.audioContext && 
        window.speechProcessor.audioContext.state === 'suspended' &&
        window.speechProcessor.isAudioRunning) {
        
        console.log('Document clicked, attempting to resume audio context');
        window.speechProcessor._attemptResumeAudio();
    }
});

// Make toggleDAF function globally available for HTML onclick attribute
window.toggleDAF = async function(button) {
    const isStarting = button.textContent === 'Start DAF';
    
    // Track DAF button click as a key event in Google Analytics
    sendGtagEvent(isStarting ? 'start_daf' : 'stop_daf', {
        event_category: 'user_action',
        event_label: isStarting ? 'DAF Started' : 'DAF Stopped'
    });
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
    
    // Remove inline onclick attribute and add event listener to prevent duplicate handlers
    const dafButton = document.getElementById('dafButton');
    if (dafButton) {
        // Remove the inline onclick attribute to prevent duplicate execution
        dafButton.removeAttribute('onclick');
        
        dafButton.addEventListener('click', (e) => {
            const isStarting = e.target.textContent === 'Start DAF';
            
            // Track button click using the analytics.js function
            if (typeof trackDAFEvent === 'function') {
                trackDAFEvent(isStarting ? 'start_daf' : 'stop_daf', isStarting ? 'DAF Started' : 'DAF Stopped');
            }
            
            // Additional gtag event for key action
            sendGtagEvent(isStarting ? 'start_daf_key' : 'stop_daf_key', {
                event_category: 'key_user_action',
                event_label: isStarting ? 'DAF Started' : 'DAF Stopped'
            });
            
            window.toggleDAF(e.target);
        });
    }

    // Setup event listeners for sliders
    document.getElementById('delaySlider').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('delayValue').textContent = `${val} ms`;
        if (window.speechProcessor && typeof window.speechProcessor.updateDelayTime === 'function') {
            window.speechProcessor.updateDelayTime(val);
        }
        // Track control adjustment
        if (typeof trackControlEvent === 'function') {
            trackControlEvent('delay_time', `${val} ms`);
        }
        // Analytics
        sendGtagEvent('adjust_delay', { value: val });
    });

    document.getElementById('inputGainSlider').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('inputGainValue').textContent = `${val}x`;
        if (window.speechProcessor && typeof window.speechProcessor.updateInputGain === 'function') {
            window.speechProcessor.updateInputGain(val);
        }
        // Track control adjustment
        if (typeof trackControlEvent === 'function') {
            trackControlEvent('input_gain', `${val}x`);
        }
        // Analytics
        sendGtagEvent('adjust_input_gain', { value: val });
    });

    // Add click handler to the status message to resume audio context
    document.getElementById('statusMessage').addEventListener('click', () => {
        if (window.speechProcessor && 
            window.speechProcessor.audioContext && 
            window.speechProcessor.audioContext.state === 'suspended') {
            
            window.speechProcessor._attemptResumeAudio();
            sendGtagEvent('resume_audio_attempt');
        }
    });
    
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
            
            // Track FAQ interaction if analytics is available
            if (typeof trackControlEvent === 'function') {
                trackControlEvent('faq_interaction', question.textContent);
            }
            // Analytics
            sendGtagEvent('faq_interaction', { question: question.textContent });
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

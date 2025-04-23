// app.js - Main application logic for DAF Online

// Global reference to speech processor instance
let globalSpeechProcessor = new SpeechProcessor();

// Register service worker for background processing
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
                
                // Request notification permission (helps with keeping audio running)
                Notification.requestPermission();
                
                // Register for periodic background sync if available
                if ('periodicSync' in registration) {
                    const syncOptions = {
                        tag: 'daf-background-sync',
                        minInterval: 60000 // 1 minute minimum
                    };
                    
                    registration.periodicSync.register(syncOptions)
                        .catch(err => console.log('Periodic sync could not be registered:', err));
                }
                
                // Set up service worker message handling
                navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
            })
            .catch(err => console.log('Service Worker registration failed:', err));
    });
}

// Handle messages from the service worker
function handleServiceWorkerMessage(event) {
    if (!event.data) return;
    
    // Handle visibility updates
    if (event.data.type === 'VISIBILITY_UPDATE') {
        const isVisible = event.data.isVisible;
        console.log(`Received visibility update: ${isVisible ? 'visible' : 'hidden'}`);
        
        if (isVisible && globalSpeechProcessor && 
            globalSpeechProcessor.audioContext && 
            globalSpeechProcessor.audioContext.state === 'suspended') {
            // Try to resume audio when becoming visible
            globalSpeechProcessor._attemptResumeAudio();
        }
    }
    
    // Handle audio state updates
    if (event.data.type === 'AUDIO_STATE_UPDATE') {
        console.log(`Received audio state update: ${event.data.state}`);
    }
}

// Keep service worker active when DAF is running
let keepAliveInterval;
let keepAliveTimeouts = 0;
const MAX_KEEPALIVE_TIMEOUTS = 3;

function startKeepAlive() {
    if (keepAliveInterval) return;
    
    keepAliveTimeouts = 0;
    
    // Send periodic messages to keep the service worker active
    keepAliveInterval = setInterval(() => {
        if (navigator.serviceWorker.controller) {
            // Send keep-alive message with timestamp
            navigator.serviceWorker.controller.postMessage({
                type: 'KEEP_ALIVE',
                timestamp: Date.now()
            });
            
            // Check for response within a timeout period
            const keepAliveTimeout = setTimeout(() => {
                console.log('Keep-alive response timed out');
                keepAliveTimeouts++;
                
                if (keepAliveTimeouts >= MAX_KEEPALIVE_TIMEOUTS) {
                    console.log('Max keep-alive timeouts reached, attempting service worker recovery');
                    keepAliveTimeouts = 0;
                    
                    // Attempt recovery by re-registering service worker
                    navigator.serviceWorker.getRegistration().then(registration => {
                        if (registration) {
                            registration.update();
                        }
                    });
                }
            }, 5000);
            
            // Set up a one-time handler to clear the timeout when response is received
            const responseHandler = (event) => {
                if (event.data && event.data.type === 'KEEP_ALIVE_CONFIRMATION') {
                    clearTimeout(keepAliveTimeout);
                    keepAliveTimeouts = 0;
                    navigator.serviceWorker.removeEventListener('message', responseHandler);
                }
            };
            
            navigator.serviceWorker.addEventListener('message', responseHandler);
        }
    }, 15000); // Every 15 seconds
}

function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
    const isVisible = document.visibilityState === 'visible';
    console.log(`Page visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
    
    // If page is visible and we have active audio that's suspended, try to resume it
    if (isVisible && globalSpeechProcessor && 
        globalSpeechProcessor.audioContext && 
        globalSpeechProcessor.audioContext.state === 'suspended') {
        
        console.log('Attempting to resume audio context after visibility change');
        globalSpeechProcessor._attemptResumeAudio();
    }
    
    // Notify all tabs via service worker
    if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'VISIBILITY_CHANGE',
            isVisible: isVisible
        });
    }
});

// Handle page unload/closing
window.addEventListener('beforeunload', function() {
    // Stop audio processing if running before the page closes
    if (globalSpeechProcessor && globalSpeechProcessor.isAudioRunning) {
        globalSpeechProcessor.stop();
    }
});

// Functions to handle UI controls and pass values to the speech processor
function updateDelayTime(value) {
    document.getElementById('delayValue').textContent = `${value} ms`;
    if (globalSpeechProcessor) {
        globalSpeechProcessor.updateDelayTime(value);
    }
}

function updatePitchChange(value) {
    document.getElementById('pitchValue').textContent = `${value} semitones`;
    if (globalSpeechProcessor) {
        globalSpeechProcessor.updatePitchShift(value);
    }
}

function updateInputGain(value) {
    document.getElementById('inputGainValue').textContent = `${value}x`;
    if (globalSpeechProcessor) {
        globalSpeechProcessor.updateInputGain(value);
    }
}

function updateNoiseReduction(value) {
    document.getElementById('noiseReductionValue').textContent = `${value}%`;
    if (globalSpeechProcessor) {
        globalSpeechProcessor.updateNoiseReduction(value);
    }
}

// Create a document-level tap handler to help resume audio on iOS
document.addEventListener('click', function() {
    if (globalSpeechProcessor && 
        globalSpeechProcessor.audioContext && 
        globalSpeechProcessor.audioContext.state === 'suspended' &&
        globalSpeechProcessor.isAudioRunning) {
        
        console.log('Document clicked, attempting to resume audio context');
        globalSpeechProcessor._attemptResumeAudio();
    }
});

function toggleDAF(button) {
    const isStarting = button.textContent === 'Start DAF';
    
    if (isStarting) {
        // Initialize with current slider values before starting
        const delayValue = document.getElementById('delaySlider').value;
        const pitchValue = document.getElementById('pitchSlider').value;
        const inputGainValue = document.getElementById('inputGainSlider').value;
        const noiseReductionValue = document.getElementById('noiseReductionSlider').value;
        
        globalSpeechProcessor.config.delayTime = delayValue;
        globalSpeechProcessor.config.pitchShift = pitchValue;
        globalSpeechProcessor.config.inputGain = inputGainValue;
        globalSpeechProcessor.config.noiseReduction = noiseReductionValue;
        
        globalSpeechProcessor.start();
        
        // Initialize background audio techniques
        preventSleep.enable();
        startKeepAlive();
    } else {
        globalSpeechProcessor.stop();
        
        preventSleep.disable();
        stopKeepAlive();
    }
}

function toggleTheme() {
    const checkbox = document.getElementById('checkbox');
    if (!checkbox) return;
    
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    const theme = checkbox.checked ? 'dark' : 'light';
    
    console.log('Toggling theme to:', theme);
    document.documentElement.setAttribute('data-theme', theme);
    
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', theme === 'dark' ? '#121212' : '#ffffff');
    }
    
    localStorage.setItem('theme', theme); // Save theme preference
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Add event listeners to the DAF button to manage keep-alive
    document.getElementById('dafButton').addEventListener('click', function(e) {
        const isStarting = this.textContent === 'Start DAF';
        if (isStarting) {
            startKeepAlive();
        } else {
            stopKeepAlive();
        }
    });
});
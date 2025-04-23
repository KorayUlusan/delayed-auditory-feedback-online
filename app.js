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

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
    const isVisible = document.visibilityState === 'visible';
    console.log(`Page visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
    
    // If page is visible and we have active audio that's suspended, try to resume it
    if (isVisible && window.speechProcessor && 
        window.speechProcessor.audioContext && 
        window.speechProcessor.audioContext.state === 'suspended') {
        
        console.log('Attempting to resume audio context after visibility change');
        window.speechProcessor._attemptResumeAudio();
    }
});

// Handle page unload/closing
window.addEventListener('beforeunload', function() {
    // Stop audio processing if running before the page closes
    if (window.speechProcessor && window.speechProcessor.isAudioRunning) {
        window.speechProcessor.stop();
    }
});

// Functions to handle UI controls and pass values to the speech processor
function updateDelayTime(value) {
    document.getElementById('delayValue').textContent = `${value} ms`;
    if (window.speechProcessor) {
        window.speechProcessor.updateDelayTime(value);
    }
}


function updateInputGain(value) {
    document.getElementById('inputGainValue').textContent = `${value}x`;
    if (window.speechProcessor) {
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
window.toggleDAF = function(button) {
    const isStarting = button.textContent === 'Start DAF';
    
    // Prevent creating multiple instances or starting multiple times
    if (isStarting) {
        if (window.speechProcessor && window.speechProcessor.isAudioRunning) {
            console.log('DAF is already running, ignoring start request');
            return;
        }
        
        // Make sure we have a speech processor instance
        if (!window.speechProcessor) {
            window.speechProcessor = new SpeechProcessor();
        }
        
        // Initialize with current slider values before starting
        const delayValue = document.getElementById('delaySlider').value;
        const inputGainValue = document.getElementById('inputGainSlider').value;
        
        window.speechProcessor.config.delayTime = delayValue;
        window.speechProcessor.config.inputGain = inputGainValue;
        
        window.speechProcessor.start();
    } else {
        if (window.speechProcessor) {
            window.speechProcessor.stop();
        }
    }
};

// Initialize the speech processor on DOM content load
document.addEventListener('DOMContentLoaded', () => {
    // Create a single instance and store it on the window object for access
    window.speechProcessor = new SpeechProcessor();
    
    // Initialize status message with default class
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
        statusElement.classList.add('status-default');
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
            
            window.toggleDAF(e.target);
        });
    }

    // Setup event listeners for sliders
    document.getElementById('delaySlider').addEventListener('input', (e) => {
        window.speechProcessor.updateDelayTime(e.target.value);
        // Track control adjustment
        if (typeof trackControlEvent === 'function') {
            trackControlEvent('delay_time', `${e.target.value} ms`);
        }
    });

    document.getElementById('inputGainSlider').addEventListener('input', (e) => {
        window.speechProcessor.updateInputGain(e.target.value);
        // Track control adjustment
        if (typeof trackControlEvent === 'function') {
            trackControlEvent('input_gain', `${e.target.value}x`);
        }
    });

    // Add click handler to the status message to resume audio context
    document.getElementById('statusMessage').addEventListener('click', () => {
        if (window.speechProcessor && 
            window.speechProcessor.audioContext && 
            window.speechProcessor.audioContext.state === 'suspended') {
            
            window.speechProcessor._attemptResumeAudio();
        }
    });
});

// Keep this function but make it call window.toggleDAF to ensure we use the same logic
function toggleDAF(button) {
    window.toggleDAF(button);
}

// init.js - Initialization script for the DAF Online application

// Initialize app when DOM is fully loaded
window.onload = function () {
    // Set current year in footer
    document.getElementById('currentYear').textContent = new Date().getFullYear();
    
    // Apply saved theme preference
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    // Set the checkbox state based on theme
    const checkbox = document.getElementById('checkbox');
    if (checkbox) {
        checkbox.checked = savedTheme === 'dark';
        
        // Attach the event listener directly here
        checkbox.addEventListener('change', function() {
            toggleTheme();
        });
    }
    
    // Update sliders with initial values
    updateDelayTime(document.getElementById('delaySlider').value);
    updatePitchChange(document.getElementById('pitchSlider').value);
    updateInputGain(document.getElementById('inputGainSlider').value); 
    updateNoiseReduction(document.getElementById('noiseReductionSlider').value);
    
    // Initialize language system if exists
    if (typeof initLanguage === 'function') {
        initLanguage();
    }
    
    // Set up tap listener to help with iOS audio resuming
    document.body.addEventListener('touchend', function() {
        if (globalSpeechProcessor && 
            globalSpeechProcessor.audioContext && 
            globalSpeechProcessor.audioContext.state === 'suspended' &&
            globalSpeechProcessor.isAudioRunning) {
            
            console.log('Touch detected, attempting to resume audio context');
            globalSpeechProcessor._attemptResumeAudio();
        }
    });
};
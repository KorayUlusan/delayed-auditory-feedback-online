let audioContext;
let source;
let inputGain;
let delayNode;
let outputGain;
let noiseGate;
let lowpassFilter;
let highpassFilter;
let compressor;
let stream;

function toggleDAF(button) {
    if (button.textContent === 'Start DAF') {
        startDAF();
        button.textContent = 'Stop DAF';
        button.setAttribute('aria-pressed', 'true');
    } else {
        stopDAF();
        button.textContent = 'Start DAF';
        button.setAttribute('aria-pressed', 'false');
    }
}

function startDAF() {
    const statusMessage = document.getElementById('statusMessage');
    statusMessage.textContent = 'Connecting to audio device... ⏳';
    
    const constraints = {
        audio: {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false,
            channelCount: 1
        }
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(s => {
            stream = s;
            
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'interactive'
            });

            // Create advanced audio processing chain
            source = audioContext.createMediaStreamSource(stream);
            
            // Multiple processing nodes
            inputGain = audioContext.createGain();
            delayNode = audioContext.createDelay(1);
            outputGain = audioContext.createGain();
            
            // Advanced noise reduction
            noiseGate = audioContext.createDynamicsCompressor();
            lowpassFilter = audioContext.createBiquadFilter();
            highpassFilter = audioContext.createBiquadFilter();
            compressor = audioContext.createDynamicsCompressor();
            
            // Noise gate configuration
            noiseGate.threshold.setValueAtTime(-50, audioContext.currentTime);
            noiseGate.knee.setValueAtTime(40, audioContext.currentTime);
            noiseGate.ratio.setValueAtTime(20, audioContext.currentTime);
            
            // Low-pass filter to cut high-frequency noise
            lowpassFilter.type = 'lowpass';
            lowpassFilter.frequency.setValueAtTime(3000, audioContext.currentTime);
            
            // High-pass filter to remove low-frequency rumble
            highpassFilter.type = 'highpass';
            highpassFilter.frequency.setValueAtTime(100, audioContext.currentTime);
            
            // Compression for final sound quality
            compressor.threshold.setValueAtTime(-24, audioContext.currentTime);
            compressor.knee.setValueAtTime(30, audioContext.currentTime);
            compressor.ratio.setValueAtTime(12, audioContext.currentTime);
            
            // Initial parameter setup
            const delayValue = document.getElementById('delaySlider').value / 1000;
            const inputGainValue = document.getElementById('inputGainSlider').value;
            
            inputGain.gain.setValueAtTime(inputGainValue, audioContext.currentTime);
            delayNode.delayTime.setValueAtTime(delayValue, audioContext.currentTime);
            
            // Optimized audio routing with noise reduction
            source.connect(inputGain);
            inputGain.connect(highpassFilter);
            highpassFilter.connect(lowpassFilter);
            lowpassFilter.connect(noiseGate);
            noiseGate.connect(compressor);
            compressor.connect(delayNode);
            delayNode.connect(outputGain);
            outputGain.connect(audioContext.destination);
            
            statusMessage.textContent = 'Connected to audio device. ✅';
        })
        .catch(error => {
            console.error('Error accessing microphone:', error);
            statusMessage.textContent = `Error: ${error.message}. ⚠️`;
        });
}

function stopDAF() {
    const statusMessage = document.getElementById('statusMessage');
    
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    
    if (audioContext) {
        try {
            // Comprehensive node disconnection
            if (source) source.disconnect();
            if (inputGain) inputGain.disconnect();
            if (highpassFilter) highpassFilter.disconnect();
            if (lowpassFilter) lowpassFilter.disconnect();
            if (noiseGate) noiseGate.disconnect();
            if (delayNode) delayNode.disconnect();
            if (outputGain) outputGain.disconnect();
            if (compressor) compressor.disconnect();
            
            audioContext.close();
        } catch (error) {
            console.error('Error closing audio context:', error);
        }
    }
    
    // Reset global variables
    audioContext = null;
    source = null;
    inputGain = null;
    highpassFilter = null;
    lowpassFilter = null;
    noiseGate = null;
    delayNode = null;
    outputGain = null;
    compressor = null;
    stream = null;
    
    statusMessage.textContent = 'Disconnected from audio device. ❌';
}

// Previous update functions remain the same
function updateDelayTime(value) {
    document.getElementById('delayValue').textContent = `${value} ms`;
    const delaySlider = document.getElementById('delaySlider');
    delaySlider.setAttribute('aria-valuenow', value);
    delaySlider.setAttribute('aria-valuetext', `${value} milliseconds`);
    
    if (delayNode && audioContext) {
        delayNode.delayTime.setValueAtTime(
            value / 1000, 
            audioContext.currentTime
        );
    }
}

function updateInputGain(value) {
    document.getElementById('inputGainValue').textContent = `${value}x`;
    const inputGainSlider = document.getElementById('inputGainSlider');
    inputGainSlider.setAttribute('aria-valuenow', value);
    inputGainSlider.setAttribute('aria-valuetext', `${value}x`);
    inputGainSlider.setAttribute('aria-valuemin', '1');
    inputGainSlider.setAttribute('aria-valuemax', '20');
    
    if (inputGain && audioContext) {
        inputGain.gain.setValueAtTime(
            value, 
            audioContext.currentTime
        );
    }
}

function updateNoiseReduction(value) {
    const percentage = Math.round(value);
    document.getElementById('noiseReductionValue').textContent = `${percentage}%`;
    const noiseReductionSlider = document.getElementById('noiseReductionSlider');
    noiseReductionSlider.setAttribute('aria-valuenow', value);
    noiseReductionSlider.setAttribute('aria-valuetext', `${percentage}%`);
    
    if (lowpassFilter && highpassFilter && noiseGate) {
        // Adjust noise reduction based on slider
        const frequencyValue = value === 0 ? 20000 : 3000 / (value / 100);
        const thresholdValue = -50 + (value * 0.5);
        
        lowpassFilter.frequency.setValueAtTime(frequencyValue, audioContext.currentTime);
        highpassFilter.frequency.setValueAtTime(100 + (value * 2), audioContext.currentTime);
        noiseGate.threshold.setValueAtTime(thresholdValue, audioContext.currentTime);
    }
}

function updatePitchChange(value) {
    document.getElementById('pitchValue').textContent = `${value} semitones`;
    const pitchSlider = document.getElementById('pitchSlider');
    pitchSlider.setAttribute('aria-valuenow', value);
    pitchSlider.setAttribute('aria-valuetext', `${value} semitones`);
    
    // Placeholder for future implementation
    console.log(`Pitch change set to ${value} semitones.`);
}
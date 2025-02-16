let audioContext;
let source;
let delayNode;
let gainNode;
let pitchProcessor;
let noiseReductionNode;
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
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(s => {
            stream = s;
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            source = audioContext.createMediaStreamSource(stream);
            
            // Create nodes
            delayNode = audioContext.createDelay();
            gainNode = audioContext.createGain();
            noiseReductionNode = audioContext.createBiquadFilter();
            
            // Create ScriptProcessorNode for pitch shifting
            pitchProcessor = audioContext.createScriptProcessor(4096, 1, 1);
            
            // Initialize values
            delayNode.delayTime.value = document.getElementById('delaySlider').value / 1000;
            gainNode.gain.value = document.getElementById('boostSlider').value;
            noiseReductionNode.type = "lowpass";
            noiseReductionNode.frequency.value = document.getElementById('noiseReductionSlider').value * 1000 || 20000;

            // Set up pitch shifting
            let pitchShift = 0;
            let buffer = new Float32Array(4096);
            
            pitchProcessor.onaudioprocess = function(e) {
                const input = e.inputBuffer.getChannelData(0);
                const output = e.outputBuffer.getChannelData(0);
                
                // Copy input to buffer
                input.forEach((sample, i) => buffer[i] = sample);
                
                // Apply pitch shift
                const pitchValue = parseFloat(document.getElementById('pitchSlider').value);
                const shift = Math.pow(2, pitchValue / 12); // Convert semitones to frequency ratio
                
                // Simple resampling for pitch shift
                for (let i = 0; i < output.length; i++) {
                    const position = i * shift;
                    const index = Math.floor(position);
                    const fraction = position - index;
                    
                    if (index + 1 < buffer.length) {
                        // Linear interpolation
                        output[i] = buffer[index] * (1 - fraction) + buffer[index + 1] * fraction;
                    } else {
                        output[i] = buffer[index] || 0;
                    }
                }
            };

            // Connect nodes
            source.connect(delayNode);
            delayNode.connect(gainNode);
            gainNode.connect(pitchProcessor);
            pitchProcessor.connect(noiseReductionNode);
            noiseReductionNode.connect(audioContext.destination);
        })
        .catch(error => {
            console.error('Error accessing microphone:', error);
        });
}

function stopDAF() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        audioContext.close();
    }
}

function updateDelayTime(value) {
    document.getElementById('delayValue').textContent = `${value} ms`;
    const delaySlider = document.getElementById('delaySlider');
    delaySlider.setAttribute('aria-valuenow', value);
    delaySlider.setAttribute('aria-valuetext', `${value} milliseconds`);
    if (delayNode) {
        delayNode.delayTime.value = value / 1000;
    }
}

function updateBoostLevel(value) {
    document.getElementById('boostValue').textContent = `${value} dB`;
    const boostSlider = document.getElementById('boostSlider');
    boostSlider.setAttribute('aria-valuenow', value);
    boostSlider.setAttribute('aria-valuetext', `${value} dB`);
    if (gainNode) {
        gainNode.gain.value = value;
    }
}

function updatePitchChange(value) {
    document.getElementById('pitchValue').textContent = `${value} semitones`;
    const pitchSlider = document.getElementById('pitchSlider');
    pitchSlider.setAttribute('aria-valuenow', value);
    pitchSlider.setAttribute('aria-valuetext', `${value} semitones`);
}

function updateNoiseReduction(value) {
    const percentage = Math.round(value);
    document.getElementById('noiseReductionValue').textContent = `${percentage}%`;
    const noiseReductionSlider = document.getElementById('noiseReductionSlider');
    noiseReductionSlider.setAttribute('aria-valuenow', value);
    noiseReductionSlider.setAttribute('aria-valuetext', `${percentage}%`);
    if (noiseReductionNode) {
        // Adjust noise reduction: 0% means no reduction, 100% means maximum reduction
        const frequencyValue = value === 0 ? 20000 : 20000 / value;
        noiseReductionNode.frequency.value = isFinite(frequencyValue) ? frequencyValue : 20000; // Ensure finite value
    }
}
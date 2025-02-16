let audioContext;
let source;
let delayNode;
let gainNode;
let pitchNode;
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
            delayNode = audioContext.createDelay();
            gainNode = audioContext.createGain();
            pitchNode = audioContext.createBiquadFilter();
            pitchNode.type = "allpass";
            noiseReductionNode = audioContext.createBiquadFilter();
            noiseReductionNode.type = "lowpass";
            
            delayNode.delayTime.value = document.getElementById('delaySlider').value / 1000; // Adjust delay time in seconds
            gainNode.gain.value = document.getElementById('boostSlider').value; // Adjust boost level
            pitchNode.frequency.value = document.getElementById('pitchSlider').value * 1000; // Adjust pitch change
            noiseReductionNode.frequency.value = document.getElementById('noiseReductionSlider').value * 1000; // Adjust noise reduction
            
            source.connect(delayNode);
            delayNode.connect(gainNode);
            gainNode.connect(pitchNode);
            pitchNode.connect(noiseReductionNode);
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
    document.getElementById('delayValue').textContent = value;
    const delaySlider = document.getElementById('delaySlider');
    delaySlider.setAttribute('aria-valuenow', value);
    delaySlider.setAttribute('aria-valuetext', `${value} milliseconds`);
    if (delayNode) {
        delayNode.delayTime.value = value / 1000; // Adjust delay time in seconds
    }
}

function updateBoostLevel(value) {
    document.getElementById('boostValue').textContent = value;
    const boostSlider = document.getElementById('boostSlider');
    boostSlider.setAttribute('aria-valuenow', value);
    boostSlider.setAttribute('aria-valuetext', value);
    if (gainNode) {
        gainNode.gain.value = value; // Adjust boost level
    }
}

function updatePitchChange(value) {
    document.getElementById('pitchValue').textContent = value;
    const pitchSlider = document.getElementById('pitchSlider');
    pitchSlider.setAttribute('aria-valuenow', value);
    pitchSlider.setAttribute('aria-valuetext', value);
    if (pitchNode) {
        pitchNode.frequency.value = value * 1000; // Adjust pitch change
    }
}

function updateNoiseReduction(value) {
    document.getElementById('noiseReductionValue').textContent = value;
    const noiseReductionSlider = document.getElementById('noiseReductionSlider');
    noiseReductionSlider.setAttribute('aria-valuenow', value);
    noiseReductionSlider.setAttribute('aria-valuetext', value);
    if (noiseReductionNode) {
        noiseReductionNode.frequency.value = value * 1000; // Adjust noise reduction
    }
}

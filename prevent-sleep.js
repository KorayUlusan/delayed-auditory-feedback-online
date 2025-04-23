// prevent-sleep.js - Utilities for keeping the app active in background

// Enhanced prevent screen lock for mobile devices
const preventSleep = {
    noSleep: null,
    video: null,
    audioElement: null,
    
    enable: function() {
        // Create both video and audio elements to maximize compatibility across devices
        
        // 1. Create video element (works on most browsers)
        if (!this.video) {
            this.video = document.createElement('video');
            this.video.setAttribute('playsinline', '');
            this.video.setAttribute('muted', '');
            this.video.setAttribute('loop', '');
            this.video.setAttribute('width', '1');
            this.video.setAttribute('height', '1');
            this.video.style.position = 'absolute';
            this.video.style.left = '-1px';
            this.video.style.top = '-1px';
            document.body.appendChild(this.video);
            
            // Create empty video source
            this.video.src = 'data:video/mp4;base64,AAAAIGZ0eXBtcDQyAAAAAG1wNDJtcDQxaXNvbWF2YzEAAATKbW9vdgAAAGxtdmhkAAAAANLEP5XSxD+VAAB1MAAAdU4AAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAACFpb2RzAAAAABCAgIAQAE////9//w6AgIAEAAAAAQAABDV0cmFrAAAAXHRraGQAAAAH0sQ/ldLEP5UAAAABAAAAAAAAdU4AAAAAAAAAAAAAAAABAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAABnaWYzMgAAAAAAAQxCAAAF/////wEAAAKZBMIAAAH4BMIAAAAGQEIAAAAP+BLj4QAAA+gAECU2ZEFUAAAAIGZkdGQAAAAAbWRtZGkAAAAAAAAIaGRscgAAAAAAAAAAAABtaXIxAAAAEEhtaXJoZGxcuXJGlJBTUVfUkFURQAQIGhtaXJoZGxyAAAAAQAAABBobWlyaGRsctBpdHNjAAAAAAIAAAABAAAAEAAAABBtaXJtZGlhc3BlY3QAAAAAAQAAABBtaXJjb2RlY3MAAAAAAAAAAQAAABBtaXJoZGxyAAAAAQAAABBtaXJ2aWRlQVVESU9fREFUQRAAAAAgbWlyZGF0YQAAAAMgRlJBTUVfUkFURRAQIG1pcmhkbHIAAAABAAAAEG1pcmNvZGVjcwAAAAAAAAABAAAAEG1pcnZpZGUAAAAAAQAAABBtaXJkYXRh';
        }
        
        // 2. Create audio element (especially helpful for iOS)
        if (!this.audioElement) {
            this.audioElement = document.createElement('audio');
            this.audioElement.setAttribute('loop', '');
            
            // Create a silent audio file (1 second of silence)
            const silentMP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjM1LjEwNAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAGAAADAABgYGBgYGBgYGBg2NjY2NjY2NjY2Njk5OTk5OTk5OTk5P////////////////////////////////8AAAAATGF2YzU4Ljc1AAAAAAAAAAAAAAAAJAP/////REVGRkVSRVJFUkVSRVJFUkVSRVJF//tQxAADUrRZyEEMTAgAAH/mQBSoBUAKgCAEgnCAIAJAGXAMAEgQ4H4fB8HwfA/9iBAEAQBAEAQDA54P4IAghCPg+CAP9T+CAIAgCgBQAgt/UiSJIkiSJIkARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEnSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJk6RJEkQBEk//tQxCmADN3TPQwxM2Fnvqb9hiZsEQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAkSRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJk6RJEkQBEk//tQxCmADRHzPQwxNWGNPmfhhiasERJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJECRJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJ//tQxCmADOHxPSwxNWGAvmehh6a8EkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQJEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkf/tQxCmADDnvOwwwCaGHvqehhiZsERJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJECRJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJ//tQxCmADJH1PQwxMyGVPmehhiasEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEkSRJEkSRAESRJEkSRJEARJEkSRJEkQJEkSRJEkSRAESRJEkSRJEARJEkSRJEkQBEn/+1LEKYAMQfM9DDEzQZa+Z+GGJmw=';
            this.audioElement.src = silentMP3;
            this.audioElement.muted = false;  // Not muted to work properly on iOS
            this.audioElement.volume = 0.01;  // Very low volume
            document.body.appendChild(this.audioElement);
        }
        
        // Start both elements
        if (this.video) {
            try {
                const playPromise = this.video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => {
                        console.log('Video play prevented by browser, trying after user interaction:', e);
                    });
                }
            } catch (e) {
                console.error('Error starting video:', e);
            }
        }
        
        if (this.audioElement) {
            try {
                const audioPromise = this.audioElement.play();
                if (audioPromise !== undefined) {
                    audioPromise.catch(e => {
                        console.log('Audio play prevented by browser, will retry after user interaction:', e);
                        
                        // Add one-time click listener to start audio
                        const startAudio = () => {
                            this.audioElement.play()
                                .then(() => console.log('Audio started after user interaction'))
                                .catch(err => console.error('Failed to start audio:', err));
                            document.removeEventListener('click', startAudio);
                        };
                        document.addEventListener('click', startAudio);
                    });
                }
            } catch (e) {
                console.error('Error starting audio:', e);
            }
        }
        
        console.log('Sleep prevention enabled (video and audio methods)');
    },
    
    disable: function() {
        if (this.video) {
            this.video.pause();
            console.log('Video sleep prevention disabled');
        }
        
        if (this.audioElement) {
            this.audioElement.pause();
            console.log('Audio sleep prevention disabled');
        }
    }
};
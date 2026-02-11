const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const voiceButton = document.getElementById('voiceButton');
const speechBubble = document.getElementById('speechBubble');
const currentSpeechText = document.getElementById('currentSpeechText');
const transcriptionDiv = document.getElementById('transcription');
const statusIndicator = document.getElementById('statusIndicator');
const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');
const connectionStatus = document.getElementById('connectionStatus');

let ws;
let audioContext = null;
let processor = null;
let source = null;

let isRecording = false;
let isSessionActive = false;
let isPaused = false;

let currentAssistantMessage = null;
let currentAssistantText = '';
let messageSequence = 0;

// NEW: Text sync with audio
let fullTranscriptText = ''; // Store the complete transcript
let wordsToDisplay = []; // Split transcript into words for progressive display
let isThinkingState = false; // Track if we're in thinking state

// NEW: Sync Counters
let totalChunksReceived = 0;
let chunksPlayed = 0;

// Connection management
let isFirstConnection = true;
let currentSessionId = null;
let persistentConversationId = null;
let hasHadFirstGreeting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;
let heartbeatInterval = null;
let lastHeartbeat = Date.now();
let connectionTimeout = null;

// Audio playback
let audioQueue = [];
let isPlayingAudio = false;
let currentAudioSource = null;
let audioChunkCount = 0;

// Conversation storage
const conversationMessages = [];

// Speech bubble control
let speechBubbleTimeout = null;
let currentDisplayedText = "";

// Animation state tracking
let isUserSpeaking = false;
let isAssistantSpeaking = false;
let isProcessing = false;
let responseComplete = false;
let avatarSpeakingActive = false;

let lastAssistantMessage = '';

// VAD (Voice Activity Detection) - Prevent stuck listening
let vadThreshold = 0.02; // Minimum audio level to consider as speech (increased to ignore claps/noise)
let silenceDuration = 0; // How long silence has been detected
let maxSilenceDuration = 2500; // Max silence in ms before considering speech ended (2.5s)
let vadCheckInterval = null;
let lastAudioLevel = 0;
let consecutiveSilenceChecks = 0;
let isCurrentlyDetectingSpeech = false;
let lastSpeechDetectedTime = 0;

// Additional safety: listening state timeout
let listeningStateTimeout = null;
let maxListeningDuration = 30000; // 30 seconds max of continuous SILENCE (not speech)
let listeningStateStartTime = 0;

// Speech detection - require sustained audio to prevent claps/coughs triggering
let minSpeechDuration = 300; // Minimum 300ms of sustained audio to consider it speech
let speechStartTime = 0;
let consecutiveSpeechFrames = 0;
let minSpeechFrames = 3; // Need 3 consecutive frames above threshold (300ms at 100ms intervals)

// Helper function to safely call avatar methods
function callAvatarMethod(methodName) {
  if (window.avatarController && window.avatarController.isReady && typeof window.avatarController[methodName] === 'function') {
    window.avatarController[methodName]();
  } else if (window.avatarController && !window.avatarController.isReady) {
    setTimeout(() => {
        if(window.avatarController && window.avatarController.isReady) {
             window.avatarController[methodName]();
        }
    }, 1000);
  }
}

// Detect browser
function detectBrowser() {
  const userAgent = navigator.userAgent.toLowerCase();
  const isFirefox = userAgent.indexOf('firefox') > -1;
  const isSafari = userAgent.indexOf('safari') > -1 && userAgent.indexOf('chrome') === -1;
  
  if (isFirefox) {
    showBrowserWarning('You are using Firefox. Please ensure microphone permissions are granted. Click the 🔒 icon in the address bar → Permissions → Microphone → Allow.');
  } else if (isSafari) {
    showBrowserWarning('You are using Safari. Please ensure microphone permissions are granted. Go to Safari → Settings → Websites → Microphone → Allow for this website.');
  }
}

function showBrowserWarning(message) {
  const warningDiv = document.getElementById('browserWarning');
  const messageP = document.getElementById('browserMessage');
  if (warningDiv && messageP) {
    messageP.textContent = message;
    warningDiv.style.display = 'block';
  }
}

detectBrowser();

// --- STATE MANAGEMENT & UI ---

function updateVoiceUI() {
  voiceButton.classList.remove('active', 'paused');
  
  if (!isSessionActive) {
    // IDLE State (Blue button default from CSS)
    setAgentState('idle');
  } else {
    if (isPaused) {
      // PAUSED State (Yellow button)
      voiceButton.classList.add('paused');
      setAgentState('paused');
    } else {
      // ACTIVE State (Red button)
      voiceButton.classList.add('active');
      
      // FIXED: Properly restore state upon resume
      if (isAssistantSpeaking) {
        setAgentState('speaking');
      } else if (isUserSpeaking) {
        setAgentState('listening');
      } else {
        setAgentState('ready');
      }
    }
  }
}

function setAgentState(state) {
  if (!statusIndicator || !statusIcon || !statusText) return;
  
  statusIndicator.className = 'status-indicator show';
  statusIcon.className = 'status-icon';
  statusIcon.innerHTML = '';
  
  switch(state) {
    case 'ready':
      statusIndicator.classList.add('idle');
      statusIcon.textContent = '🟢';
      statusIcon.classList.add('active');
      statusText.textContent = 'Listening...';
      break;
    case 'idle':
      statusIndicator.classList.add('idle');
      statusIcon.textContent = '🎙️';
      statusIcon.classList.add('active');
      statusText.textContent = 'Click to Start';
      break;
    case 'paused':
      statusIndicator.classList.add('paused');
      statusIcon.textContent = '⏸️';
      statusText.textContent = 'Paused';
      break;
    case 'listening':
      statusIndicator.classList.add('listening');
      statusIcon.textContent = '👂';
      statusIcon.classList.add('active');
      statusText.textContent = 'Listening';
      break;
    case 'thinking':
      statusIndicator.classList.add('thinking');
      statusIcon.textContent = '🧠';
      statusIcon.classList.add('active');
      statusText.textContent = 'Thinking';
      break;
    case 'speaking':
      statusIndicator.classList.add('speaking');
      statusIcon.innerHTML = '<div class="sound-waves"><div class="sound-wave"></div><div class="sound-wave"></div><div class="sound-wave"></div><div class="sound-wave"></div><div class="sound-wave"></div></div>';
      statusIcon.classList.add('active');
      statusText.textContent = 'Speaking';
      break;
  }
}

// --- SPEECH BUBBLE LOGIC ---

function showSpeechBubble(text) {
  speechBubble.classList.remove('fade-out');
  
  // Add thinking class if text is "..."
  if (text === '...') {
    currentSpeechText.classList.add('thinking-dots');
    currentSpeechText.textContent = text;
    currentDisplayText = text;
    targetText = text;
  } else {
    currentSpeechText.classList.remove('thinking-dots');
    animateText(text);
  }
  
  speechBubble.classList.add('show');
  
  if (speechBubbleTimeout) {
    clearTimeout(speechBubbleTimeout);
    speechBubbleTimeout = null;
  }
  lastAssistantMessage = text;
}

let textAnimationFrame = null;
let targetText = '';
let currentDisplayText = '';
const textAnimationSpeed = 30;

function animateText(newText) {
  targetText = newText;
  if (newText.length > currentDisplayText.length) {
    if (!textAnimationFrame) {
      animateTextStep();
    }
  } else {
    currentDisplayText = newText;
    currentSpeechText.textContent = newText;
  }
}

function animateTextStep() {
  if (currentDisplayText.length < targetText.length) {
    currentDisplayText = targetText.substring(0, currentDisplayText.length + 1);
    currentSpeechText.textContent = currentDisplayText;
    textAnimationFrame = setTimeout(animateTextStep, textAnimationSpeed);
  } else {
    textAnimationFrame = null;
  }
}

function hideSpeechBubble() {
  speechBubble.classList.add('fade-out');
  setTimeout(() => {
    speechBubble.classList.remove('show');
    speechBubble.classList.remove('fade-out');
    currentSpeechText.textContent = '';
    currentDisplayText = '';
    targetText = '';
  }, 2000);
}

// --- MAIN BUTTON HANDLER ---

voiceButton.addEventListener('click', () => {
  if (!isSessionActive) {
    // 1. Start
    startBtn.click();
  } else {
    // 2. Toggle Pause/Resume
    if (isPaused) {
      resumeSession();
    } else {
      pauseSession();
    }
  }
});

function pauseSession() {
  console.log("⏸️ Pausing Session...");
  isPaused = true;
  isRecording = false; 
  
  stopVADMonitoring(); // Stop VAD when paused
  
  if (audioContext && audioContext.state === 'running') {
    audioContext.suspend();
  }
  
  if (avatarSpeakingActive) {
    callAvatarMethod('stopSpeaking');
  }
  
  updateVoiceUI();
}

function resumeSession() {
  console.log("▶️ Resuming Session...");
  isPaused = false;
  isRecording = true;
  
  startVADMonitoring(); // Restart VAD when resumed
  
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  if (avatarSpeakingActive) {
    callAvatarMethod('startSpeaking');
  }
  
  updateVoiceUI();
}

// --- SESSION START LOGIC ---

startBtn.onclick = async () => {
  if (isSessionActive) return;
  
  const username = sessionStorage.getItem('username');
  if (!username) {
    window.location.href = 'login.html';
    return;
  }
  
  // Initialize Audio Context immediately
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!audioContext) {
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  
  isSessionActive = true;
  isPaused = false;
  isRecording = true;
  
  startBtn.disabled = true;
  stopBtn.disabled = false;
  updateVoiceUI();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  connectionTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      ws.close();
      showSpeechBubble('Connection timeout. Please try again.');
      cleanup(false);
    }
  }, 10000);

  ws.onopen = async () => {
    clearTimeout(connectionTimeout);
    reconnectAttempts = 0;
    startHeartbeat();
    
    if (!currentSessionId) currentSessionId = Date.now();
    if (!persistentConversationId) persistentConversationId = currentSessionId;
    
    ws.send(JSON.stringify({ 
      type: "start",
      username: username,
      sessionId: currentSessionId,
      conversationId: persistentConversationId,
      isReconnection: !isFirstConnection,
      hasMessages: conversationMessages.length > 0,
      previousMessages: conversationMessages
    }));
    
    if (isFirstConnection) {
      isFirstConnection = false;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access not supported.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      source = audioContext.createMediaStreamSource(stream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        if (!isRecording || !ws || ws.readyState !== WebSocket.OPEN || isPaused) return;
        
        const input = e.inputBuffer.getChannelData(0);
        
        // Calculate RMS (Root Mean Square) for audio level detection
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i];
        }
        lastAudioLevel = Math.sqrt(sum / input.length);
        
        let resampledData = input;
        
        if (audioContext.sampleRate !== 24000) {
          resampledData = resampleAudio(input, audioContext.sampleRate, 24000);
        }
        
        const base64 = arrayBufferToBase64(convertFloat32ToPCM16(resampledData));
        ws.send(JSON.stringify({ type: "audio", audio: base64 }));
      };
      
      // Start VAD monitoring after audio setup
      startVADMonitoring();
      
    } catch (err) {
      console.error('Mic Error:', err);
      showSpeechBubble('Microphone access denied. Please check permissions.');
      cleanup(false);
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    lastHeartbeat = Date.now();
    
    if (connectionStatus) connectionStatus.style.display = 'none';

    // 1) USER INTERRUPT DETECTED BY VAD
    if (msg.type === 'speech_started') {
      isUserSpeaking = true;
      isAssistantSpeaking = false;
      listeningStateStartTime = Date.now();
      
      // Clear any existing listening timeout
      if (listeningStateTimeout) {
        clearTimeout(listeningStateTimeout);
      }
      
      // Set a safety timeout - if stuck in listening state (no speech detected) for too long
      // Note: This timeout gets reset when actual speech is detected by VAD
      listeningStateTimeout = setTimeout(() => {
        if (isUserSpeaking && ws && ws.readyState === WebSocket.OPEN) {
          console.log(`⏱️ Listening state timeout (${maxListeningDuration}ms) - no speech detected`);
          try {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            isUserSpeaking = false;
            if (!isPaused) setAgentState('thinking');
          } catch (e) {
            console.error('Error forcing commit:', e);
          }
        }
      }, maxListeningDuration);
      
      // CRITICAL: Stop audio playback IMMEDIATELY when user starts speaking
      stopAudioPlayback();
      
      if (!isPaused) setAgentState('listening');
      
      callAvatarMethod('stopThinking');
      if (avatarSpeakingActive) {
        callAvatarMethod('stopSpeaking');
        avatarSpeakingActive = false;
      }
      callAvatarMethod('startListening');
    }

    if (msg.type === 'speech_stopped') {
      isUserSpeaking = false;
      
      // Clear listening timeout since speech has stopped
      if (listeningStateTimeout) {
        clearTimeout(listeningStateTimeout);
        listeningStateTimeout = null;
      }
      
      if (!isPaused) setAgentState('thinking');
      callAvatarMethod('stopListening');
      callAvatarMethod('startThinking');
    }

    if (msg.type === 'user_transcription') {
      conversationMessages.push({
        sequence: messageSequence++,
        role: 'user',
        content: msg.text,
        timestamp: new Date().toISOString()
      });
    }

    // NEW: Show thinking indicator when response is being created
    if (msg.type === 'response_creating') {
      console.log('🤔 AI is thinking...');
      isThinkingState = true;
      
      // Reset text sync variables
      fullTranscriptText = '';
      wordsToDisplay = [];
      currentAssistantText = '';
      
      // Reset counters for the new response
      totalChunksReceived = 0;
      chunksPlayed = 0;
      
      // Show "..." in speech bubble
      showSpeechBubble('...');
      
      // Trigger thinking animation
      if (!isPaused) setAgentState('thinking');
      callAvatarMethod('startThinking');
    }

    if (msg.type === 'assistant_transcript_delta') {
      if (isUserSpeaking) return; // Drop transcript updates if user interrupted

      if (!isAssistantSpeaking) {
        isAssistantSpeaking = true;
        isUserSpeaking = false;
        
        if (!isPaused) setAgentState('speaking');
        
        callAvatarMethod('stopThinking');
        callAvatarMethod('stopListening');
        
        if (!avatarSpeakingActive) {
          callAvatarMethod('startSpeaking');
          avatarSpeakingActive = true;
        }
      }
      
      // Remove thinking state
      isThinkingState = false;
      
      // Accumulate the full transcript text
      fullTranscriptText += msg.text;
      
      // Update word list but DO NOT display yet (audio loop handles it)
      wordsToDisplay = fullTranscriptText.split(' ');
    }

    if (msg.type === 'assistant_transcript_complete') {
      if (isUserSpeaking) return;

      // Ensure we have the final clean text
      fullTranscriptText = msg.text;
      wordsToDisplay = fullTranscriptText.split(' ');
      
      // Only force display if audio is already done (rare, but possible)
      if (audioQueue.length === 0 && !isPlayingAudio) {
         currentAssistantText = fullTranscriptText;
         showSpeechBubble(currentAssistantText);
      }
      isThinkingState = false;
    }

    if (msg.type === "assistant_audio_delta") {
      // Guard: Do not process new audio packets if user is speaking (Interruption active)
      if (isUserSpeaking) return; 

      // Increment total chunks received for ratio calculation
      totalChunksReceived++;
      
      if (!avatarSpeakingActive && !isPaused) {
        callAvatarMethod('startSpeaking');
        avatarSpeakingActive = true;
      }
      playPCM16Audio(msg.audio);
    }

    // 2) CONFIRMATION OF INTERRUPTION FROM SERVER
    if (msg.type === 'response_interrupted') {
      console.log('⛔ Interrupted');
      stopAudioPlayback(); // Just in case
      
      isAssistantSpeaking = false;
      avatarSpeakingActive = false;
      callAvatarMethod('stopSpeaking');
      callAvatarMethod('stopThinking');
      
      if (isUserSpeaking) {
         if (!isPaused) setAgentState('listening');
      } else {
         if (!isPaused) setAgentState('ready');
      }
      
      if (currentAssistantText) {
        currentAssistantText += '...';
        showSpeechBubble(currentAssistantText);
      }
      
      // Reset text sync variables
      currentAssistantText = '';
      fullTranscriptText = '';
      wordsToDisplay = [];
      totalChunksReceived = 0;
      chunksPlayed = 0;
      isThinkingState = false;
    }

    if (msg.type === 'response_complete') {
      if (currentAssistantText) {
        conversationMessages.push({
          sequence: messageSequence++,
          role: 'assistant',
          content: currentAssistantText,
          timestamp: new Date().toISOString()
        });
        showSpeechBubble(currentAssistantText);
      }
      currentAssistantText = '';
    }
    
    if (msg.type === 'error') showSpeechBubble(`Error: ${msg.message}`);
  };

  ws.onerror = () => {
    showSpeechBubble('Connection error.');
  };

  ws.onclose = (event) => {
    stopHeartbeat();
    if (isSessionActive) {
      if (event.code !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        if (connectionStatus) {
            connectionStatus.textContent = `Reconnecting (${reconnectAttempts})...`;
            connectionStatus.style.display = 'block';
        }
        setTimeout(() => { if (isSessionActive) startBtn.click(); }, RECONNECT_DELAY);
      } else {
        cleanup(false);
      }
    }
  };
};

stopBtn.onclick = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: 'stop' })); } catch(e){}
  }
  cleanup(false);
};

function cleanup(isManualStop = false) {
  isSessionActive = false;
  isPaused = false;
  isRecording = false;
  
  startBtn.disabled = false;
  stopBtn.disabled = true;
  updateVoiceUI();

  stopAudioPlayback();
  stopHeartbeat();
  stopVADMonitoring(); // Stop VAD monitoring
  
  // Clear listening timeout
  if (listeningStateTimeout) {
    clearTimeout(listeningStateTimeout);
    listeningStateTimeout = null;
  }
  
  avatarSpeakingActive = false;
  callAvatarMethod('stopSpeaking');
  callAvatarMethod('stopListening');
  callAvatarMethod('stopThinking');
  
  if (connectionStatus) connectionStatus.style.display = 'none';
  if (connectionTimeout) clearTimeout(connectionTimeout);

  if (processor) { processor.disconnect(); processor = null; }
  if (source) { source.disconnect(); source = null; }
  
  if (audioContext && audioContext.state !== 'closed') { 
      audioContext.close(); 
      audioContext = null; 
  }
  
  if (window.avatarController) {
    window.avatarController.analyser = null;
    window.avatarController.audioContext = null;
    window.avatarController.frequencyData = null;
  }

  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  
  currentAssistantText = '';
  if (isManualStop) {
    isFirstConnection = true;
    currentSessionId = null;
    hideSpeechBubble();
  }
}

function startHeartbeat() {
  lastHeartbeat = Date.now();
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && (Date.now() - lastHeartbeat > 30000)) {
         if (connectionStatus) {
             connectionStatus.textContent = 'Connection unstable...';
             connectionStatus.style.display = 'block';
         }
    }
  }, 5000);
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
}

// VAD Monitoring - Detect when user stops speaking
function startVADMonitoring() {
  if (vadCheckInterval) return; // Already monitoring
  
  consecutiveSilenceChecks = 0;
  consecutiveSpeechFrames = 0;
  isCurrentlyDetectingSpeech = false;
  lastSpeechDetectedTime = Date.now();
  speechStartTime = 0;
  
  vadCheckInterval = setInterval(() => {
    if (!isRecording || isPaused || !processor) {
      stopVADMonitoring();
      return;
    }
    
    // Check audio level from the processor
    const currentTime = Date.now();
    const timeSinceLastSpeech = currentTime - lastSpeechDetectedTime;
    
    // If we detect audio above threshold
    if (lastAudioLevel > vadThreshold) {
      consecutiveSilenceChecks = 0;
      consecutiveSpeechFrames++;
      
      // Only consider it speech if sustained for minimum duration
      if (consecutiveSpeechFrames >= minSpeechFrames) {
        lastSpeechDetectedTime = currentTime;
        
        // IMPORTANT: Reset the listening timeout when active speech is detected
        // This allows unlimited continuous speaking
        if (listeningStateTimeout && isCurrentlyDetectingSpeech) {
          clearTimeout(listeningStateTimeout);
          listeningStateTimeout = null;
        }
        
        if (!isCurrentlyDetectingSpeech) {
          isCurrentlyDetectingSpeech = true;
          console.log('🎤 Speech detected (sustained audio)');
        }
      } else {
        // Audio detected but not sustained yet - could be a clap or cough
        if (!speechStartTime) {
          speechStartTime = currentTime;
        }
      }
    } else {
      // Silence detected
      consecutiveSilenceChecks++;
      consecutiveSpeechFrames = 0; // Reset speech frame counter
      speechStartTime = 0;
      
      // If we had speech before and now there's prolonged silence
      if (isCurrentlyDetectingSpeech && timeSinceLastSpeech > maxSilenceDuration) {
        console.log(`🔇 Silence detected for ${timeSinceLastSpeech}ms - assuming user stopped speaking`);
        isCurrentlyDetectingSpeech = false;
        
        // Force commit the current speech by sending a manual trigger
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            // Send a commit event to force the API to process what it has
            ws.send(JSON.stringify({ 
              type: 'input_audio_buffer.commit' 
            }));
            console.log('📤 Sent manual commit due to silence detection');
          } catch (e) {
            console.error('Error sending commit:', e);
          }
        }
      }
    }
  }, 100); // Check every 100ms
  
  console.log('👂 VAD monitoring started');
}

function stopVADMonitoring() {
  if (vadCheckInterval) {
    clearInterval(vadCheckInterval);
    vadCheckInterval = null;
    consecutiveSilenceChecks = 0;
    consecutiveSpeechFrames = 0;
    isCurrentlyDetectingSpeech = false;
    speechStartTime = 0;
    console.log('🛑 VAD monitoring stopped');
  }
}

function stopAudioPlayback() {
  if (currentAudioSource) {
    try { currentAudioSource.stop(); } catch (e) {}
    currentAudioSource = null;
  }
  if (!isPaused) {
      audioQueue = [];
      audioChunkCount = 0;
  }
  isPlayingAudio = false;
}

function checkAndStopSpeaking() {
  if (isPaused) return;
  
  if (audioQueue.length === 0 && !isPlayingAudio) {
    isAssistantSpeaking = false;
    setAgentState('ready');
    if (avatarSpeakingActive) {
      callAvatarMethod('stopSpeaking');
      avatarSpeakingActive = false;
    }
  }
}

function playPCM16Audio(base64Audio) {
  if (!audioContext || audioContext.state === 'closed') return;

  try {
    const raw = atob(base64Audio);
    const pcm16Array = new Int16Array(raw.length / 2);
    for (let i = 0; i < pcm16Array.length; i++) {
      pcm16Array[i] = (raw.charCodeAt(i * 2 + 1) << 8) | raw.charCodeAt(i * 2);
    }

    const float32Array = new Float32Array(pcm16Array.length);
    for (let i = 0; i < pcm16Array.length; i++) {
      float32Array[i] = pcm16Array[i] / 32768.0;
    }

    audioQueue.push(float32Array);
    
    if (!isPlayingAudio) {
      playNextAudioChunk();
    }
  } catch (err) {
    console.error('Audio decode error:', err);
  }
}

function playNextAudioChunk() {
  if (audioQueue.length === 0 || !audioContext || audioContext.state === 'closed') {
    isPlayingAudio = false;
    currentAudioSource = null;
    checkAndStopSpeaking();
    return;
  }

  // --- NEW: SYNC LOGIC ---
  // When we start a chunk, we update the text
  isPlayingAudio = true;
  chunksPlayed++;
  
  if (wordsToDisplay.length > 0) {
      // Calculate ratio of audio played vs total audio received
      // Math.max(1, ...) prevents division by zero
      const ratio = Math.min(1.0, chunksPlayed / Math.max(1, totalChunksReceived));
      
      // Determine how many words to show based on that ratio
      const wordCount = Math.ceil(wordsToDisplay.length * ratio);
      const textToShow = wordsToDisplay.slice(0, wordCount).join(' ');
      
      // Update display if we have more text to show
      if (textToShow.length >= currentAssistantText.length) {
          currentAssistantText = textToShow;
          showSpeechBubble(currentAssistantText);
      }
  }
  // -----------------------

  const audioData = audioQueue.shift();
  
  try {
    const sampleRate = audioContext.sampleRate;
    let finalAudioData = audioData;
    if (sampleRate !== 24000) finalAudioData = resampleAudio(audioData, 24000, sampleRate);
    
    const audioBuffer = audioContext.createBuffer(1, finalAudioData.length, sampleRate);
    audioBuffer.getChannelData(0).set(finalAudioData);
    
    const bufferSource = audioContext.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(audioContext.destination);
    
    if (window.avatarController && window.avatarController.isReady) {
      if (!window.avatarController.audioContext || window.avatarController.audioContext !== audioContext) {
          window.avatarController.audioContext = audioContext;
          window.avatarController.analyser = audioContext.createAnalyser();
          window.avatarController.frequencyData = new Uint8Array(window.avatarController.analyser.frequencyBinCount);
      }
      bufferSource.connect(window.avatarController.analyser);
    }
    
    currentAudioSource = bufferSource;
    
    bufferSource.onended = () => {
      currentAudioSource = null;
      playNextAudioChunk();
    };
    
    bufferSource.start();
  } catch (err) {
    console.error('Playback error:', err);
    isPlayingAudio = false;
    currentAudioSource = null;
    checkAndStopSpeaking();
  }
}

function convertFloat32ToPCM16(float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16.buffer;
}

function resampleAudio(inputData, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) return inputData;
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(inputData.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
    const fraction = srcIndex - srcIndexFloor;
    output[i] = inputData[srcIndexFloor] * (1 - fraction) + inputData[srcIndexCeil] * fraction;
  }
  return output;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) { binary += String.fromCharCode(bytes[i]); }
  return btoa(binary);
}

window.addEventListener('beforeunload', () => {
  if (isSessionActive) cleanup(true);
});
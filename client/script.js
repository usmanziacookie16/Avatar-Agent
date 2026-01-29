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

let ws, audioContext, processor, source;
let isRecording = false;
let currentAssistantMessage = null;
let currentAssistantText = '';
let messageSequence = 0;

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
let ttsAudioContext = null;
let audioQueue = [];
let isPlayingAudio = false;
let currentAudioSource = null;

// Conversation storage
const conversationMessages = [];

// Speech bubble control - CHANGED: Never auto-hide, only hide on manual action
let speechBubbleTimeout = null;
let currentDisplayedText = ""; // Track what's currently being shown

// Animation state tracking
let isUserSpeaking = false;
let isAssistantSpeaking = false;
let isProcessing = false;
let responseComplete = false;

// NEW: Track last assistant message to keep visible
let lastAssistantMessage = '';

// Helper function to safely call avatar methods
function callAvatarMethod(methodName) {
  if (window.avatarController && window.avatarController.isReady && typeof window.avatarController[methodName] === 'function') {
    window.avatarController[methodName]();
    console.log(`✅ Called avatarController.${methodName}()`);
  } else if (window.avatarController && !window.avatarController.isReady) {
    console.log(`⏳ Avatar loading, method will auto-retry: ${methodName}`);
    setTimeout(() => {
        if(window.avatarController && window.avatarController.isReady) {
             window.avatarController[methodName]();
        }
    }, 1000);
  } else {
    console.warn(`⚠️ avatarController.${methodName}() not available yet`);
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

// Update UI and avatar state
function updateVoiceUI(recording) {
  if (recording) {
    voiceButton.classList.add('active');
    setAgentState('idle');
  } else {
    voiceButton.classList.remove('active');
    setAgentState('ready');
  }
}

// Set agent status with floating indicator
function setAgentState(state) {
  if (!statusIndicator || !statusIcon || !statusText) return;
  
  statusIndicator.className = 'status-indicator show';
  statusIcon.className = 'status-icon';
  
  switch(state) {
    case 'ready':
      statusIndicator.classList.add('idle');
      statusIcon.textContent = '🟢';
      statusIcon.classList.add('active');
      statusText.textContent = 'Ready';
      break;
      
    case 'idle':
      statusIndicator.classList.add('idle');
      statusIcon.textContent = '🟢';
      statusIcon.classList.add('active');
      statusText.textContent = 'Idle';
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

// CHANGED: Show speech bubble and keep it visible (no auto-hide)
function showSpeechBubble(text) {
  speechBubble.classList.remove('fade-out');
  animateText(text);
  speechBubble.classList.add('show');
  
  // Clear any existing timeout
  if (speechBubbleTimeout) {
    clearTimeout(speechBubbleTimeout);
    speechBubbleTimeout = null;
  }
  
  // Store as last message
  lastAssistantMessage = text;
}

// Animate text character by character
let textAnimationFrame = null;
let targetText = '';
let currentDisplayText = '';
let textAnimationSpeed = 30;

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

// CHANGED: Only hide bubble when new user speech starts or manual stop
function hideSpeechBubble() {
  speechBubble.classList.add('fade-out');
  
  setTimeout(() => {
    speechBubble.classList.remove('show');
    speechBubble.classList.remove('fade-out');
    currentSpeechText.textContent = '';
    currentDisplayText = '';
    targetText = '';
  }, 2000);
  
  if (speechBubbleTimeout) {
    clearTimeout(speechBubbleTimeout);
    speechBubbleTimeout = null;
  }
  
  if (textAnimationFrame) {
    clearTimeout(textAnimationFrame);
    textAnimationFrame = null;
  }
}

/**
 * Updates the speech bubble with a fade-out/fade-in transition
 * @param {string} text - The new text to display
 */
function updateSpeechBubble(text) {
    if (!speechBubble || !currentSpeechText) return;
    
    // Prevent flickering if the text is identical
    if (text === currentDisplayedText) return;

    // If bubble is currently hidden, show it immediately with new text
    if (!speechBubble.classList.contains('show')) {
        currentSpeechText.innerText = text;
        currentDisplayedText = text;
        speechBubble.classList.add('show');
        return;
    }

    // --- CROSS-FADE SEQUENCE ---
    // 1. Fade out current bubble
    speechBubble.style.opacity = "0";
    speechBubble.style.transform = "translateX(-50%) translateY(10px)";

    // 2. Wait for fade-out (approx 200ms)
    setTimeout(() => {
        currentSpeechText.innerText = text;
        currentDisplayedText = text;
        
        // 3. Fade back in
        speechBubble.style.opacity = "1";
        speechBubble.style.transform = "translateX(-50%) translateY(0)";
    }, 250); 
}


// Update the message processing logic to use this new function
// Locate your message handling (likely inside ws.onmessage)
// Replace direct innerText assignments with updateSpeechBubble(text)

function handleAssistantSpeech(text, isFinal = false) {
  updateSpeechBubble(text);
  
  // Ensure the bubble stays visible while speaking
  if (speechBubbleTimeout) clearTimeout(speechBubbleTimeout);
}


// Voice button click handler
voiceButton.addEventListener('click', () => {
  if (voiceButton.classList.contains('active')) {
    stopBtn.click();
  } else {
    startBtn.click();
  }
});

// Start conversation
startBtn.onclick = async () => {
  if (isRecording) return;
  
  const username = sessionStorage.getItem('username');
  
  if (!username) {
    alert('Session expired. Please login again.');
    window.location.href = 'login.html';
    return;
  }
  
  isRecording = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  updateVoiceUI(true);

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
    
    // Initialize session/conversation IDs
    if (!currentSessionId) {
      currentSessionId = Date.now();
    }
    
    if (!persistentConversationId) {
      persistentConversationId = currentSessionId;
    }
    
    // CHANGED: Detect if this is a resume (has messages but was paused)
    const isPauseResume = conversationMessages.length > 0 && !isFirstConnection;
    
    // IMPORTANT: Send previous messages to server so it can restore context
    ws.send(JSON.stringify({ 
      type: "start",
      username: username,
      sessionId: currentSessionId,
      conversationId: persistentConversationId,
      isReconnection: !isFirstConnection,
      hasMessages: conversationMessages.length > 0,
      isPauseResume: isPauseResume,
      previousMessages: conversationMessages // Sending full history
    }));
    
    if (isFirstConnection) {
      isFirstConnection = false;
      hasHadFirstGreeting = true;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support audio recording. Please use Chrome, Edge, or a modern browser.');
      }

      const constraints = {
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
      const actualSampleRate = audioContext.sampleRate;
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      if (!ttsAudioContext) {
        ttsAudioContext = new AudioContextClass({ sampleRate: actualSampleRate });
        if (ttsAudioContext.state === 'suspended') {
          await ttsAudioContext.resume();
        }
      }

      source = audioContext.createMediaStreamSource(stream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        if (!isRecording || !ws || ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        
        let resampledData = input;
        if (audioContext.sampleRate !== 24000) {
          resampledData = resampleAudio(input, audioContext.sampleRate, 24000);
        }
        
        const pcm16 = convertFloat32ToPCM16(resampledData);
        const base64 = arrayBufferToBase64(pcm16);
        
        try {
          ws.send(JSON.stringify({ type: "audio", audio: base64 }));
        } catch (err) {
          console.error('Error sending audio:', err);
        }
      };
    } catch (err) {
      console.error('Microphone access error:', err);
      
      let errorMessage = 'Could not access microphone. ';
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage += 'Please grant microphone permission.';
      } else if (err.name === 'NotFoundError') {
        errorMessage += 'No microphone found.';
      } else if (err.message) {
        errorMessage += err.message;
      }
      
      showSpeechBubble(errorMessage);
      cleanup(false);
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    lastHeartbeat = Date.now();
    
    // Reset connection warning if message received
    if (connectionStatus) connectionStatus.style.display = 'none';
    
    if (msg.type !== 'assistant_audio_delta') {
      console.log('📨 Received:', msg.type);
    }

    // User started speaking -> CHANGED: Clear speech bubble to avoid confusion
    if (msg.type === 'speech_started') {
      console.log('🎤 User started speaking (VAD)');
      isUserSpeaking = true;
      isProcessing = false;
      isAssistantSpeaking = false;
      responseComplete = false;
      
      setAgentState('listening');
      
      callAvatarMethod('stopThinking');
      
      if (isAssistantSpeaking) {
        callAvatarMethod('stopSpeaking');
      }
      
      callAvatarMethod('startListening');
      
      // CHANGED: REMOVED hideSpeechBubble() to keep previous text visible
      // hideSpeechBubble(); 
    }

    // User stopped speaking
    if (msg.type === 'speech_stopped') {
      console.log('⏸️ User stopped speaking (VAD)');
      isUserSpeaking = false;
      isProcessing = true;
      
      setAgentState('thinking');
      
      callAvatarMethod('stopListening');
      callAvatarMethod('startThinking');
    }

    // User transcription received
    if (msg.type === 'user_transcription') {
      console.log('📝 User transcription:', msg.text);
      
      conversationMessages.push({
        sequence: messageSequence++,
        role: 'user',
        content: msg.text,
        timestamp: new Date().toISOString()
      });
    }

    // Assistant transcript delta
    if (msg.type === 'assistant_transcript_delta') {
      if (!isAssistantSpeaking) {
        console.log('🤖 Assistant started speaking');
        isAssistantSpeaking = true;
        isProcessing = false;
        isUserSpeaking = false;
        responseComplete = false;
        
        setAgentState('speaking');
        
        callAvatarMethod('stopThinking');
        callAvatarMethod('stopListening');
        callAvatarMethod('startSpeaking');
      }
      
      currentAssistantText += msg.text;
      showSpeechBubble(currentAssistantText);
    }

    // Complete transcript
    if (msg.type === 'assistant_transcript_complete') {
      if (msg.text.length > currentAssistantText.length) {
        currentAssistantText = msg.text;
        showSpeechBubble(currentAssistantText);
      }
    }

    // Response interrupted
    if (msg.type === 'response_interrupted') {
      console.log('⛔ Response interrupted');
      stopAudioPlayback();
      
      isAssistantSpeaking = false;
      isProcessing = false;
      responseComplete = false;
      
      callAvatarMethod('stopSpeaking');
      callAvatarMethod('stopThinking');
      
      if (isUserSpeaking) {
         callAvatarMethod('startListening');
         setAgentState('listening');
      } else {
         setAgentState('idle');
      }
      
      if (currentAssistantText) {
        currentAssistantText += '...';
        showSpeechBubble(currentAssistantText);
        // CHANGED: Keep interrupted message visible
      }
      
      currentAssistantText = '';
    }

    // Assistant audio delta
    if (msg.type === "assistant_audio_delta") {
      playPCM16Audio(msg.audio);
    }

    // Response complete - CHANGED: Keep text visible
    if (msg.type === 'response_complete') {
      console.log('✅ Response complete (transcript done)');
      
      responseComplete = true;
      
      if (currentAssistantText) {
        conversationMessages.push({
          sequence: messageSequence++,
          role: 'assistant',
          content: currentAssistantText,
          timestamp: new Date().toISOString(),
          interrupted: false
        });
        
        showSpeechBubble(currentAssistantText);
        // CHANGED: DO NOT auto-hide - keep it visible for reflection
      }
      
      currentAssistantText = '';
      
      console.log('⏳ Waiting for audio playback to complete...');
    }

    // Error
    if (msg.type === 'error') {
      const errorText = `Error: ${msg.message}`;
      showSpeechBubble(errorText);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    showSpeechBubble('Connection error. Retrying...');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'emergency_save' }));
      } catch (err) {
        console.error('Could not send emergency save:', err);
      }
    }
  };

  ws.onclose = (event) => {
    stopHeartbeat();
    
    if (isRecording) {
      if (event.code !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        
        // Show reconnecting in connection status bar instead of speech bubble
        if (connectionStatus) {
            connectionStatus.textContent = `Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`;
            connectionStatus.style.display = 'block';
        }
        
        setTimeout(() => {
          if (isRecording) {
            startBtn.click();
          }
        }, RECONNECT_DELAY);
      } else {
        cleanup(false);
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          if (connectionStatus) {
            connectionStatus.textContent = 'Connection lost. Please try again.';
            connectionStatus.style.display = 'block';
          }
        }
      }
    }
  };
};

// CHANGED: Stop is now PAUSE - doesn't reset conversation
stopBtn.onclick = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      // CHANGED: Don't request new session on pause
      ws.send(JSON.stringify({ type: 'stop', requestNewSession: false }));
    } catch (err) {
      console.error('Error sending stop signal:', err);
    }
  }
  
  // CHANGED: Pass false to keep conversation state
  cleanup(false);
  
  // CHANGED: Show pause message but keep last assistant message visible
  if (lastAssistantMessage) {
    showSpeechBubble(lastAssistantMessage);
  }
};

function cleanup(isManualStop = false) {
  isRecording = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  updateVoiceUI(false);

  stopAudioPlayback();
  stopHeartbeat();
  // CHANGED: Don't hide speech bubble on cleanup
  
  isUserSpeaking = false;
  isAssistantSpeaking = false;
  isProcessing = false;
  responseComplete = false;
  
  callAvatarMethod('stopSpeaking');
  callAvatarMethod('stopListening');
  callAvatarMethod('stopThinking');
  
  if (connectionStatus) connectionStatus.style.display = 'none';
  
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }

  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (source) {
    source.disconnect();
    source = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
  if (ttsAudioContext && ttsAudioContext.state !== 'closed') {
    ttsAudioContext.close();
    ttsAudioContext = null;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'stop' }));
    } catch (err) {
      console.error('Error sending stop message:', err);
    }
    ws.close();
  }
  
  currentAssistantText = '';
  
  if (isManualStop) {
    isFirstConnection = true;
    currentSessionId = null;
    persistentConversationId = null;
    hasHadFirstGreeting = false;
    conversationMessages.length = 0;
    messageSequence = 0;
    hideSpeechBubble();
  }
}

function startHeartbeat() {
  lastHeartbeat = Date.now();
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const timeSinceLastMessage = Date.now() - lastHeartbeat;
      if (timeSinceLastMessage > 30000) {
         if (connectionStatus) {
             connectionStatus.textContent = 'Connection may be unstable...';
             connectionStatus.style.display = 'block';
         }
      } else {
         if (connectionStatus) connectionStatus.style.display = 'none';
      }
    }
  }, 5000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function stopAudioPlayback() {
  if (currentAudioSource) {
    try {
      currentAudioSource.stop();
    } catch (e) {}
    currentAudioSource = null;
  }
  audioQueue = [];
  isPlayingAudio = false;
}

function checkAndStopSpeaking() {
  if (responseComplete && audioQueue.length === 0 && !isPlayingAudio) {
    console.log('🎯 Audio finished - Returning to IDLE');
    
    isAssistantSpeaking = false;
    isProcessing = false;
    isUserSpeaking = false;
    
    setAgentState('idle');
    callAvatarMethod('stopSpeaking');
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
  if (inputSampleRate === outputSampleRate) {
    return inputData;
  }
  
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
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function playPCM16Audio(base64Audio) {
  if (!ttsAudioContext || ttsAudioContext.state === 'closed') return;

  try {
    const raw = atob(base64Audio);
    const pcm16Array = new Int16Array(raw.length / 2);
    
    for (let i = 0; i < pcm16Array.length; i++) {
      const byte1 = raw.charCodeAt(i * 2);
      const byte2 = raw.charCodeAt(i * 2 + 1);
      pcm16Array[i] = (byte2 << 8) | byte1;
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
    console.error('Error playing audio:', err);
  }
}

function playNextAudioChunk() {
  if (audioQueue.length === 0 || !ttsAudioContext || ttsAudioContext.state === 'closed') {
    isPlayingAudio = false;
    currentAudioSource = null;
    checkAndStopSpeaking();
    return;
  }

  isPlayingAudio = true;
  const audioData = audioQueue.shift();
  
  try {
    const sampleRate = ttsAudioContext.sampleRate;
    
    let finalAudioData = audioData;
    if (sampleRate !== 24000) {
      finalAudioData = resampleAudio(audioData, 24000, sampleRate);
    }
    
    const audioBuffer = ttsAudioContext.createBuffer(1, finalAudioData.length, sampleRate);
    audioBuffer.getChannelData(0).set(finalAudioData);
    
    const bufferSource = ttsAudioContext.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(ttsAudioContext.destination);
    
    currentAudioSource = bufferSource;
    
    bufferSource.onended = () => {
      currentAudioSource = null;
      playNextAudioChunk();
    };
    
    bufferSource.start();
  } catch (err) {
    console.error('Error in playNextAudioChunk:', err);
    isPlayingAudio = false;
    currentAudioSource = null;
    checkAndStopSpeaking();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && isRecording) {
    console.log('Page hidden, maintaining connection...');
  }
});

window.addEventListener('beforeunload', (event) => {
  if (isRecording && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'emergency_save' }));
      const start = Date.now();
      while (Date.now() - start < 100) {}
    } catch (err) {
      console.error('Could not send emergency save on unload:', err);
    }
    cleanup(true);
  }
});

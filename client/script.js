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

// Speech bubble control
let speechBubbleTimeout = null;
let currentDisplayedText = "";

// Animation state tracking
let isUserSpeaking = false;
let isAssistantSpeaking = false;
let isProcessing = false;
let responseComplete = false;

// Track last assistant message to keep visible
let lastAssistantMessage = '';

// NEW: Track if session is paused
let isPaused = false;

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

// Show speech bubble and keep it visible
function showSpeechBubble(text) {
  speechBubble.classList.remove('fade-out');
  animateText(text);
  speechBubble.classList.add('show');
  
  if (speechBubbleTimeout) {
    clearTimeout(speechBubbleTimeout);
    speechBubbleTimeout = null;
  }
  
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

// Hide bubble when new user speech starts or manual stop
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

function updateSpeechBubble(text) {
    if (!speechBubble || !currentSpeechText) return;
    
    if (text === currentDisplayedText) return;

    if (!speechBubble.classList.contains('show')) {
        currentSpeechText.innerText = text;
        currentDisplayedText = text;
        speechBubble.classList.add('show');
        return;
    }

    speechBubble.style.opacity = "0";
    speechBubble.style.transform = "translateX(-50%) translateY(10px)";

    setTimeout(() => {
        currentSpeechText.innerText = text;
        currentDisplayedText = text;
        
        speechBubble.style.opacity = "1";
        speechBubble.style.transform = "translateX(-50%) translateY(0)";
    }, 250); 
}

function handleAssistantSpeech(text, isFinal = false) {
  updateSpeechBubble(text);
  
  if (speechBubbleTimeout) clearTimeout(speechBubbleTimeout);
}

// Voice button - unified control (FIXED)
voiceButton.onclick = () => {
  if (isRecording) {
    // PAUSE - stop audio but keep connection alive
    console.log('⏸️ PAUSING conversation (keeping session alive)');
    pauseSession();
  } else {
    // START/RESUME
    if (isPaused) {
      console.log('▶️ RESUMING conversation');
      resumeSession();
    } else {
      console.log('▶️ STARTING new conversation');
      startBtn.click();
    }
  }
};

// NEW: Pause function - stops audio without closing WebSocket
function pauseSession() {
  isPaused = true;
  isRecording = false;
  
  // Stop audio input
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (source) {
    source.disconnect();
    source = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.suspend(); // Suspend instead of close
  }
  
  // Stop audio playback
  stopAudioPlayback();
  
  // Update UI
  updateVoiceUI(false);
  setAgentState('ready');
  
  // Reset animation states
  isUserSpeaking = false;
  isAssistantSpeaking = false;
  isProcessing = false;
  
  callAvatarMethod('stopSpeaking');
  callAvatarMethod('stopListening');
  callAvatarMethod('stopThinking');
  
  // Keep speech bubble visible
  if (lastAssistantMessage) {
    showSpeechBubble(lastAssistantMessage);
  }
  
  console.log('✅ Session paused (WebSocket still connected)');
}

// NEW: Resume function - restarts audio without new WebSocket
function resumeSession() {
  isPaused = false;
  
  // Resume audio context
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  // Restart microphone
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      source = audioContext.createMediaStreamSource(stream);
      
      const bufferSize = 4096;
      processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      processor.onaudioprocess = (e) => {
        if (!isRecording || isPaused) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const targetSampleRate = 24000;
        const resampledData = resampleAudio(inputData, audioContext.sampleRate, targetSampleRate);
        const pcm16 = convertFloat32ToPCM16(resampledData);
        const base64Audio = arrayBufferToBase64(pcm16);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'audio', audio: base64Audio }));
        }
      };
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      isRecording = true;
      updateVoiceUI(true);
      
      console.log('✅ Session resumed');
    })
    .catch(err => {
      console.error('Error resuming microphone:', err);
      alert('Failed to resume microphone. Please check permissions.');
      isPaused = false;
    });
}

// Start button handler
startBtn.onclick = () => {
  const username = sessionStorage.getItem('username');
  if (!username) {
    alert('Please log in first');
    window.location.href = 'login.html';
    return;
  }

  startBtn.disabled = true;
  stopBtn.disabled = false;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('✅ Connected to server');
    
    if (!currentSessionId) {
      currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    if (!persistentConversationId) {
      persistentConversationId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    const initMessage = {
      type: 'init',
      username: username,
      isFirstConnection: isFirstConnection,
      sessionId: currentSessionId,
      conversationId: persistentConversationId,
      hasHadFirstGreeting: hasHadFirstGreeting,
      isPauseResume: isPaused  // NEW: Tell server if this is a pause/resume
    };
    
    ws.send(JSON.stringify(initMessage));
    console.log('📤 Sent init with:', {
      isFirstConnection,
      sessionId: currentSessionId,
      conversationId: persistentConversationId,
      hasHadFirstGreeting,
      isPauseResume: isPaused
    });
    
    isFirstConnection = false;
    reconnectAttempts = 0;
    startHeartbeat();
    
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        
        source = audioContext.createMediaStreamSource(stream);
        
        const bufferSize = 4096;
        processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        processor.onaudioprocess = (e) => {
          if (!isRecording || isPaused) return;
          
          const inputData = e.inputBuffer.getChannelData(0);
          const targetSampleRate = 24000;
          const resampledData = resampleAudio(inputData, audioContext.sampleRate, targetSampleRate);
          const pcm16 = convertFloat32ToPCM16(resampledData);
          const base64Audio = arrayBufferToBase64(pcm16);
          
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'audio', audio: base64Audio }));
          }
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        isRecording = true;
        updateVoiceUI(true);
        
        console.log('✅ Microphone active');
      })
      .catch(err => {
        console.error('Microphone access error:', err);
        alert('Microphone access denied. Please allow microphone access and refresh the page.');
        cleanup(true);
      });
  };

  ws.onmessage = (event) => {
    lastHeartbeat = Date.now();
    const data = JSON.parse(event.data);
    
    if (data.type === 'session_started') {
      console.log('Session started:', data.sessionId);
      hasHadFirstGreeting = false;
    }
    
    if (data.type === 'greeting_sent') {
      console.log('✅ Greeting sent by server');
      hasHadFirstGreeting = true;
    }

    // NEW: Handle conversation history restoration
    if (data.type === 'history_restored') {
      console.log(`🔄 Conversation history restored (${data.messageCount} messages)`);
      setAgentState('ready');
      // Show notification to user
      if (lastAssistantMessage) {
        showSpeechBubble(lastAssistantMessage + ' [Conversation resumed]');
      }
    }

    if (data.type === 'speech_started') {
      console.log('🎤 User speech started');
      isUserSpeaking = true;
      isProcessing = false;
      responseComplete = false;
      
      setAgentState('listening');
      callAvatarMethod('startListening');
      callAvatarMethod('stopThinking');
      
      hideSpeechBubble();
    }

    if (data.type === 'speech_stopped') {
      console.log('⏹️ User speech stopped');
      isUserSpeaking = false;
      
      setAgentState('thinking');
      callAvatarMethod('stopListening');
      callAvatarMethod('startThinking');
    }

    if (data.type === 'response_interrupted') {
      console.log('⚠️ Response interrupted by user');
      
      stopAudioPlayback();
      
      isAssistantSpeaking = false;
      isProcessing = false;
      responseComplete = false;
      
      callAvatarMethod('stopSpeaking');
      hideSpeechBubble();
    }

    if (data.type === 'user_transcription') {
      console.log('📝 User said:', data.text);
      const userMsg = document.createElement('div');
      userMsg.className = 'message user-message';
      userMsg.textContent = `You: ${data.text}`;
      if (transcriptionDiv) transcriptionDiv.appendChild(userMsg);
    }

    if (data.type === 'assistant_transcript_delta') {
      currentAssistantText += data.text;
      showSpeechBubble(currentAssistantText);
    }

    if (data.type === 'assistant_transcript_complete') {
      console.log('✅ Assistant transcript complete');
      currentAssistantText = data.text;
      showSpeechBubble(currentAssistantText);
      
      const assistantMsg = document.createElement('div');
      assistantMsg.className = 'message assistant-message';
      assistantMsg.textContent = `Assistant: ${data.text}`;
      if (transcriptionDiv) transcriptionDiv.appendChild(assistantMsg);
    }

    if (data.type === 'assistant_audio_delta') {
      if (!isAssistantSpeaking) {
        console.log('🔊 Assistant started speaking');
        isAssistantSpeaking = true;
        isProcessing = false;
        responseComplete = false;
        
        setAgentState('speaking');
        callAvatarMethod('startSpeaking');
        callAvatarMethod('stopThinking');
      }
      
      playPCM16Audio(data.audio);
    }

    if (data.type === 'response_complete') {
      console.log('✅ Response complete');
      responseComplete = true;
      
      setTimeout(() => {
        if (responseComplete && audioQueue.length === 0 && !isPlayingAudio) {
          checkAndStopSpeaking();
        }
      }, 100);
    }

    if (data.type === 'error') {
      console.error('Server error:', data.message);
      
      if (data.message.includes('session')) {
        console.log('🔄 Attempting to recover from session error...');
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          setTimeout(() => {
            if (!isRecording) {
              startBtn.click();
            }
          }, RECONNECT_DELAY);
        }
      }
    }
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('❌ Disconnected from server');
    
    // Only try to reconnect if we're not intentionally paused
    if (isRecording && !isPaused && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      console.log(`🔄 Attempting to reconnect (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
      reconnectAttempts++;
      
      setTimeout(() => {
        if (isRecording && !isPaused) {
          startBtn.click();
        }
      }, RECONNECT_DELAY);
    } else {
      // Only fully cleanup if not paused
      if (!isPaused) {
        cleanup(false);
      }
    }
  };
};

// Stop button - COMPLETE STOP (resets everything)
stopBtn.onclick = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'stop', requestNewSession: true }));
    } catch (err) {
      console.error('Error sending stop signal:', err);
    }
  }
  
  cleanup(true);
};

function cleanup(isManualStop = false) {
  isRecording = false;
  isPaused = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  updateVoiceUI(false);

  stopAudioPlayback();
  stopHeartbeat();
  
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

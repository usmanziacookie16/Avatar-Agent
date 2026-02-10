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

// IMPROVED: Conversation storage with memory management
const conversationMessages = [];
const MAX_CONVERSATION_HISTORY = 100; // Prevent unlimited growth

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

// FIXED: Add state reset timeout to prevent getting stuck
let stateResetTimeout = null;
const STATE_RESET_DELAY = 2000; // 2 seconds after last activity

// IMPROVED: Add watchdog timer for long hangs
let watchdogTimer = null;
const WATCHDOG_TIMEOUT = 10000; // 10 seconds - force reset if stuck

// IMPROVED: Track consecutive state issues
let consecutiveStateIssues = 0;
const MAX_CONSECUTIVE_ISSUES = 3;

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
  
  // Clear timers when pausing
  clearAllTimers();
  
  if (audioContext && audioContext.state === 'running') {
    audioContext.suspend();
  }
  
  if (avatarSpeakingActive) {
    callAvatarMethod('stopSpeaking');
  }
  
  callAvatarMethod('stopListening');
  callAvatarMethod('stopThinking');
  
  updateVoiceUI();
}

function resumeSession() {
  console.log("▶️ Resuming Session...");
  isPaused = false;
  isRecording = true;
  
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  updateVoiceUI();
  
  // Restart watchdog when resuming
  startWatchdog();
  
  if (isAssistantSpeaking) {
    callAvatarMethod('startSpeaking');
  } else {
    callAvatarMethod('startListening');
  }
}

// IMPROVED: Clear all timers
function clearAllTimers() {
  if (stateResetTimeout) {
    clearTimeout(stateResetTimeout);
    stateResetTimeout = null;
  }
  
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  
  if (textAnimationFrame) {
    clearTimeout(textAnimationFrame);
    textAnimationFrame = null;
  }
  
  if (speechBubbleTimeout) {
    clearTimeout(speechBubbleTimeout);
    speechBubbleTimeout = null;
  }
}

// IMPROVED: Watchdog timer to detect long hangs
function startWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
  }
  
  watchdogTimer = setTimeout(() => {
    console.warn('⚠️ WATCHDOG: Detected potential hang - forcing state reset');
    consecutiveStateIssues++;
    
    if (consecutiveStateIssues >= MAX_CONSECUTIVE_ISSUES) {
      console.error('❌ Too many consecutive state issues - may need to restart session');
      showSpeechBubble('Connection may be unstable. Consider restarting if issues persist.');
    }
    
    forceStateReset();
  }, WATCHDOG_TIMEOUT);
}

function resetWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
  }
  if (isSessionActive && !isPaused) {
    startWatchdog();
  }
}

// FIXED: New function to force state reset
function forceStateReset() {
  console.log('🔄 Force state reset triggered');
  
  // Clear any pending timeouts
  if (stateResetTimeout) {
    clearTimeout(stateResetTimeout);
    stateResetTimeout = null;
  }
  
  // If not paused and session is active, ensure we're in ready state
  if (isSessionActive && !isPaused && !isAssistantSpeaking && !isPlayingAudio && audioQueue.length === 0) {
    console.log('✅ Resetting to ready state');
    isUserSpeaking = false;
    isProcessing = false;
    
    setAgentState('ready');
    callAvatarMethod('stopSpeaking');
    callAvatarMethod('stopThinking');
    callAvatarMethod('startListening');
    
    avatarSpeakingActive = false;
    
    // Reset consecutive issues counter on successful reset
    consecutiveStateIssues = 0;
  }
  
  // Restart watchdog
  resetWatchdog();
}

// FIXED: Schedule state reset with debouncing
function scheduleStateReset() {
  if (stateResetTimeout) {
    clearTimeout(stateResetTimeout);
  }
  
  stateResetTimeout = setTimeout(() => {
    forceStateReset();
  }, STATE_RESET_DELAY);
}

// IMPROVED: Memory management for conversation history
function addConversationMessage(message) {
  conversationMessages.push(message);
  
  // Trim old messages if exceeding limit
  if (conversationMessages.length > MAX_CONVERSATION_HISTORY) {
    const removed = conversationMessages.shift();
    console.log(`🗑️ Trimmed old message to prevent memory growth (total: ${conversationMessages.length})`);
  }
}

// --- START SESSION ---

startBtn.onclick = async () => {
  startBtn.disabled = true;
  stopBtn.disabled = false;
  isSessionActive = true;
  isPaused = false;
  
  // Reset state tracking
  consecutiveStateIssues = 0;
  
  updateVoiceUI();

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { 
      channelCount: 1, 
      echoCancellation: true, 
      noiseSuppression: true,
      autoGainControl: true
    }});

    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      if (!isPaused && isRecording && ws && ws.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = convertFloat32ToPCM16(inputData);
        const base64Audio = arrayBufferToBase64(pcm16);
        ws.send(JSON.stringify({ type: 'audio', audio: base64Audio }));
      }
    };

    isRecording = true;
    callAvatarMethod('startListening');
    
    // Start watchdog
    startWatchdog();
  } catch (err) {
    console.error('Microphone error:', err);
    showSpeechBubble('Microphone access denied.');
    cleanup(false);
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Connected to server');
    reconnectAttempts = 0;
    startHeartbeat();
    
    const username = sessionStorage.getItem('username') || 'guest';
    const messageData = {
      type: 'start',
      username: username,
      conversationId: persistentConversationId,
      sessionId: currentSessionId,
      isFirstConnection: isFirstConnection
    };
    
    ws.send(JSON.stringify(messageData));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    lastHeartbeat = Date.now();
    
    // Reset watchdog on any message
    resetWatchdog();

    if (msg.type === 'session_started') {
      console.log(`Session ready: ${msg.sessionId}`);
      currentSessionId = msg.sessionId;
      if (!persistentConversationId) {
        persistentConversationId = msg.conversationId;
      }
      
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
      
      if (connectionStatus) connectionStatus.style.display = 'none';
    }

    if (msg.type === 'speech_started') {
      console.log('🎤 User speech started');
      isUserSpeaking = true;
      isProcessing = false;
      
      // Clear any pending state resets
      clearAllTimers();
      
      if (!isPaused) {
        setAgentState('listening');
        callAvatarMethod('startListening');
        callAvatarMethod('stopThinking');
        
        if (avatarSpeakingActive) {
          callAvatarMethod('stopSpeaking');
          avatarSpeakingActive = false;
        }
      }
      
      // Restart watchdog
      startWatchdog();
    }

    if (msg.type === 'speech_stopped') {
      console.log('⏹️ User speech stopped');
      isUserSpeaking = false;
      
      if (!isPaused && !isAssistantSpeaking) {
        setAgentState('thinking');
        callAvatarMethod('startThinking');
        callAvatarMethod('stopListening');
      }
    }

    if (msg.type === 'user_transcription') {
      addConversationMessage({
        sequence: messageSequence++,
        role: 'user',
        content: msg.text,
        timestamp: new Date().toISOString()
      });
    }

    if (msg.type === 'response_creating') {
      console.log('🤖 Assistant response creating');
      isProcessing = true;
      isThinkingState = true;
      
      if (!isPaused) {
        setAgentState('thinking');
        showSpeechBubble('...');
        callAvatarMethod('startThinking');
        callAvatarMethod('stopListening');
      }
    }

    if (msg.type === 'response_interrupted') {
      console.log('⚠️ Response interrupted by user');
      
      // FIXED: Properly reset state on interruption
      isAssistantSpeaking = false;
      isProcessing = false;
      avatarSpeakingActive = false;
      
      stopAudioPlayback();
      
      if (!isPaused) {
        callAvatarMethod('stopSpeaking');
        callAvatarMethod('stopThinking');
        scheduleStateReset(); // Schedule reset after interruption
      }
    }

    if (msg.type === 'assistant_transcript_delta') {
      if (isThinkingState) {
        isThinkingState = false;
        fullTranscriptText = '';
        totalChunksReceived = 0;
        chunksPlayed = 0;
      }
      
      fullTranscriptText += msg.text;
      wordsToDisplay = fullTranscriptText.split(/\s+/);
    }

    if (msg.type === 'assistant_transcript_complete') {
      fullTranscriptText = msg.text;
      wordsToDisplay = fullTranscriptText.split(/\s+/);
      
      console.log('✅ Transcript complete:', msg.text);
    }

    if (msg.type === 'assistant_audio_delta') {
      totalChunksReceived++;
      
      if (!isPaused) {
        if (!isAssistantSpeaking) {
          console.log('🔊 Starting assistant speech');
          isAssistantSpeaking = true;
          isProcessing = false;
          avatarSpeakingActive = true;
          
          setAgentState('speaking');
          callAvatarMethod('startSpeaking');
          callAvatarMethod('stopThinking');
          callAvatarMethod('stopListening');
        }
        
        playPCM16Audio(msg.audio);
      }
    }

    if (msg.type === 'assistant_transcript_delta' || msg.type === 'assistant_transcript_complete') {
      if (currentAssistantText !== msg.text && msg.text) {
        currentAssistantText = msg.text;
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

    // FIXED: Improved response_complete handler
    if (msg.type === 'response_complete') {
      console.log('✅ Response complete event received');
      
      if (currentAssistantText) {
        addConversationMessage({
          sequence: messageSequence++,
          role: 'assistant',
          content: currentAssistantText,
          timestamp: new Date().toISOString()
        });
        showSpeechBubble(currentAssistantText);
      }
      
      currentAssistantText = '';
      isProcessing = false;
      
      // FIXED: Schedule state reset to ensure we transition back to ready
      scheduleStateReset();
    }
    
    if (msg.type === 'error') showSpeechBubble(`Error: ${msg.message}`);
  };

  ws.onerror = () => {
    showSpeechBubble('Connection error.');
  };

  ws.onclose = (event) => {
    stopHeartbeat();
    clearAllTimers();
    
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
  
  // FIXED: Clear all timers
  clearAllTimers();
  
  startBtn.disabled = false;
  stopBtn.disabled = true;
  updateVoiceUI();

  stopAudioPlayback();
  stopHeartbeat();
  
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
  
  // Reset state tracking
  consecutiveStateIssues = 0;
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

// FIXED: Improved checkAndStopSpeaking with state reset
function checkAndStopSpeaking() {
  if (isPaused) return;
  
  console.log(`🔍 Checking stop speaking - Queue: ${audioQueue.length}, Playing: ${isPlayingAudio}`);
  
  if (audioQueue.length === 0 && !isPlayingAudio) {
    console.log('✅ Audio playback complete - resetting state');
    
    isAssistantSpeaking = false;
    
    if (avatarSpeakingActive) {
      callAvatarMethod('stopSpeaking');
      avatarSpeakingActive = false;
    }
    
    // FIXED: Schedule state reset instead of immediate transition
    scheduleStateReset();
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
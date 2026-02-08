// 3D Avatar Controller using Three.js with Animation Support and Lip Sync
class AvatarController {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.avatar = null;
    this.animationId = null;
    this.isInitialized = false;
    this.isReady = false;
    
    // Animation system
    this.mixer = null;
    this.animations = {};
    this.currentAction = null;
    this.currentState = 'idle';
    this.clock = new THREE.Clock();
    
    // Animation state flags
    this.isSpeaking = false;
    this.isListening = false;
    this.isThinking = false;
    
    // Lip Sync System
    this.lipSyncEnabled = true;
    this.morphTargets = null; 
    this.targetViseme = 'Silence';
    this.morphTransitionSpeed = 0.6;
    
    // Full Phoneme List
    this.visemes = ['A','E','I','O','U','B','M','P','Q','W','F','V','L','R','Th','Silence'];
    
    // Initialize weights
    this.currentMorphWeights = {};
    this.visemes.forEach(v => {
      this.currentMorphWeights[v] = 0.0;
    });
    
    // Audio analysis - FIXED: More robust audio connection
    this.audioContext = null;
    this.analyser = null;
    this.frequencyData = null;
    this.isAnalyzingAudio = false;
    this.analysisLoopRunning = false; // NEW: Track if loop is active
    this.currentAudioSource = null; // NEW: Track current audio source
    
    this.init();
  }

  init() {
    if (!this.container) {
      console.error('Avatar container not found');
      return;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 1.5, 3);
    this.camera.lookAt(0, 1.5, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.setupLights();
    this.createAvatar();

    window.addEventListener('resize', () => this.onWindowResize());
    this.animate();

    this.isInitialized = true;
    console.log('✅ Avatar initialized');
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfffaf0, 1.2); 
    keyLight.position.set(-5, 5, 5);
    keyLight.castShadow = true;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.8);
    fillLight.position.set(5, 2, 2);
    this.scene.add(fillLight);

    const rimLight = new THREE.SpotLight(0xffffff, 2);
    rimLight.position.set(0, 5, -5);
    rimLight.target.position.set(0, 1.5, 0);
    this.scene.add(rimLight);
  }

  createAvatar() {
    const loader = new THREE.GLTFLoader();
    const modelPath = 'assets/models/avatar.glb';

    console.log('📄 Loading avatar model...');

    loader.load(
      modelPath,
      (gltf) => {
        this.avatar = gltf.scene;
        this.avatar.position.set(0, 1, -3);
        
        this.avatar.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
            
            if (node.morphTargetDictionary && node.morphTargetInfluences) {
              const availableKeys = Object.keys(node.morphTargetDictionary);
              if (!this.morphTargets && this.visemes.some(v => availableKeys.includes(v))) {
                  this.morphTargets = node;
                  console.log('🎭 Linked morph targets from:', node.name);
              }
            }
          }
        });

        this.scene.add(this.avatar);
        this.setupAnimations(gltf);
      },
      undefined,
      (error) => console.error('❌ Error loading GLB:', error)
    );
  }

  setupAnimations(gltf) {
    if (!gltf.animations || gltf.animations.length === 0) return;

    this.mixer = new THREE.AnimationMixer(this.avatar);
    const findClip = (name) => gltf.animations.find(clip => clip.name.toLowerCase().includes(name));

    let idleClip = findClip('idle') || gltf.animations[0];
    let listenClip = findClip('listen') || gltf.animations[1] || idleClip;
    let talkClip = findClip('talk') || gltf.animations[2] || idleClip;
    let thinkClip = findClip('think') || gltf.animations[3] || idleClip;

    this.animations.idle = this.mixer.clipAction(idleClip);
    this.animations.idle.setLoop(THREE.LoopRepeat);

    this.animations.listen = this.mixer.clipAction(listenClip);
    this.animations.listen.setLoop(THREE.LoopRepeat);
    
    this.animations.talk = this.mixer.clipAction(talkClip);
    this.animations.talk.setLoop(THREE.LoopRepeat);

    this.animations.think = this.mixer.clipAction(thinkClip);
    this.animations.think.setLoop(THREE.LoopRepeat);

    this.playAnimation('idle');
    this.isReady = true;
  }

  playAnimation(stateName) {
    if (!this.mixer || !this.animations[stateName]) return;
    if (this.currentState === stateName && this.currentAction && this.currentAction.isRunning()) return;

    const newAction = this.animations[stateName];
    Object.values(this.animations).forEach(action => {
      if (action !== newAction && action.isRunning()) action.fadeOut(0.3);
    });

    newAction.reset();
    newAction.fadeIn(0.3);
    newAction.play();

    this.currentAction = newAction;
    this.currentState = stateName;
  }

  // ==================== IMPROVED LIP SYNC ====================

  // FIXED: More robust audio connection that persists across chunks
  connectAudioSourceForLipSync(sourceNode) {
    if (!this.lipSyncEnabled || !this.morphTargets) return;

    try {
      const sourceContext = sourceNode.context;
      
      // FIXED: Check if context changed or analyzer is invalid
      const needsNewAnalyser = !this.analyser || 
                               !this.audioContext || 
                               this.audioContext !== sourceContext ||
                               this.audioContext.state === 'closed';
      
      if (needsNewAnalyser) {
        console.log('🔄 Creating new audio analyser (context changed or invalid)');
        this.audioContext = sourceContext;
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.1;
        this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
      }

      // Connect the source to analyser
      sourceNode.connect(this.analyser);
      this.currentAudioSource = sourceNode;
      
      // FIXED: Start analysis loop only if not already running AND we're speaking
      if (!this.analysisLoopRunning && this.isSpeaking) {
        this.analysisLoopRunning = true;
        this.isAnalyzingAudio = true;
        this.continuousLipSyncAnalysis();
        console.log('🎤 Started lip sync analysis loop');
      } else if (this.isSpeaking) {
        // Already running, just flag that we're analyzing
        this.isAnalyzingAudio = true;
      }
    } catch (error) {
      console.error('❌ Error connecting audio for lip sync:', error);
      // Reset on error so it retries next time
      this.analyser = null;
      this.audioContext = null;
    }
  }

  // FIXED: Analysis loop now continues as long as isSpeaking is true
  continuousLipSyncAnalysis() {
    // Stop condition: only when NOT speaking
    if (!this.isSpeaking) {
      console.log('🛑 Stopping lip sync analysis - not speaking');
      this.analysisLoopRunning = false;
      this.isAnalyzingAudio = false;
      this.setTargetViseme('Silence');
      return;
    }

    // Analyze current audio if we have data
    if (this.analyser && this.frequencyData) {
      this.analyser.getByteFrequencyData(this.frequencyData);
      const viseme = this.hybridDetection(this.frequencyData);
      this.setTargetViseme(viseme);
    } else {
      // No audio data yet, default to silence
      this.setTargetViseme('Silence');
    }

    // Continue loop as long as we're speaking
    requestAnimationFrame(() => this.continuousLipSyncAnalysis());
  }

  hybridDetection(data) {
    const binSize = 24000 / this.analyser.fftSize; 
    let totalEnergy = 0;
    
    let trebleEnergy = 0;
    const trebleStart = Math.floor(3000 / binSize);
    
    for (let i = 0; i < data.length; i++) {
        totalEnergy += data[i];
        if (i > trebleStart) trebleEnergy += data[i];
    }
    const avgEnergy = totalEnergy / data.length;

    // 1. Silence Check
    if (avgEnergy < 5) return 'Silence';
    
    // 2. Closed Mouth Consonants
    if (avgEnergy < 25) {
        const r = Math.random();
        if (r < 0.4) return 'M';
        if (r < 0.8) return 'B';
        return 'P';
    }

    // 3. Fricatives (High Frequency Noise)
    if ((trebleEnergy / (totalEnergy + 1)) > 0.20) {
        const r = Math.random();
        if (r < 0.33) return 'F';
        if (r < 0.66) return 'V';
        return 'Th';
    }

    // 4. Vowels & Semivowels (Formant Analysis)
    const peaks = this.findPeaks(data, binSize);
    
    if (peaks.length < 2) return 'A';

    const F1 = peaks[0].freq;
    const F2 = peaks[1].freq;

    // Formant Mapping
    if (F1 > 550) {
        if (F2 > 1650) return 'E';
        if (F2 > 1100) return 'A';
        return 'L';
    } else {
        if (F2 > 1900) return 'I';
        if (F2 > 1500) return 'R';
        if (F2 > 950) return 'O';
        
        const r = Math.random();
        if (r < 0.5) return 'U';
        return 'W';
    }
  }

  findPeaks(data, binSize) {
    const peaks = [];
    const threshold = 40;
    
    for(let i = 2; i < data.length - 2; i++) {
        if (data[i] > threshold && 
            data[i] > data[i-1] && 
            data[i] > data[i+1]) {
            peaks.push({ freq: i * binSize, amp: data[i] });
        }
    }
    
    return peaks
        .filter(p => p.freq > 150 && p.freq < 4000)
        .sort((a,b) => b.amp - a.amp)
        .slice(0, 3)
        .sort((a,b) => a.freq - b.freq);
  }

  setTargetViseme(viseme) {
    if (this.targetViseme !== viseme) {
      this.targetViseme = viseme;
    }
  }

  updateMorphTargets() {
    if (!this.morphTargets || !this.lipSyncEnabled) return;

    this.visemes.forEach(viseme => {
      const targetWeight = (viseme === this.targetViseme) ? 1.0 : 0.0;
      const currentWeight = this.currentMorphWeights[viseme];
      
      // Snappy Interpolation
      if (Math.abs(currentWeight - targetWeight) > 0.001) {
        this.currentMorphWeights[viseme] += (targetWeight - currentWeight) * this.morphTransitionSpeed;
      } else {
        this.currentMorphWeights[viseme] = targetWeight;
      }

      if (this.morphTargets.morphTargetDictionary[viseme] !== undefined) {
        const index = this.morphTargets.morphTargetDictionary[viseme];
        this.morphTargets.morphTargetInfluences[index] = this.currentMorphWeights[viseme];
      }
    });
  }

  // FIXED: Ensure lip sync starts and stays active
  startSpeaking() {
    console.log('🎙️ Avatar startSpeaking() called');
    this.isSpeaking = true;
    this.isThinking = false;
    this.isListening = false;
    this.playAnimation('talk');
    
    // FIXED: Always ensure analysis starts when speaking begins
    if (!this.analysisLoopRunning && this.lipSyncEnabled) {
      this.analysisLoopRunning = true;
      this.isAnalyzingAudio = true;
      this.continuousLipSyncAnalysis();
      console.log('🎤 Started lip sync from startSpeaking()');
    }
  }

  stopSpeaking() {
    console.log('🛑 Avatar stopSpeaking() called');
    this.isSpeaking = false;
    this.isAnalyzingAudio = false;
    this.analysisLoopRunning = false; // FIXED: Explicitly stop loop
    this.setTargetViseme('Silence'); 
    
    if (this.isListening) {
      this.playAnimation('listen');
    } else if (this.isThinking) {
      this.playAnimation('think');
    } else {
      this.playAnimation('idle');
    }
  }

  startListening() {
    this.isListening = true;
    this.isThinking = false;
    if (!this.isSpeaking) this.playAnimation('listen');
  }

  stopListening() {
    this.isListening = false;
    if (!this.isSpeaking && !this.isThinking) {
      this.playAnimation('idle');
    }
  }

  startThinking() {
    this.isThinking = true;
    this.isListening = false;
    if (!this.isSpeaking) this.playAnimation('think');
  }

  stopThinking() {
    this.isThinking = false;
    if (!this.isSpeaking && !this.isListening) {
      this.playAnimation('idle');
    }
  }

  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    if (this.mixer) {
      this.mixer.update(this.clock.getDelta());
    }

    this.updateMorphTargets();

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  onWindowResize() {
    if (!this.camera || !this.renderer || !this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  destroy() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this.mixer) this.mixer.stopAllAction();
    if (this.audioContext) this.audioContext.close();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.container) this.container.removeChild(this.renderer.domElement);
    }
  }
}

let avatarController = null;
document.addEventListener('DOMContentLoaded', () => {
  avatarController = new AvatarController('avatarCanvas');
  window.avatarController = avatarController;
});
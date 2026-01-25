// 3D Avatar Controller using Three.js with Animation Support
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
    
    this.init();
  }

  init() {
    if (!this.container) {
      console.error('Avatar container not found');
      return;
    }

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 1.5, 3);
    this.camera.lookAt(0, 1.5, 0);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // Add lights
    this.setupLights();

    // Create avatar
    this.createAvatar();

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());

    // Start animation loop
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
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
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

    console.log('🔄 Loading avatar model...');

    loader.load(
      modelPath,
      (gltf) => {
        this.avatar = gltf.scene;
        this.avatar.position.set(0, 1, -3);
        this.avatar.scale.set(1, 1, 1);

        this.avatar.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        this.scene.add(this.avatar);
        
        console.log('✅ Avatar model loaded');
        console.log('📊 Total animations found:', gltf.animations.length);
        
        gltf.animations.forEach((clip, index) => {
          console.log(`   Animation ${index + 1}: "${clip.name}" (${clip.duration.toFixed(2)}s)`);
        });
        
        this.setupAnimations(gltf);
      },
      (xhr) => {
        const percent = Math.round((xhr.loaded / xhr.total) * 100);
        if (percent % 25 === 0 || percent === 100) {
          console.log(`📥 Loading: ${percent}%`);
        }
      },
      (error) => {
        console.error('❌ Error loading GLB:', error);
      }
    );
  }

  setupAnimations(gltf) {
    if (!gltf.animations || gltf.animations.length === 0) {
      console.error('❌ No animations found in GLB file');
      return;
    }

    console.log('🎬 Setting up animations...');

    // Create animation mixer
    this.mixer = new THREE.AnimationMixer(this.avatar);

    // Helper to find animation
    const findClip = (name) => {
      return gltf.animations.find(clip => clip.name.toLowerCase().includes(name));
    };

    // Map animations by name or index
    let idleClip = findClip('idle') || gltf.animations[0];
    let listenClip = findClip('listen') || gltf.animations[1] || idleClip;
    let talkClip = findClip('talk') || gltf.animations[2] || idleClip;
    let thinkClip = findClip('think') || gltf.animations[3] || idleClip;

    // Create actions with LOOP settings
    this.animations.idle = this.mixer.clipAction(idleClip);
    this.animations.idle.setLoop(THREE.LoopRepeat);
    this.animations.idle.clampWhenFinished = false;
    console.log(`   Mapped "idle" to: "${idleClip.name}"`);

    this.animations.listen = this.mixer.clipAction(listenClip);
    this.animations.listen.setLoop(THREE.LoopRepeat);
    this.animations.listen.clampWhenFinished = false;
    console.log(`   Mapped "listen" to: "${listenClip.name}"`);

    this.animations.talk = this.mixer.clipAction(talkClip);
    this.animations.talk.setLoop(THREE.LoopRepeat);
    this.animations.talk.clampWhenFinished = false;
    console.log(`   Mapped "talk" to: "${talkClip.name}"`);

    this.animations.think = this.mixer.clipAction(thinkClip);
    this.animations.think.setLoop(THREE.LoopRepeat);
    this.animations.think.clampWhenFinished = false;
    console.log(`   Mapped "think" to: "${thinkClip.name}"`);

    console.log('🔍 Animation check:', {
      idle: !!this.animations.idle,
      listen: !!this.animations.listen,
      talk: !!this.animations.talk,
      think: !!this.animations.think
    });

    // Start with idle animation
    console.log('▶️ Starting with IDLE animation');
    this.playAnimation('idle');
    
    this.isReady = true;
    console.log('✅ Avatar controller READY for use');
  }

  playAnimation(stateName) {
    if (!this.mixer || !this.animations[stateName]) {
      console.error(`❌ Cannot play animation "${stateName}" - not available`);
      return;
    }

    // Don't restart same animation if already playing
    if (this.currentState === stateName && this.currentAction && this.currentAction.isRunning()) {
      console.log(`⏭️ Already playing "${stateName}", skipping`);
      return;
    }

    const newAction = this.animations[stateName];

    console.log(`🎬 Switching from "${this.currentState}" to "${stateName}"`);

    // Stop all other animations first
    Object.values(this.animations).forEach(action => {
      if (action !== newAction && action.isRunning()) {
        action.fadeOut(0.3);
      }
    });

    // Reset and play new animation
    newAction.reset();
    newAction.fadeIn(0.3);
    newAction.setEffectiveTimeScale(1);
    newAction.setEffectiveWeight(1);
    newAction.play();

    this.currentAction = newAction;
    this.currentState = stateName;
  }

  // Called from script.js when assistant starts speaking
  startSpeaking() {
    console.log('🗣️ startSpeaking() called');
    this.isSpeaking = true;
    this.isThinking = false;
    this.isListening = false;
    this.playAnimation('talk');
  }

  // Called when assistant stops speaking
  stopSpeaking() {
    console.log('🤐 stopSpeaking() called');
    this.isSpeaking = false;
    
    // Return to appropriate state
    if (this.isListening) {
      console.log('   → Returning to LISTEN (user still speaking)');
      this.playAnimation('listen');
    } else if (this.isThinking) {
      console.log('   → Returning to THINK');
      this.playAnimation('think');
    } else {
      console.log('   → Returning to IDLE');
      this.playAnimation('idle');
    }
  }

  // Called when user starts speaking
  startListening() {
    console.log('👂 startListening() called');
    this.isListening = true;
    this.isThinking = false;
    
    // Only switch if not currently speaking
    if (!this.isSpeaking) {
      this.playAnimation('listen');
    }
  }

  // Called when user stops speaking
  stopListening() {
    console.log('⏸️ stopListening() called');
    this.isListening = false;
    
    // Fallback to idle if no other state active
    setTimeout(() => {
      if (!this.isSpeaking && !this.isThinking && !this.isListening) {
        this.playAnimation('idle');
      }
    }, 50);
  }

  // Called when processing/thinking
  startThinking() {
    console.log('🤔 startThinking() called');
    this.isThinking = true;
    this.isListening = false;
    
    if (!this.isSpeaking) {
      this.playAnimation('think');
    }
  }

  // Called when done thinking
  stopThinking() {
    console.log('💡 stopThinking() called');
    this.isThinking = false;
    
    if (!this.isSpeaking && !this.isListening) {
      this.playAnimation('idle');
    }
  }

  // Animation loop - updates every frame
  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    // Update animation mixer with delta time
    if (this.mixer) {
      const delta = this.clock.getDelta();
      this.mixer.update(delta);
    }

    // Render the scene
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
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    if (this.renderer) {
      this.renderer.dispose();
      if (this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }
}

// Initialize avatar when DOM is ready
let avatarController = null;

document.addEventListener('DOMContentLoaded', () => {
  avatarController = new AvatarController('avatarCanvas');
  window.avatarController = avatarController;
});

if (!window.avatarController) {
  window.avatarController = null;
}

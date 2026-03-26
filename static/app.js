// CONECTEEN - Premium Chat Application JavaScript
// File: static/app.js

// ===========================================
// GLOBAL STATE & CONFIGURATION
// ===========================================

const CONFIG = {
    ICE_SERVERS: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ],
    SOCKET_OPTIONS: {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    },
    TYPING_TIMEOUT: 1000, // ms
    LATENCY_CHECK_INTERVAL: 3000, // ms
    RECONNECT_DELAY: 2000 // ms
};

// Global state
let state = {
    socket: null,
    connected: false,
    localStream: null,
    remoteStream: null,
    peerConnection: null,
    isVideoActive: false,
    isAI: false,
    roomId: null,
    currentPartner: null,
    isSearching: false,
    typingTimeout: null,
    latencyInterval: null,
    mediaDevices: {
        cameras: [],
        microphones: []
    }
};

// ===========================================
// DOM ELEMENT REFERENCES
// ===========================================

const elements = {
    // Status elements
    statusIndicator: document.getElementById('statusIndicator'),
    statusMessage: document.getElementById('statusMessage'),
    latencyValue: document.getElementById('latencyValue'),
    qualityValue: document.getElementById('qualityValue'),
    
    // Video elements
    localVideo: document.getElementById('localVideo'),
    remoteVideo: document.getElementById('remoteVideo'),
    localVideoFeed: document.getElementById('localVideoFeed'),
    remoteVideoFeed: document.getElementById('remoteVideo'),
    localPlaceholder: document.getElementById('localPlaceholder'),
    strangerPlaceholder: document.getElementById('strangerPlaceholder'),
    
    // Control elements
    micToggle: document.getElementById('micToggle'),
    cameraToggle: document.getElementById('cameraToggle'),
    nextBtn: document.getElementById('nextBtn'),
    videoToggle: document.getElementById('videoToggle'),
    videoToggleText: document.getElementById('videoToggleText'),
    
    // Chat elements
    messageInput: document.getElementById('messageInput'),
    sendButton: document.getElementById('sendButton'),
    messagesContainer: document.getElementById('messagesContainer'),
    typingIndicator: document.getElementById('typingIndicator'),
    typingText: document.getElementById('typingText'),
    quickActions: document.getElementById('quickActions'),
    
    // Partner info
    partnerName: document.getElementById('partnerName'),
    partnerStatus: document.getElementById('partnerStatus'),
    partnerAvatar: document.getElementById('partnerAvatar'),
    aiBadge: document.getElementById('aiBadge'),
    
    // Toast container
    toastContainer: document.getElementById('toastContainer'),
    
    // App containers
    loadingScreen: document.getElementById('loadingScreen'),
    appContainer: document.getElementById('appContainer'),
    mobileTabs: document.getElementById('mobileTabs'),
    
    // Settings elements
    settingsModal: document.getElementById('settingsModal'),
    cameraSelect: document.getElementById('cameraSelect'),
    micSelect: document.getElementById('micSelect')
};

// ===========================================
// INITIALIZATION
// ===========================================

/**
 * Main initialization function
 */
function initApp() {
    console.log('🚀 Initializing CONECTEEN Premium Chat');
    
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    state.roomId = urlParams.get('room') || null;
    state.isAI = urlParams.get('ai') === 'true';
    const isVideo = urlParams.get('video') === 'true';
    const isInstant = urlParams.get('instant') === 'true';
    
    // Update UI based on connection type
    updateUIForConnectionType(state.isAI, isInstant);
    
    // Initialize Socket.IO connection
    initializeSocket();
    
    // Initialize WebRTC
    initializeWebRTC();
    
    // Start latency monitoring
    startLatencyMonitoring();
    
    // Initialize media devices
    initializeMediaDevices();
    
    // Set up event listeners
    setupEventListeners();
    
    // Start video if requested
    if (isVideo) {
        setTimeout(() => toggleVideoChat(), 1000);
    }
    
    // Hide loading screen
    setTimeout(() => {
        if (elements.loadingScreen) {
            elements.loadingScreen.style.display = 'none';
        }
        if (elements.appContainer) {
            elements.appContainer.style.display = 'grid';
        }
    }, 500);
    
    // Check mobile view
    checkMobileView();
    
    console.log('✅ App initialized successfully');
}

/**
 * Update UI based on connection type
 */
function updateUIForConnectionType(isAI, isInstant) {
    if (isAI) {
        // AI Chat mode
        updatePartnerInfo('AI Assistant', 'Online', 'robot');
        if (elements.aiBadge) elements.aiBadge.style.display = 'inline';
        updateStatus('connected', 'Connected to AI');
        
        if (isInstant) {
            showToast('⚡ Connected to AI instantly!', 'success');
            setTimeout(() => addMessage('👋 Hi! I\'m your AI chat partner. How can I help you today?', 'stranger', true), 500);
        } else {
            showToast('Connected to AI', 'success');
            setTimeout(() => addMessage('Hello! I\'m ready to chat!', 'stranger', true), 500);
        }
        
        if (elements.quickActions) elements.quickActions.style.display = 'flex';
        
        // Emit AI chat start event
        if (state.socket) {
            state.socket.emit('start_ai_chat');
        }
    } else {
        // Human chat mode
        updatePartnerInfo('Stranger', 'Searching...', 'user');
        updateStatus('searching', 'Searching for stranger...');
        
        if (elements.quickActions) elements.quickActions.style.display = 'none';
        
        // Start searching for human
        setTimeout(() => {
            if (state.socket) {
                state.socket.emit('find_human');
                state.isSearching = true;
            }
        }, 1000);
    }
}

// ===========================================
// SOCKET.IO EVENT HANDLING
// ===========================================

/**
 * Initialize Socket.IO connection
 */
function initializeSocket() {
    console.log('🔌 Connecting to chat server...');
    
    // Create Socket.IO connection
    state.socket = io(CONFIG.SOCKET_OPTIONS);
    
    // Socket event handlers
    state.socket.on('connect', handleSocketConnect);
    state.socket.on('disconnect', handleSocketDisconnect);
    state.socket.on('connect_error', handleSocketError);
    
    // Chat events
    state.socket.on('connected', handleConnected);
    state.socket.on('waiting', handleWaiting);
    state.socket.on('match_found', handleMatchFound);
    state.socket.on('partner_disconnected', handlePartnerDisconnected);
    state.socket.on('new_message', handleNewMessage);
    state.socket.on('ai_message', handleAIMessage);
    state.socket.on('partner_typing', handlePartnerTyping);
    
    // WebRTC events
    state.socket.on('webrtc_offer', handleWebRTCOffer);
    state.socket.on('webrtc_answer', handleWebRTCAnswer);
    state.socket.on('webrtc_ice_candidate', handleWebRTCIceCandidate);
    
    // Search events
    state.socket.on('searching', handleSearching);
    state.socket.on('searching_new', handleSearchingNew);
}

/**
 * Handle socket connection
 */
function handleSocketConnect() {
    console.log('✅ Connected to chat server');
    state.connected = true;
    updateStatus('searching', 'Connected to server');
    showToast('Connected to chat server', 'success');
}

/**
 * Handle socket disconnection
 */
function handleSocketDisconnect() {
    console.log('❌ Disconnected from chat server');
    state.connected = false;
    updateStatus('disconnected', 'Disconnected from server');
    showToast('Disconnected from server', 'error');
    
    // Try to reconnect
    setTimeout(() => {
        if (!state.connected) {
            console.log('🔄 Attempting to reconnect...');
            state.socket.connect();
        }
    }, CONFIG.RECONNECT_DELAY);
}

/**
 * Handle socket error
 */
function handleSocketError(error) {
    console.error('Socket error:', error);
    showToast('Connection error. Please check your internet.', 'error');
}

/**
 * Handle initial connection response
 */
function handleConnected(data) {
    console.log('Server connected:', data);
}

/**
 * Handle waiting for match
 */
function handleWaiting(data) {
    console.log('⏳ Waiting for match:', data);
    updateStatus('searching', `Waiting for stranger... (Position: ${data.queue_position || 1})`);
    state.isSearching = true;
    
    if (data.message) {
        addSystemMessage(data.message);
    }
}

/**
 * Handle match found
 */
/**
 * Handle match found - FIXED
 */
function handleMatchFound(data) {
    console.log('🤝 Match found:', data);
    state.roomId = data.room_id;
    state.isSearching = false;
    state.currentPartner = data.partner_id || 'stranger';
    
    // Join the room FIRST
    if (state.socket) {
        state.socket.emit('join_room', { room: state.roomId });
        console.log('📡 Joined room:', state.roomId);
    }
    
    // Update UI
    updatePartnerInfo('Stranger', 'Online', 'user');
    updateStatus('connected', 'Connected with stranger');
    showToast('🤝 Connected with a stranger!', 'success');
    
    // Clear placeholder
    if (elements.strangerPlaceholder) {
        elements.strangerPlaceholder.style.display = 'none';
    }
    
    // Add welcome message
    addSystemMessage('Connected with a stranger! Say hello!');
    
    // Show connection animation
    showConnectionAnimation();
    
    // IMPORTANT: If video was requested, start it AFTER we have a room
    const urlParams = new URLSearchParams(window.location.search);
    const isVideoRequested = urlParams.get('video') === 'true';
    if (isVideoRequested && !state.isVideoActive) {
        console.log('🎥 Auto-starting video chat after match');
        setTimeout(() => {
            startVideoChat();
        }, 500);
    }
}

/**
 * Handle partner disconnection
 */
function handlePartnerDisconnected(data) {
    console.log('Partner disconnected:', data);
    updatePartnerInfo('Stranger', 'Disconnected', 'user');
    updateStatus('searching', 'Stranger disconnected');
    
    // Clean up WebRTC
    cleanupWebRTC();
    
    // Show placeholder
    if (elements.strangerPlaceholder) {
        elements.strangerPlaceholder.style.display = 'flex';
    }
    
    // Show notification
    if (data.message) {
        addSystemMessage(data.message);
        showToast(data.message, 'warning');
    }
    
    // Check auto-skip setting
    const autoSkip = document.getElementById('autoSkip')?.checked;
    if (autoSkip && !state.isAI) {
        setTimeout(() => {
            addSystemMessage('🔄 Finding new stranger...');
            if (state.socket) {
                state.socket.emit('find_human');
                state.isSearching = true;
            }
        }, 2000);
    }
}

/**
 * Handle new message from partner
 */
function handleNewMessage(data) {
    console.log('New message:', data);
    addMessage(data.text, 'stranger');
    hideTypingIndicator();
}

/**
 * Handle AI message
 */
function handleAIMessage(data) {
    console.log('AI message:', data);
    addMessage(data.text, 'stranger', true);
    hideTypingIndicator();
}

/**
 * Handle partner typing indicator
 */
function handlePartnerTyping(data) {
    if (data.typing) {
        showTypingIndicator('Stranger is typing...');
    } else {
        hideTypingIndicator();
    }
}

/**
 * Handle searching event
 */
function handleSearching(data) {
    updateStatus('searching', data.message || 'Searching...');
    if (data.message) {
        addSystemMessage(data.message);
    }
}

/**
 * Handle searching new event
 */
function handleSearchingNew(data) {
    updateStatus('searching', data.message || 'Finding new stranger...');
    if (data.message) {
        addSystemMessage(data.message);
    }
}

// ===========================================
// WEBRTC FUNCTIONS
// ===========================================

/**
 * Initialize WebRTC
 */
function initializeWebRTC() {
    console.log('Initializing WebRTC...');
    
    // Check if WebRTC is supported
    if (!navigator.mediaDevices || !window.RTCPeerConnection) {
        console.error('WebRTC not supported');
        showToast('WebRTC is not supported in your browser', 'error');
        return;
    }
    
    // Create peer connection
    createPeerConnection();
}

/**
 * Create WebRTC peer connection
 */
function createPeerConnection() {
    try {
        state.peerConnection = new RTCPeerConnection({
            iceServers: CONFIG.ICE_SERVERS
        });
        
        // Set up event handlers
        state.peerConnection.onicecandidate = handleICECandidate;
        state.peerConnection.ontrack = handleRemoteTrack;
        state.peerConnection.oniceconnectionstatechange = handleICEConnectionStateChange;
        state.peerConnection.onsignalingstatechange = handleSignalingStateChange;
        
        console.log('✅ Peer connection created');
    } catch (error) {
        console.error('Error creating peer connection:', error);
        showToast('Failed to create video connection', 'error');
    }
}

/**
 * Handle ICE candidate
 */
function handleICECandidate(event) {
    if (event.candidate && state.socket && state.roomId) {
        state.socket.emit('webrtc_ice_candidate', {
            candidate: event.candidate,
            room_id: state.roomId
        });
    }
}

/**
 * Handle remote track (video/audio)
 */
function handleRemoteTrack(event) {
    console.log('Remote track received:', event);
    
    if (!state.remoteStream) {
        state.remoteStream = new MediaStream();
    }
    
    event.streams[0].getTracks().forEach(track => {
        state.remoteStream.addTrack(track);
    });
    
    // Set remote video source
    if (elements.remoteVideoFeed) {
        elements.remoteVideoFeed.srcObject = state.remoteStream;
    }
    
    // Hide placeholder
    if (elements.strangerPlaceholder) {
        elements.strangerPlaceholder.style.display = 'none';
    }
    
    showToast('Video stream connected', 'success');
}

/**
 * Handle ICE connection state change
 */
function handleICEConnectionStateChange() {
    if (!state.peerConnection) return;
    
    const state = state.peerConnection.iceConnectionState;
    console.log('ICE connection state:', state);
    
    switch (state) {
        case 'connected':
            updateStatus('connected', 'Video connected');
            break;
        case 'disconnected':
            updateStatus('disconnected', 'Video disconnected');
            break;
        case 'failed':
            updateStatus('disconnected', 'Video connection failed');
            break;
    }
}

/**
 * Handle signaling state change
 */
function handleSignalingStateChange() {
    if (!state.peerConnection) return;
    console.log('Signaling state:', state.peerConnection.signalingState);
}

/**
 * Handle WebRTC offer
 */
/**
 * Handle WebRTC offer - FIXED
 */
async function handleWebRTCOffer(data) {
    console.log('📥 Received WebRTC offer:', data);
    
    // Extract the offer correctly - it might be in data.offer or data itself
    let offer = data;
    if (data && data.offer) {
        offer = data.offer;
    }
    
    if (!offer || !offer.type) {
        console.error('❌ Invalid offer received:', offer);
        return;
    }
    
    if (!state.peerConnection) {
        createPeerConnection();
    }
    
    try {
        console.log('📥 Setting remote description with offer');
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('✅ Remote description set from offer');
        
        // Get user media if not already done
        if (!state.localStream) {
            console.log('📹 Getting user media for answer...');
            const stream = await getUserMedia();
            if (!stream) {
                console.error('❌ Failed to get user media for answer');
                return;
            }
            
            // Show local video
            if (elements.localVideoFeed) {
                elements.localVideoFeed.srcObject = stream;
                elements.localVideoFeed.play();
            }
            if (elements.localPlaceholder) {
                elements.localPlaceholder.style.display = 'none';
            }
            
            // Add local tracks to peer connection
            stream.getTracks().forEach(track => {
                state.peerConnection.addTrack(track, stream);
                console.log('📹 Added track to answer:', track.kind);
            });
        }
        
        // Create answer
        console.log('📤 Creating WebRTC answer...');
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        console.log('✅ Created and set local answer');
        
        // Send answer
        if (state.socket && state.roomId) {
            state.socket.emit('webrtc_answer', {
                answer: answer,
                room_id: state.roomId
            });
            console.log('📤 Sent WebRTC answer');
        }
    } catch (error) {
        console.error('❌ Error handling WebRTC offer:', error);
        showToast('Failed to establish video connection', 'error');
    }
}

/**
 * Handle WebRTC answer
 */
/**
 * Handle WebRTC answer - FIXED
 */
async function handleWebRTCAnswer(data) {
    console.log('📥 Received WebRTC answer:', data);
    
    // Extract the answer correctly
    let answer = data;
    if (data && data.answer) {
        answer = data.answer;
    }
    
    if (!answer || !answer.type) {
        console.error('❌ Invalid answer received:', answer);
        return;
    }
    
    if (state.peerConnection) {
        try {
            console.log('📥 Setting remote description with answer');
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('✅ Remote description set from answer');
            
            // Update status
            updateStatus('connected', 'Video connected');
            showToast('✅ Video connection established!', 'success');
        } catch (error) {
            console.error('❌ Error handling WebRTC answer:', error);
        }
    } else {
        console.error('❌ No peer connection for answer');
    }
}

/**
 * Handle WebRTC ICE candidate
 */
/**
 * Handle WebRTC ICE candidate - FIXED
 */
async function handleWebRTCIceCandidate(data) {
    console.log('📥 Received ICE candidate:', data);
    
    // Extract the candidate correctly
    let candidate = data;
    if (data && data.candidate) {
        candidate = data.candidate;
    }
    
    if (!candidate || !candidate.candidate) {
        console.warn('⚠️ Invalid candidate received');
        return;
    }
    
    if (state.peerConnection) {
        try {
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('✅ Added ICE candidate');
        } catch (error) {
            console.error('❌ Error adding ICE candidate:', error);
        }
    }
}

// ===========================================
// MEDIA HANDLING
// ===========================================

/**
 * Get user media (camera & microphone)
 */
async function getUserMedia(constraints = null) {
    if (!constraints) {
        constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };
    }
    
    try {
        state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Set local video source
        if (elements.localVideoFeed) {
            elements.localVideoFeed.srcObject = state.localStream;
        }
        
        // Hide placeholder
        if (elements.localPlaceholder) {
            elements.localPlaceholder.style.display = 'none';
        }
        
        // Update control buttons
        updateMediaControls();
        
        console.log('✅ Got user media');
        return state.localStream;
    } catch (error) {
        console.error('Error getting user media:', error);
        
        // Handle specific errors
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            showToast('No camera/microphone found', 'error');
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            showToast('Camera/microphone is already in use', 'error');
        } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
            showToast('Camera/microphone constraints cannot be satisfied', 'error');
        } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            showToast('Camera/microphone permission denied', 'error');
        } else if (error.name === 'TypeError') {
            showToast('Invalid constraints specified', 'error');
        } else {
            showToast('Failed to access camera/microphone', 'error');
        }
        
        return null;
    }
}

/**
 * Stop user media
 */
function stopUserMedia() {
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => {
            track.stop();
        });
        state.localStream = null;
    }
    
    if (elements.localVideoFeed) {
        elements.localVideoFeed.srcObject = null;
    }
    
    if (elements.localPlaceholder) {
        elements.localPlaceholder.style.display = 'flex';
    }
    
    updateMediaControls();
}

/**
 * Initialize media devices
 */
async function initializeMediaDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // Filter cameras and microphones
        state.mediaDevices.cameras = devices.filter(device => device.kind === 'videoinput');
        state.mediaDevices.microphones = devices.filter(device => device.kind === 'audioinput');
        
        // Populate device selectors
        populateDeviceSelectors();
        
        console.log('✅ Media devices initialized');
    } catch (error) {
        console.error('Error enumerating devices:', error);
    }
}

/**
 * Populate device selectors
 */
function populateDeviceSelectors() {
    if (elements.cameraSelect) {
        elements.cameraSelect.innerHTML = '<option value="">Select camera...</option>';
        state.mediaDevices.cameras.forEach(camera => {
            const option = document.createElement('option');
            option.value = camera.deviceId;
            option.text = camera.label || `Camera ${elements.cameraSelect.options.length}`;
            elements.cameraSelect.appendChild(option);
        });
    }
    
    if (elements.micSelect) {
        elements.micSelect.innerHTML = '<option value="">Select microphone...</option>';
        state.mediaDevices.microphones.forEach(mic => {
            const option = document.createElement('option');
            option.value = mic.deviceId;
            option.text = mic.label || `Microphone ${elements.micSelect.options.length}`;
            elements.micSelect.appendChild(option);
        });
    }
}

/**
 * Update media controls
 */
function updateMediaControls() {
    if (elements.micToggle && state.localStream) {
        const audioTrack = state.localStream.getAudioTracks()[0];
        if (audioTrack) {
            const isEnabled = audioTrack.enabled;
            elements.micToggle.innerHTML = isEnabled ? 
                '<i class="fas fa-microphone"></i>' : 
                '<i class="fas fa-microphone-slash"></i>';
            elements.micToggle.classList.toggle('active', isEnabled);
            
            // Update status text
            const micStatus = document.getElementById('micStatus');
            if (micStatus) micStatus.textContent = isEnabled ? 'On' : 'Off';
        }
    }
    
    if (elements.cameraToggle && state.localStream) {
        const videoTrack = state.localStream.getVideoTracks()[0];
        if (videoTrack) {
            const isEnabled = videoTrack.enabled;
            elements.cameraToggle.innerHTML = isEnabled ? 
                '<i class="fas fa-video"></i>' : 
                '<i class="fas fa-video-slash"></i>';
            elements.cameraToggle.classList.toggle('active', isEnabled);
            
            // Update status text
            const camStatus = document.getElementById('camStatus');
            if (camStatus) camStatus.textContent = isEnabled ? 'On' : 'Off';
        }
    }
}
/**
 * Force match - Debug function to manually trigger matching
 */
function forceMatch() {
    console.log('🔄 Force matching triggered');
    
    if (!state.socket) {
        console.log('❌ No socket connection');
        showToast('No connection to server', 'error');
        return;
    }
    
    if (state.roomId) {
        console.log('Already in room:', state.roomId);
        showToast('Already connected to a stranger!', 'info');
        return;
    }
    
    console.log('📡 Emitting find_human event');
    state.socket.emit('find_human');
    showToast('🔍 Searching for stranger...', 'info');
    state.isSearching = true;
    updateStatus('searching', 'Searching for stranger...');
}
// ===========================================
// CHAT FUNCTIONS
// ===========================================

/**
 * Send a message
 */
function sendMessage() {
    const messageInput = elements.messageInput;
    if (!messageInput) return;
    
    const text = messageInput.value.trim();
    if (!text || !state.connected || !state.roomId) return;
    
    // Add message to UI
    addMessage(text, 'you');
    
    // Send via socket
    if (state.socket) {
        state.socket.emit('send_message', {
            room_id: state.roomId,
            message: text
        });
        
        // Clear typing indicator
        if (state.typingTimeout) {
            clearTimeout(state.typingTimeout);
            state.typingTimeout = null;
        }
        state.socket.emit('typing_stop', { room_id: state.roomId });
    }
    
    // Clear input
    messageInput.value = '';
    messageInput.focus();
    
    // Add send animation
    if (elements.sendButton) {
        elements.sendButton.classList.add('sending');
        setTimeout(() => {
            elements.sendButton.classList.remove('sending');
        }, 600);
    }
}

/**
 * Send a quick message
 */
function sendQuick(text) {
    if (!state.connected || !state.roomId) return;
    
    addMessage(text, 'you');
    
    if (state.socket) {
        state.socket.emit('send_message', {
            room_id: state.roomId,
            message: text
        });
    }
}

/**
 * Add a message to the chat
 */
function addMessage(text, sender, isAI = false) {
    if (!elements.messagesContainer) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message-bubble ${sender} ${isAI ? 'ai' : ''}`;
    
    const time = new Date().toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    messageDiv.innerHTML = `
        <div class="message-content">${text}</div>
        <div class="message-time">${time}</div>
    `;
    
    elements.messagesContainer.appendChild(messageDiv);
    scrollToBottom();
    
    // Add animation
    messageDiv.classList.add('animate__animated', 'animate__fadeIn');
}

/**
 * Add a system message
 */
function addSystemMessage(text, icon = 'info') {
    if (!elements.messagesContainer) return;
    
    const systemDiv = document.createElement('div');
    systemDiv.className = 'system-message';
    
    const icons = {
        info: 'fas fa-info-circle',
        success: 'fas fa-check-circle',
        warning: 'fas fa-exclamation-circle',
        error: 'fas fa-times-circle'
    };
    
    systemDiv.innerHTML = `
        <i class="${icons[icon] || icons.info}"></i>
        <span>${text}</span>
    `;
    
    elements.messagesContainer.appendChild(systemDiv);
    scrollToBottom();
    
    // Add animation
    systemDiv.classList.add('animate__animated', 'animate__fadeIn');
}

/**
 * Show typing indicator
 */
function showTypingIndicator(text = 'Stranger is typing...') {
    if (!elements.typingIndicator || !elements.typingText) return;
    
    elements.typingText.textContent = text;
    elements.typingIndicator.style.display = 'flex';
    elements.typingIndicator.classList.add('animate__fadeIn');
    scrollToBottom();
}

/**
 * Hide typing indicator
 */
function hideTypingIndicator() {
    if (!elements.typingIndicator) return;
    
    elements.typingIndicator.style.display = 'none';
}

/**
 * Handle typing
 */
function handleTyping() {
    if (!state.connected || !state.roomId || !state.socket) return;
    
    // Send typing start event
    state.socket.emit('typing_start', { room_id: state.roomId });
    
    // Clear previous timeout
    if (state.typingTimeout) {
        clearTimeout(state.typingTimeout);
    }
    
    // Set timeout to send typing stop
    state.typingTimeout = setTimeout(() => {
        if (state.socket) {
            state.socket.emit('typing_stop', { room_id: state.roomId });
        }
        state.typingTimeout = null;
    }, CONFIG.TYPING_TIMEOUT);
}

/**
 * Handle key press in message input
 */
function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

/**
 * Scroll chat to bottom
 */
function scrollToBottom() {
    if (elements.messagesContainer) {
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }
}

// ===========================================
// VIDEO CHAT FUNCTIONS
// ===========================================

/**
 * Toggle video chat
 */
async function toggleVideoChat() {
    if (state.isVideoActive) {
        // Stop video chat
        await endVideoChat();
    } else {
        // Start video chat
        await startVideoChat();
    }
}

/**
 * Start video chat
 */
/**
 * Start video chat - FIXED
 */
async function startVideoChat() {
    console.log('🎥 Starting video chat...');
    console.log('Current state - roomId:', state.roomId, 'connected:', state.connected);
    
    // Check if we have a room first
    if (!state.roomId) {
        console.warn('⚠️ No room ID yet, waiting for match...');
        showToast('Please wait for a stranger to connect first', 'warning');
        return;
    }
    
    try {
        // Get user media
        const stream = await getUserMedia();
        if (!stream) {
            console.error('❌ Failed to get user media');
            showToast('Failed to access camera/microphone', 'error');
            return;
        }
        
        // Show local video
        if (elements.localVideoFeed) {
            elements.localVideoFeed.srcObject = stream;
            elements.localVideoFeed.play().catch(e => console.error('Error playing local video:', e));
        }
        
        // Hide placeholder
        if (elements.localPlaceholder) {
            elements.localPlaceholder.style.display = 'none';
        }
        
        // Create peer connection if not exists
        if (!state.peerConnection) {
            createPeerConnection();
            console.log('✅ Created peer connection');
        }
        
        // Add local tracks to peer connection
        stream.getTracks().forEach(track => {
            if (state.peerConnection) {
                state.peerConnection.addTrack(track, stream);
                console.log('📹 Added track:', track.kind);
            }
        });
        
        // Create and send offer
        if (state.peerConnection && state.socket) {
            console.log('📤 Creating WebRTC offer...');
            const offer = await state.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            await state.peerConnection.setLocalDescription(offer);
            console.log('📤 Local description set, sending offer to room:', state.roomId);
            
            // Send offer via socket
            state.socket.emit('webrtc_offer', {
                offer: offer,
                room_id: state.roomId
            });
            console.log('📤 WebRTC offer sent');
        }
        
        // Update UI state
        state.isVideoActive = true;
        state.localStream = stream;
        
        // Update button
        if (elements.videoToggle) {
            elements.videoToggle.classList.add('active');
            if (elements.videoToggleText) {
                elements.videoToggleText.textContent = 'Stop Video';
            }
        }
        
        // Update status
        updateMediaControls();
        
        // Show notification
        showToast('🎥 Video chat started!', 'success');
        addSystemMessage('Video chat started - waiting for partner to accept...');
        
        console.log('✅ Video chat started successfully');
        
    } catch (error) {
        console.error('❌ Error starting video chat:', error);
        showToast(`Failed to start video: ${error.message}`, 'error');
        
        // Reset state
        state.isVideoActive = false;
        if (elements.videoToggle) {
            elements.videoToggle.classList.remove('active');
            if (elements.videoToggleText) {
                elements.videoToggleText.textContent = 'Start Video';
            }
        }
    }
}

/**
 * End video chat
 */
async function endVideoChat() {
    console.log('Ending video chat...');
    
    // Stop user media
    stopUserMedia();
    
    // Close peer connection
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
    
    // Clear remote stream
    if (state.remoteStream) {
        state.remoteStream = null;
    }
    
    // Update UI
    state.isVideoActive = false;
    if (elements.videoToggle) {
        elements.videoToggle.classList.remove('active');
        if (elements.videoToggleText) {
            elements.videoToggleText.textContent = 'Start Video';
        }
    }
    
    // Show placeholder
    if (elements.strangerPlaceholder) {
        elements.strangerPlaceholder.style.display = 'flex';
    }
    
    // Show notification
    showToast('Video chat ended', 'info');
    addSystemMessage('Video chat ended');
    
    console.log('✅ Video chat ended');
}

/**
 * Clean up WebRTC
 */
function cleanupWebRTC() {
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
    
    if (state.localStream) {
        stopUserMedia();
    }
    
    if (state.remoteStream) {
        state.remoteStream = null;
    }
    
    // Reset video elements
    if (elements.remoteVideoFeed) {
        elements.remoteVideoFeed.srcObject = null;
    }
    
    if (elements.strangerPlaceholder) {
        elements.strangerPlaceholder.style.display = 'flex';
    }
    
    state.isVideoActive = false;
    
    if (elements.videoToggle) {
        elements.videoToggle.classList.remove('active');
        if (elements.videoToggleText) {
            elements.videoToggleText.textContent = 'Start Video';
        }
    }
}

// ===========================================
// CONTROLS FUNCTIONS
// ===========================================

/**
 * Toggle microphone
 */
function toggleMic() {
    if (!state.localStream) return;
    
    const audioTrack = state.localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        updateMediaControls();
        
        showToast(audioTrack.enabled ? 'Microphone enabled' : 'Microphone muted', 'info');
    }
}

/**
 * Toggle camera
 */
function toggleCamera() {
    if (!state.localStream) return;
    
    const videoTrack = state.localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        updateMediaControls();
        
        showToast(videoTrack.enabled ? 'Camera enabled' : 'Camera disabled', 'info');
    }
}

/**
 * Next stranger
 */
function nextStranger() {
    console.log('Finding next stranger...');
    
    // Clean up current connection
    cleanupWebRTC();
    
    // Clear chat
    if (elements.messagesContainer) {
        elements.messagesContainer.innerHTML = '';
    }
    
    // Reset partner info
    updatePartnerInfo('Stranger', 'Searching...', 'user');
    updateStatus('searching', 'Finding next stranger...');
    
    // Add system message
    addSystemMessage('🔄 Finding new stranger...');
    
    // Emit next human event
    if (state.socket) {
        state.socket.emit('next_human');
        state.isSearching = true;
    }
    
    // If AI mode, go back to home
    if (state.isAI) {
        window.location.href = '/';
    }
}

/**
 * Leave chat
 */
function leaveChat() {
    console.log('Leaving chat...');
    
    // Confirm leave
    if (!confirm('Are you sure you want to leave the chat?')) {
        return;
    }
    
    // Clean up
    cleanupWebRTC();
    
    // Disconnect socket
    if (state.socket) {
        state.socket.disconnect();
    }
    
    // Clear intervals
    if (state.latencyInterval) {
        clearInterval(state.latencyInterval);
    }
    
    // Redirect to home
    window.location.href = '/';
}

// ===========================================
// UI FUNCTIONS
// ===========================================

/**
 * Update status indicator
 */
function updateStatus(status, message) {
    // Update status indicator
    if (elements.statusIndicator) {
        elements.statusIndicator.className = 'status-indicator';
        elements.statusIndicator.classList.add(status);
    }
    
    // Update status message
    if (elements.statusMessage) {
        elements.statusMessage.textContent = message || '';
    }
    
    // Update connection quality
    if (status === 'connected' && elements.qualityValue) {
        elements.qualityValue.textContent = 'Excellent';
    } else if (status === 'searching' && elements.qualityValue) {
        elements.qualityValue.textContent = 'Searching';
    } else if (elements.qualityValue) {
        elements.qualityValue.textContent = '--';
    }
}

/**
 * Update partner info
 */
function updatePartnerInfo(name, status, avatarType = 'user') {
    if (elements.partnerName) {
        elements.partnerName.textContent = name;
    }
    
    if (elements.partnerStatus) {
        elements.partnerStatus.textContent = status;
    }
    
    if (elements.partnerAvatar) {
        const icons = {
            user: 'fas fa-user',
            robot: 'fas fa-robot',
            ghost: 'fas fa-ghost'
        };
        elements.partnerAvatar.innerHTML = `<i class="${icons[avatarType] || icons.user}"></i>`;
    }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    if (!elements.toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        info: 'fas fa-info-circle',
        success: 'fas fa-check-circle',
        warning: 'fas fa-exclamation-circle',
        error: 'fas fa-times-circle'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="${icons[type] || icons.info}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    elements.toastContainer.appendChild(toast);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 5000);
}

/**
 * Show connection animation
 */
function showConnectionAnimation() {
    const wave = document.createElement('div');
    wave.className = 'connection-wave';
    document.body.appendChild(wave);
    
    setTimeout(() => {
        wave.remove();
    }, 1200);
}

/**
 * Start latency monitoring
 */
function startLatencyMonitoring() {
    if (state.latencyInterval) {
        clearInterval(state.latencyInterval);
    }
    
    state.latencyInterval = setInterval(() => {
        // Simulate latency (in real app, this would measure actual latency)
        const latency = Math.floor(Math.random() * 50) + 20;
        
        if (elements.latencyValue) {
            elements.latencyValue.textContent = `${latency}ms`;
        }
        
        // Update quality based on latency
        if (elements.qualityValue && !elements.qualityValue.textContent) {
            elements.qualityValue.textContent = latency < 50 ? 'Excellent' : latency < 100 ? 'Good' : 'Poor';
        }
    }, CONFIG.LATENCY_CHECK_INTERVAL);
}

// ===========================================
// SETTINGS FUNCTIONS
// ===========================================

/**
 * Show settings modal
 */
function showSettings() {
    if (elements.settingsModal) {
        elements.settingsModal.style.display = 'flex';
    }
}

/**
 * Hide settings modal
 */
function hideSettings() {
    if (elements.settingsModal) {
        elements.settingsModal.style.display = 'none';
    }
}

/**
 * Save settings
 */
function saveSettings() {
    const settings = {
        autoSkip: document.getElementById('autoSkip')?.checked || false,
        showTyping: document.getElementById('showTyping')?.checked || true,
        soundEffects: document.getElementById('soundEffects')?.checked || true,
        camera: document.getElementById('cameraSelect')?.value || '',
        microphone: document.getElementById('micSelect')?.value || ''
    };
    
    // Save to localStorage
    localStorage.setItem('conecteen_settings', JSON.stringify(settings));
    
    // Apply settings
    applySettings(settings);
    
    // Show notification
    showToast('Settings saved', 'success');
    
    // Hide modal
    hideSettings();
}

/**
 * Apply settings
 */
function applySettings(settings) {
    // Apply auto-skip
    if (settings.autoSkip !== undefined) {
        // This is handled in the partner disconnection logic
    }
    
    // Apply typing indicator
    if (settings.showTyping !== undefined) {
        // This controls whether we show typing indicators
    }
    
    // Apply sound effects
    if (settings.soundEffects !== undefined) {
        // This would control sound effects in a real app
    }
    
    // Apply camera/microphone selection
    if (settings.camera || settings.microphone) {
        const constraints = {
            video: settings.camera ? { deviceId: { exact: settings.camera } } : true,
            audio: settings.microphone ? { deviceId: { exact: settings.microphone } } : true
        };
        
        // Restart media with new devices
        if (state.localStream) {
            stopUserMedia();
            getUserMedia(constraints);
        }
    }
}

/**
 * Load settings
 */
function loadSettings() {
    const saved = localStorage.getItem('conecteen_settings');
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            
            // Apply to form elements
            if (document.getElementById('autoSkip')) {
                document.getElementById('autoSkip').checked = settings.autoSkip || false;
            }
            if (document.getElementById('showTyping')) {
                document.getElementById('showTyping').checked = settings.showTyping !== false;
            }
            if (document.getElementById('soundEffects')) {
                document.getElementById('soundEffects').checked = settings.soundEffects !== false;
            }
            if (document.getElementById('cameraSelect') && settings.camera) {
                document.getElementById('cameraSelect').value = settings.camera;
            }
            if (document.getElementById('micSelect') && settings.microphone) {
                document.getElementById('micSelect').value = settings.microphone;
            }
            
            // Apply settings
            applySettings(settings);
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }
}

// ===========================================
// THEME & MOBILE FUNCTIONS
// ===========================================

/**
 * Toggle theme
 */
function toggleTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    
    if (isDark) {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        localStorage.setItem('theme', 'light');
        showToast('Switched to light theme', 'info');
    } else {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
        localStorage.setItem('theme', 'dark');
        showToast('Switched to dark theme', 'info');
    }
}

/**
 * Load theme
 */
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.classList.add(`${savedTheme}-theme`);
}

/**
 * Toggle chat theme
 */
function toggleChatTheme() {
    // This could toggle chat-specific theme settings
    showToast('Chat theme toggled', 'info');
}

/**
 * Clear chat
 */
function clearChat() {
    if (confirm('Clear all chat messages?')) {
        if (elements.messagesContainer) {
            // Keep system messages
            const systemMessages = Array.from(elements.messagesContainer.querySelectorAll('.system-message'));
            elements.messagesContainer.innerHTML = '';
            systemMessages.forEach(msg => elements.messagesContainer.appendChild(msg));
            
            showToast('Chat cleared', 'info');
        }
    }
}

/**
 * Check mobile view
 */
function checkMobileView() {
    const isMobile = window.innerWidth <= 768;
    
    if (elements.mobileTabs) {
        elements.mobileTabs.style.display = isMobile ? 'flex' : 'none';
    }
    
    // Update tab switching for mobile
    if (isMobile) {
        setupMobileTabs();
    }
}

/**
 * Setup mobile tabs
 */
function setupMobileTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabId = e.currentTarget.getAttribute('onclick').match(/'([^']+)'/)[1];
            switchTab(tabId);
        });
    });
}

/**
 * Switch tab (mobile)
 */
function switchTab(tabId) {
    // Update active tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Show/hide sections
    const sections = {
        video: '.video-section',
        chat: '.chat-section',
        controls: '.controls-section'
    };
    
    Object.entries(sections).forEach(([key, selector]) => {
        const element = document.querySelector(selector);
        if (element) {
            element.style.display = key === tabId ? 'block' : 'none';
        }
    });
}

// ===========================================
// EVENT LISTENERS
// ===========================================

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Window events
    window.addEventListener('resize', checkMobileView);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Message input events
    if (elements.messageInput) {
        elements.messageInput.addEventListener('keypress', handleKeyPress);
        elements.messageInput.addEventListener('input', handleTyping);
    }
    
    // Send button
    if (elements.sendButton) {
        elements.sendButton.addEventListener('click', sendMessage);
    }
    
    // Control buttons
    if (elements.micToggle) {
        elements.micToggle.addEventListener('click', toggleMic);
    }
    
    if (elements.cameraToggle) {
        elements.cameraToggle.addEventListener('click', toggleCamera);
    }
    
    if (elements.nextBtn) {
        elements.nextBtn.addEventListener('click', nextStranger);
    }
    
    if (elements.videoToggle) {
        elements.videoToggle.addEventListener('click', toggleVideoChat);
    }
    
    // Quick action buttons
    document.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const text = e.currentTarget.getAttribute('onclick').match(/'([^']+)'/)[1];
            sendQuick(text);
        });
    });
    
    // Settings
    document.querySelectorAll('[onclick*="showSettings"]').forEach(btn => {
        btn.addEventListener('click', showSettings);
    });
    
    document.querySelectorAll('[onclick*="hideSettings"]').forEach(btn => {
        btn.addEventListener('click', hideSettings);
    });
    
    // Theme toggle
    document.querySelectorAll('[onclick*="toggleTheme"]').forEach(btn => {
        btn.addEventListener('click', toggleTheme);
    });
    
    // Load settings
    loadSettings();
    loadTheme();
}

/**
 * Handle before unload
 */
function handleBeforeUnload(e) {
    if (state.connected) {
        // Clean up
        cleanupWebRTC();
        
        if (state.socket) {
            state.socket.disconnect();
        }
    }
}

// ===========================================
// INITIALIZE APP WHEN DOM IS LOADED
// ===========================================

// Wait for DOM to be fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    // DOM already loaded
    initApp();
}

// Make functions available globally for onclick handlers
window.toggleMic = toggleMic;
window.toggleCamera = toggleCamera;
window.nextStranger = nextStranger;
window.toggleVideoChat = toggleVideoChat;
window.leaveChat = leaveChat;
window.toggleTheme = toggleTheme;
window.showSettings = showSettings;
window.hideSettings = hideSettings;
window.saveSettings = saveSettings;
window.sendMessage = sendMessage;
window.sendQuick = sendQuick;
window.clearChat = clearChat;
window.toggleChatTheme = toggleChatTheme;
window.switchTab = switchTab;
window.forceMatch = forceMatch; 
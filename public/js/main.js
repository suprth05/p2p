document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const homeScreen = document.getElementById('home-screen');
  const chatRoom = document.getElementById('chat-room');
  const createBtn = document.getElementById('create-btn');
  const joinBtn = document.getElementById('join-btn');
  const roomIdInput = document.getElementById('room-id-input');
  const roomIdDisplay = document.getElementById('room-id-display');
  const copyRoomIdBtn = document.getElementById('copy-room-id');
  const leaveBtn = document.getElementById('leave-btn');
  const localVideo = document.getElementById('local-video');
  const videoGrid = document.getElementById('video-grid');
  const waitingScreen = document.getElementById('waiting-screen');
  const micBtn = document.getElementById('mic-btn');
  const videoBtn = document.getElementById('video-btn');
  const screenShareBtn = document.getElementById('screen-share-btn');
  const chatBtn = document.getElementById('chat-btn');
  const fileBtn = document.getElementById('file-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const chatContainer = document.getElementById('chat-container');
  const fileContainer = document.getElementById('file-container');
  const closeChat = document.getElementById('close-chat');
  const closeFile = document.getElementById('close-file');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const messagesContainer = document.getElementById('messages');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettings = document.getElementById('close-settings');
  const videoSource = document.getElementById('video-source');
  const audioSource = document.getElementById('audio-source');
  const videoQuality = document.getElementById('video-quality');
  const bestQuality = document.getElementById('best-quality');
  const aspectRatio = document.getElementById('aspect-ratio');
  const fileInput = document.getElementById('file-input');
  const fileTransfers = document.getElementById('file-transfers');

  // State
  let socket;
  let webrtc;
  let chatManager;
  let fileSharing;
  let currentRoomId = null;
  let isAudioEnabled = true;
  let isVideoEnabled = true;
  let isScreenSharing = false;
  let isChatOpen = false;
  let isFileOpen = false;

  // Initialize application
  function init() {
    socket = io();
    setupSocketEvents();
    setupUIEvents();
  }

  // Socket events setup
  function setupSocketEvents() {
    // Room creation response
    socket.on('room-created', (roomId) => {
      currentRoomId = roomId;
      enterRoom(roomId);
    });

    // Room join response
    socket.on('room-joined', (roomId) => {
      currentRoomId = roomId;
      enterRoom(roomId);
    });

    // Error handling
    socket.on('error', (message) => {
      alert(`Error: ${message}`);
    });
  }

  // UI events setup
  function setupUIEvents() {
    // Create room button
    createBtn.addEventListener('click', () => {
      socket.emit('create-room');
    });

    // Join room button
    joinBtn.addEventListener('click', () => {
      const roomId = roomIdInput.value.trim();
      if (roomId) {
        socket.emit('join-room', roomId);
      } else {
        alert('Please enter a valid room ID');
      }
    });

    // Copy room ID button
    copyRoomIdBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(currentRoomId)
        .then(() => {
          alert('Room ID copied to clipboard!');
        })
        .catch(err => {
          console.error('Failed to copy room ID:', err);
        });
    });

    // Leave button
    leaveBtn.addEventListener('click', () => {
      leaveRoom();
    });

    // Mic button
    micBtn.addEventListener('click', () => {
      toggleAudio();
    });

    // Video button
    videoBtn.addEventListener('click', () => {
      toggleVideo();
    });

    // Screen share button
    screenShareBtn.addEventListener('click', () => {
      toggleScreenShare();
    });

    // Chat button
    chatBtn.addEventListener('click', () => {
      toggleChat();
    });

    // File button
    fileBtn.addEventListener('click', () => {
      toggleFile();
    });

    // Settings button
    settingsBtn.addEventListener('click', () => {
      openSettings();
    });

    // Close chat button
    closeChat.addEventListener('click', () => {
      toggleChat();
    });

    // Close file button
    closeFile.addEventListener('click', () => {
      toggleFile();
    });

    // Close settings button
    closeSettings.addEventListener('click', () => {
      closeSettingsModal();
    });

    // Send message button
    sendBtn.addEventListener('click', () => {
      sendMessage();
    });

    // Send message on enter key
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        sendFile(e.target.files[0]);
      }
    });
  }

  // Enter a room
  async function enterRoom(roomId) {
    try {
      // Initialize WebRTC
      webrtc = new WebRTCConnection();
      const localStream = await webrtc.initialize(socket, roomId);
      
      // Show local video
      localVideo.srcObject = localStream;
      
      // Initialize chat manager
      chatManager = new ChatManager(socket, roomId);
      chatManager.initialize();
      chatManager.setOnNewMessage(displayMessage);
      
      // Initialize file sharing
      fileSharing = new FileSharing(socket, roomId);
      fileSharing.initialize(webrtc.getPeerConnections());
      setupFileCallbacks();
      
      // Display room ID
      roomIdDisplay.textContent = roomId;
      
      // Setup remote stream handling
      webrtc.setOnRemoteStream(handleRemoteStream);
      webrtc.setOnUserDisconnected(handleUserDisconnected);
      
      // Switch screens
      homeScreen.classList.add('hidden');
      chatRoom.classList.remove('hidden');
      
      // Update UI buttons to match initial state
      updateUIState();
    } catch (error) {
      console.error('Error entering room:', error);
      alert(`Failed to join room: ${error.message}`);
    }
  }

  // Leave room
  function leaveRoom() {
    if (webrtc) {
      webrtc.disconnect();
    }
    
    // Clear video grid except local video
    const remoteVideos = document.querySelectorAll('.video-wrapper:not(.local-video-container)');
    remoteVideos.forEach(video => video.remove());
    
    // Clear chat messages
    messagesContainer.innerHTML = '';
    
    // Clear file transfers
    fileTransfers.innerHTML = '';
    
    // Reset state
    currentRoomId = null;
    isAudioEnabled = true;
    isVideoEnabled = true;
    isScreenSharing = false;
    
    // Reset UI
    if (isChatOpen) toggleChat();
    if (isFileOpen) toggleFile();
    
    // Switch screens back to home
    chatRoom.classList.add('hidden');
    homeScreen.classList.remove('hidden');
  }

  // Handle remote stream
  function handleRemoteStream(userId, stream) {
    // Check if this user already has a video element
    const existingVideo = document.getElementById(`video-${userId}`);
    if (existingVideo) {
      // Update existing video
      existingVideo.srcObject = stream;
      return;
    }
    
    // Create new video element
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper';
    videoWrapper.id = `video-wrapper-${userId}`;
    
    const videoElement = document.createElement('video');
    videoElement.id = `video-${userId}`;
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.srcObject = stream;
    
    const videoLabel = document.createElement('div');
    videoLabel.className = 'video-label';
    videoLabel.textContent = `User ${userId.substring(0, 4)}`;
    
    videoWrapper.appendChild(videoElement);
    videoWrapper.appendChild(videoLabel);
    videoGrid.appendChild(videoWrapper);
  }

  // Handle user disconnected
  function handleUserDisconnected(userId) {
    // Remove video element for disconnected user
    const videoWrapper = document.getElementById(`video-wrapper-${userId}`);
    if (videoWrapper) {
      videoWrapper.remove();
    }
  }

  // Display chat message
  function displayMessage(message) {
    const messageElement = document.createElement('div');
    
    if (message.sender === 'system') {
      messageElement.className = 'message system';
    } else if (message.sender === socket.id) {
      messageElement.className = 'message sent';
    } else {
      messageElement.className = 'message received';
    }
    
    messageElement.textContent = message.sender === 'system' ? 
      message.text : 
      `${message.sender.substring(0, 4)}: ${message.text}`;
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Send message
  function sendMessage() {
    const message = chatInput.value.trim();
    if (message) {
      chatManager.sendMessage(message);
      chatInput.value = '';
    }
  }

  // Toggle audio
  function toggleAudio() {
    isAudioEnabled = !isAudioEnabled;
    webrtc.toggleAudio(isAudioEnabled);
    updateUIState();
  }

  // Toggle video
  function toggleVideo() {
    isVideoEnabled = !isVideoEnabled;
    webrtc.toggleVideo(isVideoEnabled);
    updateUIState();
  }

  // Toggle screen share
  async function toggleScreenShare() {
    if (isScreenSharing) {
      const success = await webrtc.stopScreenSharing();
      if (success) {
        isScreenSharing = false;
      }
    } else {
      const success = await webrtc.startScreenSharing();
      if (success) {
        isScreenSharing = true;
      }
    }
    updateUIState();
  }

  // Toggle chat panel
  function toggleChat() {
    isChatOpen = !isChatOpen;
    if (isChatOpen) {
      chatContainer.classList.add('visible');
      if (isFileOpen) {
        // Close file panel if open
        fileContainer.classList.remove('visible');
        isFileOpen = false;
      }
    } else {
      chatContainer.classList.remove('visible');
    }
    updateUIState();
  }

  // Toggle file panel
  function toggleFile() {
    isFileOpen = !isFileOpen;
    if (isFileOpen) {
      fileContainer.classList.add('visible');
      if (isChatOpen) {
        // Close chat panel if open
        chatContainer.classList.remove('visible');
        isChatOpen = false;
      }
    } else {
      fileContainer.classList.remove('visible');
    }
    updateUIState();
  }

  // Open settings modal
  function openSettings() {
    // Load available media devices
    loadMediaDevices();
    settingsModal.classList.remove('hidden');
  }

  // Close settings modal
  function closeSettingsModal() {
    settingsModal.classList.add('hidden');
  }

  // Load media devices
  async function loadMediaDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      // Clear previous options
      videoSource.innerHTML = '';
      audioSource.innerHTML = '';
      
      // Add video devices
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      videoDevices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Camera ${videoSource.length + 1}`;
        videoSource.appendChild(option);
      });
      
      // Add audio devices
      const audioDevices = devices.filter(device => device.kind === 'audioinput');
      audioDevices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Microphone ${audioSource.length + 1}`;
        audioSource.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading media devices:', error);
    }
  }

  // Send file
  async function sendFile(file) {
    try {
      // Create file item in UI
      const fileItemId = `file-item-${Date.now()}`;
      const fileItem = createFileItemElement(fileItemId, file.name, file.size, 'sending');
      fileTransfers.appendChild(fileItem);
      
      // Set up progress callback
      fileSharing.setOnFileSendProgress((data) => {
        updateFileProgress(fileItemId, data.progress);
      });
      
      // Send the file
      await fileSharing.sendFile(file);
      
      // Update UI on completion
      updateFileStatus(fileItemId, 'complete');
    } catch (error) {
      console.error('Error sending file:', error);
      alert(`Failed to send file: ${error.message}`);
    }
  }

  // Setup file transfer callbacks
  function setupFileCallbacks() {
    // File receive start
    fileSharing.setOnFileReceiveStart((data) => {
      const fileItemId = `file-item-${data.fileId}`;
      const fileItem = createFileItemElement(fileItemId, data.fileName, data.fileSize, 'receiving');
      fileTransfers.appendChild(fileItem);
    });
    
    // File receive progress
    fileSharing.setOnFileReceiveProgress((data) => {
      const fileItemId = `file-item-${data.fileId}`;
      updateFileProgress(fileItemId, data.progress);
    });
    
    // File receive complete
    fileSharing.setOnFileReceiveComplete((data) => {
      const fileItemId = `file-item-${data.fileId}`;
      
      if (data.success) {
        updateFileStatus(fileItemId, 'complete');
        
        // Add download button
        const fileItem = document.getElementById(fileItemId);
        if (fileItem) {
          const downloadBtn = document.createElement('a');
          downloadBtn.href = data.downloadUrl;
          downloadBtn.download = data.fileName;
          downloadBtn.className = 'secondary-btn';
          downloadBtn.textContent = 'Download';
          fileItem.querySelector('.file-actions').appendChild(downloadBtn);
        }
      } else {
        updateFileStatus(fileItemId, 'failed');
      }
    });
  }

  // Create file item element
  function createFileItemElement(id, name, size, status) {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.id = id;
    
    const formattedSize = formatFileSize(size);
    const statusText = status === 'sending' ? 'Sending...' : 'Receiving...';
    
    fileItem.innerHTML = `
      <div class="file-item-header">
        <span class="material-icons">insert_drive_file</span>
        <div class="file-item-name">${name}</div>
      </div>
      <div class="file-item-info">${formattedSize} - <span class="status">${statusText}</span></div>
      <div class="file-progress">
        <div class="file-progress-bar" style="width: 0%"></div>
      </div>
      <div class="file-actions"></div>
    `;
    
    return fileItem;
  }

  // Update file progress
  function updateFileProgress(fileItemId, progress) {
    const fileItem = document.getElementById(fileItemId);
    if (fileItem) {
      const progressBar = fileItem.querySelector('.file-progress-bar');
      progressBar.style.width = `${progress}%`;
    }
  }

  // Update file status
  function updateFileStatus(fileItemId, status) {
    const fileItem = document.getElementById(fileItemId);
    if (fileItem) {
      const statusElement = fileItem.querySelector('.status');
      switch (status) {
        case 'complete':
          statusElement.textContent = 'Complete';
          break;
        case 'failed':
          statusElement.textContent = 'Failed';
          fileItem.classList.add('failed');
          break;
        default:
          statusElement.textContent = status;
      }
    }
  }

  // Format file size
  function formatFileSize(bytes) {
    if (bytes < 1024) {
      return bytes + ' B';
    } else if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    } else {
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
  }

  // Update UI state based on current settings
  function updateUIState() {
    // Update mic button
    micBtn.classList.toggle('active', isAudioEnabled);
    micBtn.querySelector('.material-icons').textContent = isAudioEnabled ? 'mic' : 'mic_off';
    
    // Update video button
    videoBtn.classList.toggle('active', isVideoEnabled);
    videoBtn.querySelector('.material-icons').textContent = isVideoEnabled ? 'videocam' : 'videocam_off';
    
    // Update screen share button
    screenShareBtn.classList.toggle('active', isScreenSharing);
    screenShareBtn.querySelector('.material-icons').textContent = isScreenSharing ? 'stop_screen_share' : 'screen_share';
    
    // Update chat button
    chatBtn.classList.toggle('active', isChatOpen);
    
    // Update file button
    fileBtn.classList.toggle('active', isFileOpen);
  }

  // Initialize the application
  init();
});

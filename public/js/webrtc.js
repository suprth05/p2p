class WebRTCConnection {
  constructor() {
    this.peerConnections = {};
    this.localStream = null;
    this.socket = null;
    this.roomId = null;
    this.userId = null;
    this.onRemoteStreamCallback = null;
    this.onUserDisconnectedCallback = null;
    
    this.configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { 
          urls: 'turn:numb.viagenie.ca',
          username: 'webrtc@live.com',
          credential: 'muazkh'
        }
      ]
    };
  }

  async initialize(socket, roomId) {
    this.socket = socket;
    this.roomId = roomId;
    this.userId = socket.id;

    try {
      // Get local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      // Set up socket event listeners
      this.setupSignaling();
      
      // Notify server to get existing users in the room
      this.socket.emit('get-users', roomId);
      
      return this.localStream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      throw error;
    }
  }

  setupSignaling() {
    // Handle list of existing users in the room
    this.socket.on('room-users', async (users) => {
      console.log('Existing users in room:', users);
      for (const userId of users) {
        if (userId !== this.userId) {
          await this.createPeerConnection(userId);
          await this.createOffer(userId);
        }
      }
    });

    // Handle new user connection
    this.socket.on('user-connected', async (userId) => {
      console.log('User connected:', userId);
      await this.createPeerConnection(userId);
      await this.createOffer(userId);
    });

    // Handle offer from another peer
    this.socket.on('offer', async (payload) => {
      const { sender, sdp } = payload;
      console.log('Received offer from:', sender);
      
      if (!this.peerConnections[sender]) {
        await this.createPeerConnection(sender);
      }
      
      const peerConnection = this.peerConnections[sender];
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      this.socket.emit('answer', {
        target: sender,
        sdp: answer
      });
    });

    // Handle answer to our offer
    this.socket.on('answer', async (payload) => {
      const { sender, sdp } = payload;
      console.log('Received answer from:', sender);
      
      const peerConnection = this.peerConnections[sender];
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    });

    // Handle ICE candidate
    this.socket.on('ice-candidate', async (payload) => {
      const { sender, candidate } = payload;
      
      const peerConnection = this.peerConnections[sender];
      if (peerConnection) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Error adding ice candidate:', error);
        }
      }
    });

    // Handle user disconnection
    this.socket.on('user-disconnected', (userId) => {
      console.log('User disconnected:', userId);
      
      if (this.peerConnections[userId]) {
        this.peerConnections[userId].close();
        delete this.peerConnections[userId];
      }
      
      if (this.onUserDisconnectedCallback) {
        this.onUserDisconnectedCallback(userId);
      }
    });
  }

  async createPeerConnection(userId) {
    try {
      const peerConnection = new RTCPeerConnection(this.configuration);
      
      // Add local tracks to the connection
      this.localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, this.localStream);
      });
      
      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('ice-candidate', {
            target: userId,
            candidate: event.candidate
          });
        }
      };
      
      // Handle connection state changes
      peerConnection.onconnectionstatechange = (event) => {
        console.log(`Connection state change: ${peerConnection.connectionState} with ${userId}`);
        if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
          console.log(`Connection with ${userId} failed or disconnected. Attempting reconnect...`);
          peerConnection.restartIce();
        }
      };
      
      // Handle ICE connection state changes
      peerConnection.oniceconnectionstatechange = (event) => {
        console.log(`ICE connection state change: ${peerConnection.iceConnectionState} with ${userId}`);
      };
      
      // Handle remote stream - using ontrack instead of deprecated onaddstream
      peerConnection.ontrack = (event) => {
        console.log('Received remote track from:', userId);
        if (event.streams && event.streams[0]) {
          const remoteStream = event.streams[0];
          if (this.onRemoteStreamCallback) {
            this.onRemoteStreamCallback(userId, remoteStream);
          }
        }
      };
      
      this.peerConnections[userId] = peerConnection;
      return peerConnection;
    } catch (error) {
      console.error('Error creating peer connection:', error);
      throw error;
    }
  }

  async createOffer(userId) {
    try {
      const peerConnection = this.peerConnections[userId];
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peerConnection.setLocalDescription(offer);
      
      this.socket.emit('offer', {
        target: userId,
        sdp: offer
      });
    } catch (error) {
      console.error('Error creating offer:', error);
      throw error;
    }
  }

  setOnRemoteStream(callback) {
    this.onRemoteStreamCallback = callback;
  }

  setOnUserDisconnected(callback) {
    this.onUserDisconnectedCallback = callback;
  }

  toggleAudio(enabled) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  toggleVideo(enabled) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  async startScreenSharing() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });
      
      // Replace video track in all peer connections
      const videoTrack = screenStream.getVideoTracks()[0];
      
      if (!videoTrack) {
        throw new Error("No video track found in screen share stream");
      }
      
      // Handle when screen sharing stops
      videoTrack.onended = async () => {
        await this.stopScreenSharing();
      };
      
      // Replace local stream's video track
      const oldVideoTrack = this.localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        this.localStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      this.localStream.addTrack(videoTrack);
      
      // Replace video track in all peer connections
      for (const userId in this.peerConnections) {
        const peerConnection = this.peerConnections[userId];
        const senders = peerConnection.getSenders();
        const sender = senders.find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(videoTrack);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error starting screen sharing:', error);
      return false;
    }
  }

  async stopScreenSharing() {
    try {
      // Get a new video stream
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: true
      });
      
      const videoTrack = newStream.getVideoTracks()[0];
      
      if (!videoTrack) {
        throw new Error("No video track found in camera stream");
      }
      
      // Replace local stream's video track
      const oldVideoTrack = this.localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        this.localStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      this.localStream.addTrack(videoTrack);
      
      // Replace video track in all peer connections
      for (const userId in this.peerConnections) {
        const peerConnection = this.peerConnections[userId];
        const senders = peerConnection.getSenders();
        const sender = senders.find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(videoTrack);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error stopping screen sharing:', error);
      return false;
    }
  }

  getPeerConnections() {
    return this.peerConnections;
  }

  disconnect() {
    // Close all peer connections
    for (const userId in this.peerConnections) {
      this.peerConnections[userId].close();
    }
    
    // Stop all tracks in local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
    
    this.peerConnections = {};
    this.localStream = null;
  }
}

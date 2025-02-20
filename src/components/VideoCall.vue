<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';

const localVideo = ref<HTMLVideoElement | null>(null);
const remoteVideo = ref<HTMLVideoElement | null>(null);
const localStream = ref<MediaStream | null>(null);
const peerConnection = ref<RTCPeerConnection | null>(null);
const socket = ref<any>(null);
const isAudioMuted = ref(false);
const isVideoEnabled = ref(false);
const isScreenSharing = ref(false);
const remoteVolume = ref(1);
const connectionStatus = ref<'disconnected' | 'connecting' | 'connected'>('disconnected');
const error = ref<string | null>(null);
const roomId = ref<string>('');
const showJoinRoom = ref(true);
const isInitiator = ref(false);

const checkMediaSupport = () => {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
};

const joinRoom = async () => {
  if (!roomId.value.trim()) {
    error.value = 'Veuillez entrer un nom de salle';
    return;
  }
  showJoinRoom.value = false;
  await initializeMedia();
  initializeSocket();
};

const initializeSocket = () => {
  // Utiliser l'URL de production ou localhost en fonction de l'environnement
  const socketUrl = import.meta.env.PROD 
    ? window.location.origin.replace('http', 'ws')  // En production
    : 'http://localhost:3001';                      // En développement

  socket.value = io(socketUrl, {
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });

  socket.value.on('connect', () => {
    console.log('Connected to signaling server');
    socket.value.emit('join-room', roomId.value);
  });

  socket.value.on('connect_error', (error: Error) => {
    console.error('Connection error:', error);
    connectionStatus.value = 'disconnected';
  });

  socket.value.on('room-joined', ({ isFirstUser }) => {
    console.log('Joined room as', isFirstUser ? 'initiator' : 'participant');
    isInitiator.value = isFirstUser;
    connectionStatus.value = 'connecting';
    setupPeerConnection();
  });

  socket.value.on('ready', async () => {
    if (isInitiator.value && peerConnection.value) {
      try {
        console.log('Creating and sending offer...');
        const offer = await peerConnection.value.createOffer();
        await peerConnection.value.setLocalDescription(offer);
        socket.value.emit('offer', { roomId: roomId.value, offer });
      } catch (err) {
        console.error('Error creating offer:', err);
      }
    }
  });

  socket.value.on('offer', async (offer) => {
    if (!isInitiator.value && peerConnection.value) {
      try {
        console.log('Received offer, setting remote description');
        await peerConnection.value.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('Creating and sending answer');
        const answer = await peerConnection.value.createAnswer();
        await peerConnection.value.setLocalDescription(answer);
        socket.value.emit('answer', { roomId: roomId.value, answer });
      } catch (err) {
        console.error('Error handling offer:', err);
        error.value = 'Erreur lors du traitement de l\'offre';
      }
    }
  });

  socket.value.on('answer', async (answer) => {
    if (isInitiator.value && peerConnection.value) {
      try {
        console.log('Received answer, setting remote description');
        const remoteDesc = new RTCSessionDescription(answer);
        await peerConnection.value.setRemoteDescription(remoteDesc);
      } catch (err) {
        console.error('Error handling answer:', err);
        error.value = 'Erreur lors du traitement de la réponse';
      }
    }
  });

  socket.value.on('ice-candidate', async (candidate) => {
    if (peerConnection.value) {
      try {
        await peerConnection.value.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  });

  socket.value.on('peer-disconnected', () => {
    console.log('Peer disconnected');
    connectionStatus.value = 'disconnected';
    if (remoteVideo.value) {
      remoteVideo.value.srcObject = null;
    }
  });

  socket.value.on('room-full', () => {
    error.value = 'La salle est pleine (maximum 2 participants)';
    showJoinRoom.value = true;
  });
};

const initializeMedia = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = false;
    }
    
    localStream.value = stream;
    if (localVideo.value) {
      localVideo.value.srcObject = stream;
    }
  } catch (err) {
    error.value = 'Failed to access camera and microphone';
    console.error('Error accessing media devices:', err);
  }
};

const setupPeerConnection = () => {
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  peerConnection.value = new RTCPeerConnection(configuration);
  
  if (localStream.value) {
    localStream.value.getTracks().forEach(track => {
      if (localStream.value && peerConnection.value) {
        console.log('Adding track to peer connection:', track.kind);
        peerConnection.value.addTrack(track, localStream.value);
      }
    });
  }

  peerConnection.value.ontrack = (event) => {
    console.log('Received remote track:', event.track.kind);
    if (remoteVideo.value && event.streams[0]) {
      remoteVideo.value.srcObject = event.streams[0];
      connectionStatus.value = 'connected';
    }
  };

  peerConnection.value.onicecandidate = (event) => {
    if (event.candidate) {
      socket.value.emit('ice-candidate', {
        roomId: roomId.value,
        candidate: event.candidate
      });
    }
  };

  peerConnection.value.onconnectionstatechange = () => {
    if (peerConnection.value) {
      console.log('Connection state changed:', peerConnection.value.connectionState);
      if (peerConnection.value.connectionState === 'connected') {
        connectionStatus.value = 'connected';
      } else if (peerConnection.value.connectionState === 'disconnected') {
        connectionStatus.value = 'disconnected';
      }
    }
  };

  peerConnection.value.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.value?.iceConnectionState);
  };
};

const toggleAudio = () => {
  if (localStream.value) {
    const audioTrack = localStream.value.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      isAudioMuted.value = !audioTrack.enabled;
    }
  }
};

const toggleVideo = () => {
  if (localStream.value) {
    const videoTrack = localStream.value.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      isVideoEnabled.value = !isVideoEnabled.value;
    }
  }
};

const toggleScreenShare = async () => {
  try {
    if (isScreenSharing.value) {
      if (localStream.value) {
        localStream.value.getTracks().forEach(track => track.stop());
      }
      await initializeMedia();
      
      if (peerConnection.value) {
        const senders = peerConnection.value.getSenders();
        const newTracks = localStream.value?.getTracks() || [];
        
        senders.forEach((sender, idx) => {
          if (newTracks[idx]) {
            sender.replaceTrack(newTracks[idx]);
          }
        });
      }
      
      isScreenSharing.value = false;
    } else {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true,
        audio: true
      });
      
      if (localVideo.value) {
        localVideo.value.srcObject = screenStream;
      }
      
      if (localStream.value) {
        const audioTrack = localStream.value.getAudioTracks()[0];
        if (audioTrack) {
          screenStream.addTrack(audioTrack);
        }
      }
      
      if (peerConnection.value) {
        const senders = peerConnection.value.getSenders();
        const newTracks = screenStream.getTracks();
        
        senders.forEach((sender, idx) => {
          if (newTracks[idx]) {
            sender.replaceTrack(newTracks[idx]);
          }
        });
      }
      
      if (localStream.value) {
        localStream.value.getVideoTracks().forEach(track => track.stop());
      }
      
      localStream.value = screenStream;
      isScreenSharing.value = true;
    }
  } catch (err) {
    error.value = 'Failed to share screen';
    console.error('Error sharing screen:', err);
  }
};

const adjustRemoteVolume = () => {
  if (remoteVideo.value) {
    remoteVideo.value.volume = remoteVolume.value;
  }
};

const endCall = () => {
  if (peerConnection.value) {
    peerConnection.value.close();
  }
  if (localStream.value) {
    localStream.value.getTracks().forEach(track => track.stop());
  }
  if (socket.value) {
    socket.value.disconnect();
  }
  connectionStatus.value = 'disconnected';
  showJoinRoom.value = true;
};

onMounted(() => {
  if (!checkMediaSupport()) {
    error.value = 'WebRTC is not supported in your browser';
    return;
  }
});

onUnmounted(() => {
  endCall();
});
</script>

<template>
  <div class="flex flex-col min-h-screen bg-gray-100 p-4">
    <!-- Error Display -->
    <div v-if="error" class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
      {{ error }}
    </div>

    <!-- Join Room Form -->
    <div v-if="showJoinRoom" class="flex flex-col items-center justify-center min-h-[50vh]">
      <div class="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 class="text-2xl font-bold mb-4 text-center">Rejoindre une salle</h2>
        <div class="mb-4">
          <label for="room-id" class="block text-sm font-medium text-gray-700 mb-2">
            Nom de la salle
          </label>
          <input
            type="text"
            id="room-id"
            v-model="roomId"
            placeholder="Entrez le nom de la salle"
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            @keyup.enter="joinRoom"
          />
        </div>
        <button
          @click="joinRoom"
          class="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors"
        >
          Rejoindre
        </button>
      </div>
    </div>

    <!-- Connection Status -->
    <div v-if="!showJoinRoom" class="text-center mb-4">
      <span class="px-3 py-1 rounded" :class="{
        'bg-green-100 text-green-800': connectionStatus === 'connected',
        'bg-yellow-100 text-yellow-800': connectionStatus === 'connecting',
        'bg-red-100 text-red-800': connectionStatus === 'disconnected'
      }">
        {{ connectionStatus === 'connected' ? 'Connecté' : 
           connectionStatus === 'connecting' ? 'En cours de connexion...' : 'Déconnecté' }}
      </span>
      <span class="ml-2 text-sm text-gray-600">Salle: {{ roomId }}</span>
    </div>

    <!-- Video Grid -->
    <div v-if="!showJoinRoom" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div class="relative">
        <video
          ref="localVideo"
          autoplay
          muted
          playsinline
          class="w-full rounded-lg shadow-lg"
        ></video>
        <div class="absolute bottom-2 left-2 text-white bg-black bg-opacity-50 px-2 py-1 rounded">
          Vous
        </div>
      </div>
      <div class="relative">
        <video
          ref="remoteVideo"
          autoplay
          playsinline
          class="w-full rounded-lg shadow-lg"
        ></video>
        <div class="absolute bottom-2 left-2 text-white bg-black bg-opacity-50 px-2 py-1 rounded">
          Participant distant
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div v-if="!showJoinRoom" class="flex flex-wrap justify-center gap-4 p-4 bg-white rounded-lg shadow">
      <button
        @click="toggleAudio"
        class="px-4 py-2 rounded-full"
        :class="isAudioMuted ? 'bg-red-500 text-white' : 'bg-green-500 text-white'"
      >
        {{ isAudioMuted ? 'Activer le micro' : 'Couper le micro' }}
      </button>

      <button
        @click="toggleVideo"
        class="px-4 py-2 rounded-full"
        :class="isVideoEnabled ? 'bg-green-500 text-white' : 'bg-red-500 text-white'"
      >
        {{ isVideoEnabled ? 'Désactiver la caméra' : 'Activer la caméra' }}
      </button>

      <button
        @click="toggleScreenShare"
        class="px-4 py-2 rounded-full bg-blue-500 text-white"
      >
        {{ isScreenSharing ? 'Arrêter le partage' : 'Partager l\'écran' }}
      </button>

      <div class="flex items-center gap-2">
        <label class="text-sm text-gray-600">Volume distant:</label>
        <input
          type="range"
          v-model="remoteVolume"
          min="0"
          max="1"
          step="0.1"
          @input="adjustRemoteVolume"
          class="w-32"
        />
      </div>

      <button
        @click="endCall"
        class="px-4 py-2 rounded-full bg-red-500 text-white"
      >
        Quitter
      </button>
    </div>
  </div>
</template>
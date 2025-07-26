import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import Peer from "simple-peer";
import axios from 'axios';

const REACTIONS = ['👏', '❤️', '🙂', '✋', '👍', '🎉'];

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== "") {
      const cookies = document.cookie.split(";");
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.startsWith(name + "=")) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
}

const VideoCall = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const localVideoRef = useRef(null);
  const emojiPanelRef = useRef(null);
  const faceRecognitionCanvasRef = useRef(null);
  const faceRecognitionIntervalRef = useRef(null);
  const { roomId } = useParams();
  const ws = useRef(null);
  
  // 🔧 FIX: Initialize with values from PreCallSettings or defaults
  const [micOn, setMicOn] = useState(location.state?.micOn ?? true);
  const [cameraOn, setCameraOn] = useState(location.state?.videoOn ?? true);
  
  const [sharingScreen, setSharingScreen] = useState(false);
  const [stream, setStream] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [floatingEmojis, setFloatingEmojis] = useState([]);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [peers, setPeers] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [participantCount, setParticipantCount] = useState(1);
  const [userId, setUserId] = useState(null);
  
  // Face recognition states
  const [faceRecognitionEnabled, setFaceRecognitionEnabled] = useState(false);
  const [recognizedFaces, setRecognizedFaces] = useState([]);
  const [faceRecognitionStatus, setFaceRecognitionStatus] = useState('idle'); // idle, processing, error
  const [lastRecognitionTime, setLastRecognitionTime] = useState(null);
  const [faceAlerts, setFaceAlerts] = useState([]);
  
  const remoteVideoRefs = useRef({});
  const peersRef = useRef([]);
  const [multipleVoicesDetected, setMultipleVoicesDetected] = useState(false);

  // --- Multi-speaker detection states ---
  const [speakingParticipants, setSpeakingParticipants] = useState({}); // { userId: true/false }
  const [multiSpeakerWarning, setMultiSpeakerWarning] = useState(false);
  const audioAnalyserRefs = useRef({}); // { userId: { context, analyser, source, interval } }

  // Helper: Analyze audio stream for speaking
  const setupAudioAnalyser = (userId, stream) => {
    if (!stream) return;
    if (audioAnalyserRefs.current[userId]) return; // Already set up
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let speaking = false;
      const interval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const threshold = 60;
        const peakCount = dataArray.filter(v => v > threshold).length;
        // Add this log:
        console.log('[VoiceDetect] peakCount:', peakCount, 'threshold:', threshold);
        setMultipleVoicesDetected(peakCount > 60);
        console.log('[VoiceDetect] multipleVoicesDetected:', peakCount > 60);
        // Calculate average volume
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const isSpeaking = avg > 20; // Threshold (tweak as needed)
        if (isSpeaking !== speaking) {
          speaking = isSpeaking;
          setSpeakingParticipants(prev => ({ ...prev, [userId]: isSpeaking }));
        }
      }, 300);
      audioAnalyserRefs.current[userId] = { context, analyser, source, interval };
    } catch (e) {
      console.warn('Audio analyser setup failed for', userId, e);
    }
  };

  // Clean up audio analyser
  const cleanupAudioAnalyser = (userId) => {
    const ref = audioAnalyserRefs.current[userId];
    if (ref) {
      clearInterval(ref.interval);
      if (ref.context && ref.context.close) ref.context.close();
      delete audioAnalyserRefs.current[userId];
    }
    setSpeakingParticipants(prev => {
      const copy = { ...prev };
      delete copy[userId];
      return copy;
    });
  };

  // Setup analyser for local stream
  useEffect(() => {
    if (stream && userId) {
      setupAudioAnalyser(userId, stream);
    }
    return () => {
      if (userId) cleanupAudioAnalyser(userId);
    };
    // eslint-disable-next-line
  }, [stream, userId]);

  // Setup analyser for remote streams
  useEffect(() => {
    // For each peer, set up analyser when their video element has audio
    peers.forEach(({ userId: peerUserId }) => {
      const videoEl = remoteVideoRefs.current[peerUserId];
      if (videoEl && videoEl.srcObject && !audioAnalyserRefs.current[peerUserId]) {
        // Create a stream with only audio tracks
        const remoteStream = videoEl.srcObject;
        let audioStream = null;
        if (remoteStream.getAudioTracks().length > 0) {
          audioStream = new MediaStream(remoteStream.getAudioTracks());
        }
        if (audioStream) {
          setupAudioAnalyser(peerUserId, audioStream);
        }
      }
    });
    // Clean up analysers for peers that left
    Object.keys(audioAnalyserRefs.current).forEach((uid) => {
      if (uid !== userId && !peers.find(p => p.userId === uid)) {
        cleanupAudioAnalyser(uid);
      }
    });
    // eslint-disable-next-line
  }, [peers, remoteVideoRefs.current]);

  // Multi-speaker warning logic
  useEffect(() => {
    const speakingCount = Object.values(speakingParticipants).filter(Boolean).length;
    setMultiSpeakerWarning(speakingCount > 1);
  }, [speakingParticipants]);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  // Generate a secure random room ID with uppercase alphabets and digits
  const generateRoomId = (length = 8) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for(let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  // Generate unique user ID
  const generateUserId = () => {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Purpose from navigation state or default
  const purpose = location.state?.purpose || 'Meeting';

  // Generate room number once
  const [roomNumber, setRoomNumber] = useState(`Room-${generateRoomId()}`);
  
  const storeRoomInDB = async (roomIdToSave) => {
    try {
      console.log("📤 Sending POST to backend with ID:", roomIdToSave);

      const accessToken = JSON.parse(localStorage.getItem("user"))?.tokens?.access;
      const csrfToken = getCookie("csrftoken");
      console.log("CSRF token:", csrfToken);

      await axios.post("http://localhost:8000/api/create-room/", 
        { id: roomIdToSave }, 
        {
          withCredentials: true,
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "X-CSRFToken": csrfToken
          }
        }
      );

      console.log("✅ Room ID stored in DB");
    } catch (err) {
      if (err.response) {
        console.error("❌ Backend responded with:", err.response.data);
      } else {
        console.error("❌ Network or other error:", err);
      }
    }
  };

  // Face Recognition Functions
  const captureFrameForRecognition = () => {
    if (!localVideoRef.current || !faceRecognitionCanvasRef.current || !cameraOn) {
      return null;
    }

    const video = localVideoRef.current;
    const canvas = faceRecognitionCanvasRef.current;
    const ctx = canvas.getContext('2d');

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    // Draw current video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas to blob
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 0.8);
    });
  };

  const sendFrameForRecognition = async () => {
    if (faceRecognitionStatus === 'processing') {
      return; // Don't send if already processing
    }

    try {
      setFaceRecognitionStatus('processing');
      
      const frameBlob = await captureFrameForRecognition();
      if (!frameBlob) {
        setFaceRecognitionStatus('idle');
        return;
      }

      const formData = new FormData();
      formData.append('frame', frameBlob, 'frame.jpg');
      formData.append('room_id', roomId);
      formData.append('user_id', userId);

      const accessToken = JSON.parse(localStorage.getItem("user"))?.tokens?.access;
      const csrfToken = getCookie("csrftoken");

      const response = await axios.post(
        'http://localhost:8000/api/face-recognition/',
        formData,
        {
          withCredentials: true,
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "X-CSRFToken": csrfToken,
            'Content-Type': 'multipart/form-data'
          },
          timeout: 10000 // 10 second timeout
        }
      );

      if (response.data) {
        const { recognized_faces, alerts, timestamp } = response.data;
        
        if (recognized_faces && recognized_faces.length > 0) {
          setRecognizedFaces(recognized_faces);
          setLastRecognitionTime(new Date(timestamp));
        }

        if (alerts && alerts.length > 0) {
          setFaceAlerts(prev => [
            ...prev.slice(-4), // Keep only last 4 alerts
            ...alerts.map(alert => ({
              id: Date.now() + Math.random(),
              message: alert,
              timestamp: new Date(),
              type: alert.includes('Unrecognized') ? 'warning' : 'info'
            }))
          ]);
        }
      }

      setFaceRecognitionStatus('idle');
    } catch (error) {
      console.error('Face recognition error:', error);
      setFaceRecognitionStatus('error');
      
      // Reset status after error
      setTimeout(() => {
        setFaceRecognitionStatus('idle');
      }, 5000);
    }
  };

  const toggleFaceRecognition = () => {
    setFaceRecognitionEnabled(prev => {
      const newState = !prev;
      
      if (newState) {
        // Start face recognition
        console.log('🔍 Starting face recognition...');
        faceRecognitionIntervalRef.current = setInterval(() => {
          sendFrameForRecognition();
        }, 3000); // Check every 3 seconds
      } else {
        // Stop face recognition
        console.log('🛑 Stopping face recognition...');
        if (faceRecognitionIntervalRef.current) {
          clearInterval(faceRecognitionIntervalRef.current);
          faceRecognitionIntervalRef.current = null;
        }
        setRecognizedFaces([]);
        setFaceRecognitionStatus('idle');
      }
      
      return newState;
    });
  };

  // Clear old alerts
  useEffect(() => {
    const alertCleanup = setInterval(() => {
      setFaceAlerts(prev => 
        prev.filter(alert => 
          Date.now() - alert.timestamp.getTime() < 30000 // Keep alerts for 30 seconds
        )
      );
    }, 5000);

    return () => clearInterval(alertCleanup);
  }, []);

  // Initialize media stream
  useEffect(() => {
    let activeStream;
    
    const initializeMedia = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        
        setStream(mediaStream);
        activeStream = mediaStream;
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = mediaStream;
        }
        
        // 🔧 FIX: Apply initial settings from PreCallSettings
        mediaStream.getAudioTracks().forEach(track => {
          track.enabled = micOn;
        });
        
        mediaStream.getVideoTracks().forEach(track => {
          track.enabled = cameraOn;
        });
        
        setConnectionStatus('connected');
        
        // Generate user ID after stream is ready
        const newUserId = generateUserId();
        setUserId(newUserId);
        console.log('Generated user ID:', newUserId);
        console.log('Applied initial settings - Mic:', micOn, 'Camera:', cameraOn);
        
      } catch (err) {
        console.error("getUserMedia error:", err);
        setConnectionStatus('error');
        // Try audio only if video fails
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ 
            video: false, 
            audio: true 
          });
          setStream(audioStream);
          activeStream = audioStream;
          
          // Apply mic setting for audio-only stream
          audioStream.getAudioTracks().forEach(track => {
            track.enabled = micOn;
          });
          
          setConnectionStatus('audio-only');
          
          const newUserId = generateUserId();
          setUserId(newUserId);
          console.log('Generated user ID (audio only):', newUserId);
        } catch (audioErr) {
          console.error("Audio getUserMedia error:", audioErr);
        }
      }
    };

    initializeMedia();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
      
      // Clean up face recognition
      if (faceRecognitionIntervalRef.current) {
        clearInterval(faceRecognitionIntervalRef.current);
      }
    };
  }, []); // Remove micOn and cameraOn from deps to avoid re-initialization

  // Room initialization
  useEffect(() => {
    fetch('http://localhost:8000/api/get-csrf-cookie/', {
      credentials: 'include',
    })
      .then(() => {
        console.log('CSRF cookie set');
      })
      .catch((err) => {
        console.error('Failed to get CSRF cookie:', err);
      });

    const navRoomId = location.state?.roomId;
    const creatorFlag = location.state?.isCreator ?? false;
    setIsCreator(creatorFlag);

    if (roomId) {
      setRoomNumber(`Room-${roomId}`);
      storeRoomInDB(roomId);
      return;
    }

    if (navRoomId) {
      setRoomNumber(`Room-${navRoomId}`);
      navigate(`/call/${navRoomId}`, {
        replace: true,
        state: { isCreator: creatorFlag, roomId: navRoomId }
      });
      storeRoomInDB(navRoomId);
      return;
    }

    const generatedId = generateRoomId();
    setRoomNumber(`Room-${generatedId}`);
    navigate(`/call/${generatedId}`, {
      replace: true,
      state: { isCreator: creatorFlag, roomId: generatedId }
    });
    storeRoomInDB(generatedId);
  }, [roomId, location.state, navigate]);

  // WebSocket connection and peer management
  useEffect(() => {
    if (!stream || !roomId || !userId) return;

    console.log('Initializing WebSocket connection for user:', userId);
    const socket = new WebSocket(`ws://localhost:8000/ws/call/${roomId}/`);
    ws.current = socket;

    socket.onopen = () => {
      console.log('WebSocket connected for user:', userId);
      setConnectionStatus('connected');
      
      // Send join message with user ID
      socket.send(JSON.stringify({ 
        action: "join",
        user_id: userId
      }));
      
      setTimeout(() => {
        socket.send(JSON.stringify({ 
          action: "ready",
          user_id: userId
        }));
      }, 1000);
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);

      switch (data.action) {
        case "user-joined":
          console.log('User joined notification:', data.peer_id);
          if (data.peer_id !== userId) {
            setMessages(prev => [...prev, { 
              text: `${data.peer_id} joined the call`, 
              from: 'System',
              timestamp: new Date().toLocaleTimeString()
            }]);
            setParticipantCount(prev => prev + 1);
          }
          break;

        case "existing-users":
          console.log('Existing users in room:', data.users);
          // Create peers for existing users
          if (data.users && Array.isArray(data.users)) {
            data.users.forEach(existingUserId => {
              if (existingUserId !== userId) {
                const alreadyExists = peersRef.current.find(p => p.userId === existingUserId);
                if (!alreadyExists) {
                  console.log('Creating peer for existing user:', existingUserId);
                  const peer = createPeer(existingUserId, true); // We initiate to existing users
                  if (peer) {
                    setPeers(prev => [...prev, { peer, userId: existingUserId }]);
                  }
                }
              }
            });
          }
          break;

        case "new-peer":
        case "initial-peer": {
          console.log('New peer event:', data.peer_id);
          if (data.peer_id !== userId) {
            const alreadyExists = peersRef.current.find(p => p.userId === data.peer_id);
            if (!alreadyExists && stream) {
              console.log('Creating new peer for:', data.peer_id);
              const peer = createPeer(data.peer_id, true);
              if (peer) {
                setPeers(prev => [...prev, { peer, userId: data.peer_id }]);
              }
            }
          }
          break;
        }

        case "offer": {
          console.log('Received offer from:', data.from);
          if (data.from !== userId) {
            const existingPeer = peersRef.current.find(p => p.userId === data.from);
            if (!existingPeer && stream) {
              console.log('Creating peer to handle offer from:', data.from);
              const peer = createPeer(data.from, false);
              if (peer) {
                peer.signal(data.signal);
                setPeers(prev => [...prev, { peer, userId: data.from }]);
              }
            } else if (existingPeer) {
              console.log('Signaling existing peer with offer');
              existingPeer.peer.signal(data.signal);
            }
          }
          break;
        }

        case "answer": {
          console.log('Received answer from:', data.from);
          if (data.from !== userId) {
            const peerItem = peersRef.current.find(p => p.userId === data.from);
            if (peerItem) {
              console.log('Signaling peer with answer');
              peerItem.peer.signal(data.signal);
            } else {
              console.warn('No peer found for answer from:', data.from);
            }
          }
          break;
        }

        case "ice-candidate": {
          console.log('Received ICE candidate from:', data.from);
          if (data.from !== userId) {
            const peerItem = peersRef.current.find(p => p.userId === data.from);
            if (peerItem) {
              console.log('Adding ICE candidate to peer');
              peerItem.peer.signal(data.candidate);
            }
          }
          break;
        }

        case "user-left": {
          console.log('User left:', data.peer_id);
          if (data.peer_id !== userId) {
            setPeers(prev => {
              const leavingPeer = prev.find(p => p.userId === data.peer_id);
              if (leavingPeer) {
                console.log('Destroying peer for leaving user:', data.peer_id);
                leavingPeer.peer.destroy();
                // Clean up video ref
                if (remoteVideoRefs.current[data.peer_id]) {
                  delete remoteVideoRefs.current[data.peer_id];
                }
              }
              return prev.filter(p => p.userId !== data.peer_id);
            });
            setParticipantCount(prev => Math.max(1, prev - 1));
            setMessages(prev => [...prev, { 
              text: `${data.peer_id} left the call`, 
              from: 'System',
              timestamp: new Date().toLocaleTimeString()
            }]);
          }
          break;
        }

        case "chat-message": {
          if (data.from !== userId) {
            setMessages(prev => [...prev, {
              text: data.message,
              from: data.from,
              timestamp: new Date().toLocaleTimeString()
            }]);
          }
          break;
        }

        case "face-alert": {
          // Handle face recognition alerts from WebSocket
          setFaceAlerts(prev => [
            ...prev.slice(-4),
            {
              id: Date.now() + Math.random(),
              message: data.message,
              timestamp: new Date(),
              type: data.alert_type || 'info'
            }
          ]);
          break;
        }

        default:
          console.warn("Unknown socket action:", data.action);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus('error');
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setConnectionStatus('disconnected');
    };

    return () => {
      console.log('Cleaning up WebSocket connection');
      // Clean up peers
      peersRef.current.forEach(({ peer }) => {
        peer.destroy();
      });
      setPeers([]);
      
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ 
          action: "leave",
          user_id: userId
        }));
      }
      socket.close();
    };
  }, [stream, roomId, userId]);

  // Close emoji panel on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPanelRef.current && !emojiPanelRef.current.contains(event.target)) {
        setShowEmojiPanel(false);
      }
    };
    if (showEmojiPanel) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPanel]);

  const createPeer = (peerId, initiator) => {
    if (!stream) {
      console.warn("Stream not ready. Cannot create peer for:", peerId);
      return null;
    }

    console.log(`Creating peer for ${peerId}, initiator: ${initiator}, my userId: ${userId}`);
    
    const peer = new Peer({
      initiator,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });

    peer.on('signal', signal => {
      console.log(`Sending ${initiator ? 'offer' : 'answer'} to ${peerId} from ${userId}`);
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          action: initiator ? 'offer' : 'answer',
          target: peerId,
          from: userId,
          signal,
        }));
      }
    });

    peer.on("stream", (remoteStream) => {
      console.log("🎥 Received remote stream from", peerId);
      console.log("Stream details:", {
        id: remoteStream.id,
        videoTracks: remoteStream.getVideoTracks().length,
        audioTracks: remoteStream.getAudioTracks().length
      });
      
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        const videoRef = remoteVideoRefs.current[peerId];
        if (videoRef) {
          console.log("📺 Attaching stream to video element for", peerId);
          videoRef.srcObject = remoteStream;
          videoRef.play().catch(err => {
            console.error("Error playing remote video:", err);
          });
        } else {
          console.warn("❌ No videoRef found for", peerId);
          console.log("Available videoRefs:", Object.keys(remoteVideoRefs.current));
        }
      });
    });

    peer.on('connect', () => {
      console.log('✅ Peer connected:', peerId);
    });

    peer.on('error', (err) => {
      console.error('❌ Peer error for', peerId, ':', err);
    });

    peer.on('close', () => {
      console.log('🔌 Peer closed:', peerId);
    });

    peer.on('data', (data) => {
      console.log('📨 Received data from peer:', peerId, data);
    });

    return peer;
  };

  const toggleMic = () => {
    if (stream) {
      stream.getAudioTracks().forEach(track => (track.enabled = !micOn));
      setMicOn(prev => !prev);
      
      // Notify other participants
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          action: 'audio-toggle',
          user_id: userId,
          enabled: !micOn
        }));
      }
    }
  };

  const toggleCamera = () => {
    if (stream) {
      stream.getVideoTracks().forEach(track => (track.enabled = !cameraOn));
      setCameraOn(prev => !prev);
      
      // If turning off camera, also stop face recognition
      if (cameraOn && faceRecognitionEnabled) {
        toggleFaceRecognition();
      }
      
      // Notify other participants
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          action: 'video-toggle',
          user_id: userId,
          enabled: !cameraOn
        }));
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!sharingScreen) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true,
          audio: true 
        });
        
        const videoTrack = screenStream.getVideoTracks()[0];
        
        // Stop face recognition when screen sharing
        if (faceRecognitionEnabled) {
          toggleFaceRecognition();
        }
        
        // Replace video track in existing peer connections
        peersRef.current.forEach(({ peer }) => {
          const sender = peer._pc.getSenders().find(s => 
            s.track && s.track.kind === 'video'
          );
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        videoTrack.onended = () => {
          // Switch back to camera
          if (stream && localVideoRef.current) {
            const cameraTrack = stream.getVideoTracks()[0];
            peersRef.current.forEach(({ peer }) => {
              const sender = peer._pc.getSenders().find(s => 
                s.track && s.track.kind === 'video'
              );
              if (sender) {
                sender.replaceTrack(cameraTrack);
              }
            });
            localVideoRef.current.srcObject = stream;
          }
          setSharingScreen(false);
        };

        setSharingScreen(true);
      } catch (err) {
        console.error('Screen share error:', err);
      }
    } else {
      // Stop screen sharing manually
      if (stream && localVideoRef.current) {
        const cameraTrack = stream.getVideoTracks()[0];
        peersRef.current.forEach(({ peer }) => {
          const sender = peer._pc.getSenders().find(s => 
            s.track && s.track.kind === 'video'
          );
          if (sender) {
            sender.replaceTrack(cameraTrack);
          }
        });
        localVideoRef.current.srcObject = stream;
      }
      setSharingScreen(false);
    }
  };

  const handleLeave = () => {
    console.log('Leaving call...');
    
    // Stop face recognition
    if (faceRecognitionEnabled) {
      toggleFaceRecognition();
    }
    
    // Clean up streams
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    
    // Clean up peers
    peersRef.current.forEach(({ peer }) => {
      peer.destroy();
    });
    
    // Notify server
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ 
        action: "leave",
        user_id: userId
      }));
    }
    
    navigate('/user');
  };

  const sendMessage = () => {
    if (inputMsg.trim() && ws.current && ws.current.readyState === WebSocket.OPEN) {
      const message = {
        action: 'chat-message',
        message: inputMsg,
        from: userId,
        user_id: userId
      };
      
      ws.current.send(JSON.stringify(message));
      
      setMessages(prev => [...prev, { 
        text: inputMsg, 
        from: 'You',
        timestamp: new Date().toLocaleTimeString()
      }]);
      setInputMsg('');
    }
  };

  const handleEmojiSelect = (emoji) => {
    const id = Date.now();
    setFloatingEmojis(prev => [...prev, { id, emoji }]);
    setShowEmojiPanel(false);
    
    // Send emoji reaction to other participants
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        action: 'emoji-reaction',
        emoji: emoji,
        user_id: userId
      }));
    }
    
    setTimeout(() => {
      setFloatingEmojis(prev => prev.filter(e => e.id !== id));
    }, 2000);
  };

  console.log('Current peers:', peers.map(p => p.userId));
  console.log('My user ID:', userId);

  return (
    <div style={styles.container}>
      {/* Local multiple voices warning */}
      {multipleVoicesDetected && (
        <div style={{
          position: 'absolute',
          top: 48,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#f8d7da',
          color: '#721c24',
          border: '1px solid #f5c6cb',
          borderRadius: 8,
          padding: '10px 24px',
          zIndex: 2100,
          fontWeight: 500,
          marginTop: 16,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
        }}>
          🚨 Multiple voices detected from your microphone
        </div>
      )}

      {/* Multi-speaker warning */}
      {multiSpeakerWarning && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#fff3cd',
          color: '#856404',
          border: '1px solid #ffeaa7',
          borderRadius: 8,
          padding: '10px 24px',
          zIndex: 2000,
          fontWeight: 500,
          marginTop: 16,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
        }}>
          ⚠️ Multiple people are talking
        </div>
      )}

      {/* Hidden canvas for face recognition */}
      <canvas 
        ref={faceRecognitionCanvasRef} 
        style={{ display: 'none' }}
      />

      {/* Header with room info and connection status */}
      <div style={styles.header}>
        <div style={styles.roomInfo}>
          <div style={styles.roomTitle}>
            {purpose.charAt(0).toUpperCase() + purpose.slice(1).replace('_', ' ')}
          </div>
          <div style={styles.roomNumber}>{roomNumber}</div>
            {/* <div style={styles.participantCount}>
              {participantCount} participant{participantCount > 1 ? 's' : ''}
            </div> */}
          {userId && (
            <div style={styles.userIdDisplay}>
              ID: {userId.split('_')[2]}
            </div>
          )}
        </div>
        
        <div style={styles.connectionStatus}>
          <div style={{
            ...styles.statusIndicator,
            backgroundColor: connectionStatus === 'connected' ? '#34a853' : 
                           connectionStatus === 'connecting' ? '#fbbc04' : '#ea4335'
          }} />
          <span style={styles.statusText}>
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'connecting' ? 'Connecting...' :
             connectionStatus === 'audio-only' ? 'Audio Only' : 'Connection Error'}
          </span>
        </div>
      </div>

      {/* Face Recognition Panel */}
      {faceRecognitionEnabled && (
        <div style={styles.faceRecognitionPanel}>
          <div style={styles.faceRecognitionHeader}>
            <span style={styles.faceRecognitionTitle}>🔍 Face Recognition</span>
            <div style={{
              ...styles.faceRecognitionStatus,
              color: faceRecognitionStatus === 'processing' ? '#fbbc04' :
                     faceRecognitionStatus === 'error' ? '#ea4335' : '#34a853'
            }}>
              {faceRecognitionStatus === 'processing' ? 'Processing...' :
               faceRecognitionStatus === 'error' ? 'Error' : 'Active'}
            </div>
          </div>
          
          {recognizedFaces.length > 0 && (
            <div style={styles.recognizedFaces}>
              <div style={styles.recognizedFacesTitle}>Recognized:</div>
              {recognizedFaces.map((face, index) => (
                <div key={index} style={styles.recognizedFace}>
                  {face}
                </div>
              ))}
            </div>
          )}

          {lastRecognitionTime && (
            <div style={styles.lastRecognitionTime}>
              Last check: {lastRecognitionTime.toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      {/* Face Alerts */}
      {faceAlerts.length > 0 && (
        <div style={styles.faceAlertsContainer}>
          {faceAlerts.map((alert) => (
            <div 
              key={alert.id} 
              style={{
                ...styles.faceAlert,
                backgroundColor: alert.type === 'warning' ? '#fff3cd' : '#d1ecf1',
                borderColor: alert.type === 'warning' ? '#ffeaa7' : '#bee5eb',
                color: alert.type === 'warning' ? '#856404' : '#0c5460'
              }}
            >
              <span style={styles.alertIcon}>
                {alert.type === 'warning' ? '⚠️' : 'ℹ️'}
              </span>
              <span style={styles.alertMessage}>{alert.message}</span>
              <span style={styles.alertTime}>
                {alert.timestamp.toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Video Grid */}
      <div style={{
        ...styles.videoGrid,
        gridTemplateColumns: 
          peers.length === 0 ? '1fr' :
          peers.length === 1 ? 'repeat(2, 1fr)' :
          peers.length <= 3 ? 'repeat(2, 1fr)' :
          'repeat(3, 1fr)'
      }}>
        {/* Local video */}
        <div style={styles.videoContainer}>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={styles.video}
          />
          <div style={styles.videoLabel}>
            <span>You {isCreator && '(Host)'}</span>
            <div style={styles.videoControls}>
              {!micOn && <span style={styles.mutedIcon}>🔇</span>}
              {!cameraOn && <span style={styles.cameraOffIcon}>📷</span>}
              {sharingScreen && <span style={styles.screenShareIcon}>🖥️</span>}
              {faceRecognitionEnabled && <span style={styles.faceRecognitionIcon}>🔍</span>}
            </div>
          </div>
        </div>

        {/* Remote videos */}
        {peers.map(({ userId: peerUserId }) => (
          <div key={peerUserId} style={styles.videoContainer}>
            <video
              autoPlay
              playsInline
              ref={(el) => {
                if (el) {
                  console.log(`Setting video ref for peer: ${peerUserId}`);
                  remoteVideoRefs.current[peerUserId] = el;
                } else {
                  console.log(`Removing video ref for peer: ${peerUserId}`);
                  if (remoteVideoRefs.current[peerUserId]) {
                    delete remoteVideoRefs.current[peerUserId];
                  }
                }
              }}
              style={styles.video}
              onLoadedMetadata={() => {
                console.log(`Video metadata loaded for ${peerUserId}`);
              }}
              onCanPlay={() => {
                console.log(`Video can play for ${peerUserId}`);
              }}
            />
            <div style={styles.videoLabel}>
              <span>{peerUserId.split('_')[2] || peerUserId}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Debug info */}
      {process.env.NODE_ENV === 'development' && (
        <div style={styles.debugInfo}>
          <div>My ID: {userId}</div>
          {/* <div>Peers: {peers.length}</div> */}
          {/* <div>Peer IDs: {peers.map(p => p.userId.split('_')[2]).join(', ')}</div> */}
          <div>Face Recognition: {faceRecognitionEnabled ? 'ON' : 'OFF'}</div>
          <div>Recognition Status: {faceRecognitionStatus}</div>
          <div>Initial Settings - Mic: {location.state?.micOn ?? 'default'}, Camera: {location.state?.videoOn ?? 'default'}</div>
        </div>
      )}

      {/* Floating emojis */}
      {floatingEmojis.map(({ id, emoji }) => (
        <div
          key={id}
          style={{
            ...styles.floatingEmoji,
            left: `${Math.random() * 80 + 10}%`,
          }}
        >
          {emoji}
        </div>
      ))}

      {/* Controls */}
      <div style={styles.controlBar}>
        <div style={styles.controlGroup} onClick={toggleMic}>
          <button style={{
            ...styles.controlButton,
            backgroundColor: micOn ? '#fff' : '#ea4335',
            color: micOn ? '#5f6368' : '#fff'
          }}>
            {micOn ? '🎤' : '🔇'}
          </button>
          <span style={styles.controlLabel}>
            {micOn ? 'Mute' : 'Unmute'}
          </span>
        </div>

        <div style={styles.controlGroup} onClick={toggleCamera}>
          <button style={{
            ...styles.controlButton,
            backgroundColor: cameraOn ? '#fff' : '#ea4335',
            color: cameraOn ? '#5f6368' : '#fff'
          }}>
            {cameraOn ? '📹' : '🚫'}
          </button>
          <span style={styles.controlLabel}>
            {cameraOn ? 'Turn off camera' : 'Turn on camera'}
          </span>
        </div>

        <div style={styles.controlGroup} onClick={toggleScreenShare}>
          <button style={{
            ...styles.controlButton,
            backgroundColor: sharingScreen ? '#1a73e8' : '#fff',
            color: sharingScreen ? '#fff' : '#5f6368'
          }}>
            {sharingScreen ? '🛑' : '🖥️'}
          </button>
          <span style={styles.controlLabel}>
            {sharingScreen ? 'Stop sharing' : 'Present now'}
          </span>
        </div>

        {/* Face Recognition Toggle */}
        <div style={styles.controlGroup} onClick={toggleFaceRecognition}>
          <button style={{
            ...styles.controlButton,
            backgroundColor: faceRecognitionEnabled ? '#1a73e8' : '#fff',
            color: faceRecognitionEnabled ? '#fff' : '#5f6368',
            opacity: !cameraOn || sharingScreen ? 0.5 : 1
          }}
          disabled={!cameraOn || sharingScreen}
          >
            🔍
          </button>
          <span style={styles.controlLabel}>
            {faceRecognitionEnabled ? 'Stop Recognition' : 'Face Recognition'}
          </span>
        </div>

        <div style={styles.controlGroup} onClick={() => setShowChat(!showChat)}>
          <button style={{
            ...styles.controlButton,
            backgroundColor: showChat ? '#1a73e8' : '#fff',
            color: showChat ? '#fff' : '#5f6368'
          }}>
            💬
          </button>
          <span style={styles.controlLabel}>
            {showChat ? 'Hide chat' : 'Chat'}
          </span>
        </div>

        <div style={styles.controlGroup} ref={emojiPanelRef}>
          <button 
            style={styles.controlButton}
            onClick={() => setShowEmojiPanel(!showEmojiPanel)}
          >
            😊
          </button>
          <span style={styles.controlLabel}>Reactions</span>
          
          {showEmojiPanel && (
            <div style={styles.emojiPanel}>
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiSelect(emoji)}
                  style={styles.emojiButton}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={styles.controlGroup} onClick={handleLeave}>
          <button style={styles.leaveButton}>
            📞
          </button>
          <span style={styles.controlLabel}>Leave call</span>
        </div>
      </div>

      {/* Chat Panel */}
      {showChat && (
        <div style={styles.chatPanel}>
          <div style={styles.chatHeader}>
            <h3>In-call messages</h3>
            <button 
              onClick={() => setShowChat(false)}
              style={styles.chatCloseButton}
            >
              ✕
            </button>
          </div>
          
          <div style={styles.chatMessages}>
            {messages.length === 0 ? (
              <div style={styles.emptyChatMessage}>
                Messages can only be seen by people in the call and are deleted when the call ends.
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} style={styles.chatMessage}>
                  <div style={styles.messageHeader}>
                    <span style={styles.messageSender}>{msg.from}</span>
                    <span style={styles.messageTime}>{msg.timestamp}</span>
                  </div>
                  <div style={styles.messageText}>{msg.text}</div>
                </div>
              ))
            )}
          </div>
          
          <div style={styles.chatInputContainer}>
            <input
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Send a message to everyone"
              style={styles.chatInput}
            />
            <button
              onClick={sendMessage}
              disabled={!inputMsg.trim()}
              style={{
                ...styles.chatSendButton,
                opacity: inputMsg.trim() ? 1 : 0.5
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Styles */}
      <style>{`
        @keyframes floatUp {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-120px); opacity: 0; }
        }
        
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        
        .single-video {
          grid-template-columns: 1fr !important;
        }
        
        .two-videos {
          grid-template-columns: repeat(2, 1fr) !important;
        }
        
        .four-videos {
          grid-template-columns: repeat(2, 1fr) !important;
        }
        
        .many-videos {
          grid-template-columns: repeat(3, 1fr) !important;
        }
      `}</style>
    </div>
  );
};

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    backgroundColor: '#202124',
    fontFamily: 'Google Sans, Roboto, Arial, sans-serif',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    backgroundColor: '#303134',
    borderBottom: '1px solid #5f6368',
  },
  
  roomInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  
  roomTitle: {
    fontSize: '18px',
    fontWeight: '500',
    color: '#e8eaed',
  },
  
  roomNumber: {
    fontSize: '14px',
    color: '#9aa0a6',
  },
  
  participantCount: {
    fontSize: '12px',
    color: '#9aa0a6',
  },
  
  userIdDisplay: {
    fontSize: '10px',
    color: '#5f6368',
  },
  
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  
  statusIndicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  
  statusText: {
    fontSize: '14px',
    color: '#9aa0a6',
  },

  // Face Recognition Styles
  faceRecognitionPanel: {
    position: 'absolute',
    top: '80px',
    left: '20px',
    backgroundColor: 'rgba(48, 49, 52, 0.95)',
    borderRadius: '8px',
    padding: '12px',
    minWidth: '200px',
    zIndex: 1000,
    border: '1px solid #5f6368',
  },

  faceRecognitionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },

  faceRecognitionTitle: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#e8eaed',
  },

  faceRecognitionStatus: {
    fontSize: '12px',
    fontWeight: '500',
  },

  recognizedFaces: {
    marginBottom: '8px',
  },

  recognizedFacesTitle: {
    fontSize: '12px',
    color: '#9aa0a6',
    marginBottom: '4px',
  },

  recognizedFace: {
    fontSize: '12px',
    color: '#34a853',
    backgroundColor: 'rgba(52, 168, 83, 0.1)',
    padding: '2px 6px',
    borderRadius: '4px',
    marginBottom: '2px',
    display: 'inline-block',
    marginRight: '4px',
  },

  lastRecognitionTime: {
    fontSize: '10px',
    color: '#5f6368',
  },

  faceAlertsContainer: {
    position: 'absolute',
    top: '80px',
    right: '20px',
    maxWidth: '300px',
    zIndex: 1000,
  },

  faceAlert: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderRadius: '6px',
    marginBottom: '8px',
    border: '1px solid',
    animation: 'slideIn 0.3s ease-out',
    fontSize: '12px',
  },

  alertIcon: {
    fontSize: '16px',
  },

  alertMessage: {
    flex: 1,
  },

  alertTime: {
    fontSize: '10px',
    opacity: 0.7,
  },
  
  videoGrid: {
    display: 'grid',
    gap: '8px',
    padding: '16px',
    flex: 1,
    alignContent: 'center',
    justifyContent: 'center',
  },
  
  videoContainer: {
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
    minHeight: '200px',
    aspectRatio: '16/9',
  },
  
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  
  videoLabel: {
    position: 'absolute',
    bottom: '8px',
    left: '8px',
    right: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#fff',
  },
  
  videoControls: {
    display: 'flex',
    gap: '4px',
  },
  
  mutedIcon: {
    fontSize: '12px',
  },
  
  cameraOffIcon: {
    fontSize: '12px',
  },
  
  screenShareIcon: {
    fontSize: '12px',
  },

  faceRecognitionIcon: {
    fontSize: '12px',
    color: '#1a73e8',
  },
  

  debugInfo: {
    position: 'absolute',
    top: '100px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(0,0,0,0.8)',
    color: '#fff',
    padding: '10px',
    borderRadius: '4px',
    fontSize: '12px',
    zIndex: 1000,
  },

  
  floatingEmoji: {
    position: 'absolute',
    bottom: '120px',
    fontSize: '32px',
    animation: 'floatUp 2s ease-out',
    pointerEvents: 'none',
    zIndex: 1000,
  },
  
  controlBar: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '8px',
    padding: '16px',
    backgroundColor: '#303134',
  },
  
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    position: 'relative',
  },
  
  controlButton: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    backgroundColor: '#fff',
    color: '#5f6368',
  },
  
  controlLabel: {
    fontSize: '11px',
    color: '#9aa0a6',
    textAlign: 'center',
    maxWidth: '60px',
  },
  
  leaveButton: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    backgroundColor: '#ea4335',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: 'rotate(135deg)',
  },
  
  emojiPanel: {
    position: 'absolute',
    bottom: '70px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '8px',
    display: 'flex',
    gap: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    zIndex: 1000,
  },
  
  emojiButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    transition: 'background-color 0.2s ease',
  },
  
  chatPanel: {
    position: 'fixed',
    right: '0',
    top: '0',
    width: '320px',
    height: '100vh',
    backgroundColor: '#fff',
    color: '#202124',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-2px 0 8px rgba(0,0,0,0.2)',
    zIndex: 1000,
  },
  
  chatHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    borderBottom: '1px solid #e0e0e0',
  },
  
  chatCloseButton: {
    background: 'none',
    border: 'none',
    fontSize: '16px',
    cursor: 'pointer',
    color: '#5f6368',
  },
  
  chatMessages: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
  },
  
  emptyChatMessage: {
    fontSize: '14px',
    color: '#5f6368',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  
  chatMessage: {
    marginBottom: '16px',
  },
  
  messageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  
  messageSender: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#1a73e8',
  },
  
  messageTime: {
    fontSize: '11px',
    color: '#5f6368',
  },
  
  messageText: {
    fontSize: '14px',
    color: '#202124',
  },
  
  chatInputContainer: {
    display: 'flex',
    padding: '16px',
    borderTop: '1px solid #e0e0e0',
    gap: '8px',
  },
  
  chatInput: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #dadce0',
    borderRadius: '4px',
    fontSize: '14px',
    outline: 'none',
  },
  
  chatSendButton: {
    padding: '8px 16px',
    backgroundColor: '#1a73e8',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: '500',
  },
};

export default VideoCall;
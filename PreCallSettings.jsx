import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';

const PreCallSettings = () => {
  const navigate = useNavigate();
  const { roomName } = useParams();
  const location = useLocation();
  const purpose = location.state?.purpose || 'general';

  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);

  const videoRef = useRef();

  // 👇 getUserMedia only runs once on mount
  useEffect(() => {
    let activeStream;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((mediaStream) => {
        activeStream = mediaStream;
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      })
      .catch((err) => {
        console.error("Error accessing media devices:", err);
        setCameraError("Camera or microphone access was denied. Please allow permission and refresh the page.");
      });

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // 👇 control mic
  useEffect(() => {
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = micOn;
      });
    }
  }, [micOn, stream]);

  // 👇 control camera
  useEffect(() => {
    if (stream) {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = videoOn;
      });
    }
  }, [videoOn, stream]);

  const toggleMic = () => {
    setMicOn((prev) => !prev);
  };

  const toggleVideo = () => {
    setVideoOn((prev) => !prev);
  };

  const handleStartCall = () => {
    navigate(`/call/${roomName}`, {
      state: { purpose, micOn, videoOn },
    });
  };

  return (
    <div style={styles.page}>
      <main style={styles.card}>
        {cameraError && <p style={styles.error}>{cameraError}</p>}

        <h2 style={styles.title}>Prepare Your Settings</h2>
        <p style={styles.purposeText}>
          Purpose of this call is <strong>{purpose.replace('_', ' ')}</strong>. 
          Please ensure your microphone and camera are ready.
        </p>

        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={styles.video}
        />

        <div style={styles.buttonsRow}>
          <button
            onClick={toggleMic}
            style={{
              ...styles.toggleBtn,
              backgroundColor: micOn ? '#1a73e8' : '#d93025',
              boxShadow: micOn ? '0 0 12px #1a73e8' : '0 0 12px #d93025',
              color: 'white',
            }}
            aria-pressed={micOn}
            aria-label="Toggle microphone"
          >
            <span style={styles.icon}>{micOn ? '🎤' : '🔇'}</span>
            {micOn ? 'Mic ON' : 'Mic OFF'}
          </button>

          <button
            onClick={toggleVideo}
            style={{
              ...styles.toggleBtn,
              backgroundColor: videoOn ? '#1a73e8' : '#d93025',
              boxShadow: videoOn ? '0 0 12px #1a73e8' : '0 0 12px #d93025',
              color: 'white',
            }}
            aria-pressed={videoOn}
            aria-label="Toggle camera"
          >
            <span style={styles.icon}>{videoOn ? '📹' : '🚫'}</span>
            {videoOn ? 'Video ON' : 'Video OFF'}
          </button>
        </div>

        <button
          onClick={handleStartCall}
          style={styles.startBtn}
          aria-label="Start call"
        >
          Start Call
        </button>
      </main>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#f1f3f4',
    fontFamily: "'Google Sans', 'Roboto', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 1rem 2rem',
  },
  card: {
    backgroundColor: 'white',
    width: '100%',
    maxWidth: '900px',
    borderRadius: '16px',
    boxShadow: '0 8px 24px rgba(32,33,36,0.28)',
    padding: '3rem 4rem',
    boxSizing: 'border-box',
    textAlign: 'center',
  },
  title: {
    fontSize: '2rem',
    fontWeight: '700',
    marginBottom: '0.25rem',
    color: '#202124',
  },
  purposeText: {
    fontSize: '1rem',
    color: '#3c4043',
    marginBottom: '2rem',
  },
  error: {
    color: '#d93025',
    fontWeight: 500,
    marginBottom: '1rem',
    fontSize: '1rem',
  },
  video: {
    width: '100%',
    height: '450px',
    maxHeight: '70vh',
    borderRadius: '16px',
    border: '3px solid #1a73e8',
    boxShadow: '0 0 30px rgba(26, 115, 232, 0.7)',
    marginBottom: '2rem',
    objectFit: 'cover',
    backgroundColor: '#000',
  },
  buttonsRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: '2rem',
    flexWrap: 'wrap',
    marginBottom: '2rem',
  },
  toggleBtn: {
    flex: '1 1 180px',
    padding: '14px 32px',
    fontSize: '1.2rem',
    fontWeight: '600',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'box-shadow 0.3s ease, filter 0.3s ease',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
  },
  icon: {
    fontSize: '1.6rem',
    transition: 'transform 0.3s',
  },
  startBtn: {
    padding: '16px 64px',
    fontSize: '1.25rem',
    fontWeight: '700',
    backgroundColor: '#1a73e8',
    color: 'white',
    borderRadius: '16px',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 6px 20px rgba(26,115,232,0.6)',
    transition: 'background-color 0.3s ease, box-shadow 0.3s ease',
  },
};

export default PreCallSettings;
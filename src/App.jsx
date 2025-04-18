import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import toast, { Toaster } from "react-hot-toast";

const socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:3000");

export default function App() {
  const [userIdInput, setUserIdInput] = useState("");
  const [userId, setUserId] = useState("");
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [myId, setMyId] = useState("");
  const [localStream, setLocalStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [currentCallTarget, setCurrentCallTarget] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    socket.on("connect", () => setMyId(socket.id));
    socket.on("update-user-list", (users) => setConnectedUsers(users));

    socket.on("incoming-call", async ({ from, offer, name }) => {
      toast((t) => (
        <div className="p-4">
          <p className="font-semibold">📞 مكالمة واردة من {name || "مستخدم"}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="px-3 py-1 bg-green-500 text-white rounded"
              onClick={async () => {
                toast.dismiss(t.id);
                setCurrentCallTarget(from);
    
                const stream = await setupMedia();
                if (!stream) return;
    
                const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    
                // أضف الوسائط (الصوت والصورة) بتاعة الطرف التاني
                stream.getTracks().forEach((track) => pc.addTrack(track, stream));
                setLocalStream(stream);
                setPeerConnection(pc);
    
                // لما الطرف التاني يبعت فيديوه
                pc.ontrack = (event) => {
                  const remoteStream = event.streams[0];
                  if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.muted = false;
                  }
                };
    
                // Send ICE
                pc.onicecandidate = (event) => {
                  if (event.candidate) {
                    socket.emit("ice-candidate", {
                      targetId: from,
                      candidate: event.candidate,
                    });
                  }
                };
    
                // التفاوض
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit("answer-call", { targetId: from, answer });
              }}
            >
              قبول
            </button>
            <button
              className="px-3 py-1 bg-red-500 text-white rounded"
              onClick={() => toast.dismiss(t.id)}
            >
              رفض
            </button>
          </div>
        </div>
      ));
    });
    

    socket.on("call-answered", async ({ from, answer }) => {
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log("✅ تم الربط بالطرف الآخر!");
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      try {
        await peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("❌ فشل في إضافة ICE Candidate", err);
      }
    });

    socket.on("end-call", () => {
      toast("📴 تم إنهاء المكالمة من الطرف الآخر");
      endCall();
    });

    socket.on("chat-message", ({ from, message }) => {
      setMessages((prev) => [...prev, { from, message }]);
    });

    return () => {
      socket.off("connect");
      socket.off("update-user-list");
      socket.off("incoming-call");
      socket.off("call-answered");
      socket.off("ice-candidate");
      socket.off("end-call");
      socket.off("chat-message");
    };
  }, [peerConnection]);

  const setupMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err) {
      toast.error("⚠️ خطأ في فتح الكاميرا أو المايك: " + err.message);
      return null;
    }
  };

  const createPeerConnection = (stream, targetId) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.autoplay = true;
        remoteVideoRef.current.playsInline = true;
        remoteVideoRef.current.muted = false;
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          targetId: currentCallTarget || targetId,
          candidate: event.candidate,
        });
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("call-user", {
          targetId: currentCallTarget || targetId,
          offer,
        });
      } catch (err) {
        console.error("❌ renegotiation error", err);
      }
    };

    return pc;
  };

  const handleLogin = () => {
    if (userIdInput.trim()) {
      socket.emit("register-user", userIdInput.trim());
      setUserId(userIdInput.trim());
    }
  };

  const handleCall = async (targetId) => {
    const stream = await setupMedia();
    if (!stream) return;

    setCurrentCallTarget(targetId);
    const pc = createPeerConnection(stream, targetId);
    setPeerConnection(pc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("call-user", { targetId, offer });
  };

  const endCall = () => {
    peerConnection?.close();
    localStream?.getTracks().forEach((t) => t.stop());
    setPeerConnection(null);
    setLocalStream(null);
    setCurrentCallTarget(null);
    setIsMuted(false);
    setMessages([]);
  };

  const handleEndCall = () => {
    if (currentCallTarget) {
      socket.emit("end-call", { targetId: currentCallTarget });
    }
    endCall();
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const sendMessage = () => {
    if (chatInput.trim() && currentCallTarget) {
      socket.emit("chat-message", {
        targetId: currentCallTarget,
        message: chatInput.trim(),
      });
      setMessages((prev) => [...prev, { from: "me", message: chatInput.trim() }]);
      setChatInput("");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <Toaster position="top-right" />
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-4">
        <h1 className="text-xl font-bold mb-4 text-center">🎙️📷 Voice & Video Chat</h1>

     
      </div>
    </div>
  );
}

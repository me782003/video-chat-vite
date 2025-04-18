import { useEffect, useState } from "react";
import io from "socket.io-client";
import toast, { Toaster } from 'react-hot-toast';

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

  useEffect(() => {
    socket.on("connect", () => setMyId(socket.id));
    socket.on("update-user-list", (users) => setConnectedUsers(users));

    socket.on("incoming-call", async ({ from, offer, name }) => {
      toast((t) => (
        <div className="p-4">
          <p className="font-semibold">📞 مكالمة واردة من {name || 'مستخدم'}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="px-3 py-1 bg-green-500 text-white rounded"
              onClick={async () => {
                toast.dismiss(t.id);
                setCurrentCallTarget(from);

                const stream = await setupMedia();
                if (!stream) return;

                const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
                stream.getTracks().forEach(track => pc.addTrack(track, stream));

                pc.ontrack = (event) => {
                  const remoteStream = event.streams[0];
                  const audio = new Audio();
                  audio.srcObject = remoteStream;
                  audio.autoplay = true;
                  audio.play().catch(err => console.error("❌ فشل تشغيل الصوت للطرف المستقبل:", err));
                };

                pc.onicecandidate = (event) => {
                  if (event.candidate) {
                    socket.emit('ice-candidate', { targetId: from, candidate: event.candidate });
                  }
                };

                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('answer-call', { targetId: from, answer });

                setLocalStream(stream);
                setPeerConnection(pc);
              }}
            >قبول</button>
            <button className="px-3 py-1 bg-red-500 text-white rounded" onClick={() => toast.dismiss(t.id)}>رفض</button>
          </div>
        </div>
      ));
    });

    socket.on('call-answered', async ({ from, answer }) => {
      try {
        await peerConnection?.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('✅ تم الربط بالطرف الآخر!');
      } catch (err) {
        console.error('❌ فشل في setRemoteDescription:', err);
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      try {
        await peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('❌ فشل في إضافة ICE Candidate', err);
      }
    });

    socket.on('end-call', () => {
      toast('📴 تم إنهاء المكالمة من الطرف الآخر');
      endCall();
    });

    socket.on('chat-message', ({ from, message }) => {
      setMessages(prev => [...prev, { from, message }]);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return stream;
    } catch (err) {
      toast.error("🎤 فشل في الوصول للمايك: " + err.message);
      return null;
    }
  };

  const handleLogin = () => {
    if (userIdInput.trim()) {
      socket.emit('register-user', userIdInput.trim());
      setUserId(userIdInput.trim());
    }
  };

  const handleCall = async (targetId) => {
    const stream = await setupMedia();
    if (!stream) return;
    setCurrentCallTarget(targetId);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      const audio = new Audio();
      audio.srcObject = remoteStream;
      audio.autoplay = true;
      audio.play().catch(err => console.error("❌ فشل تشغيل الصوت للطرف المتصل:", err));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          targetId,
          candidate: event.candidate
        });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('call-user', { targetId, offer });

    setLocalStream(stream);
    setPeerConnection(pc);
  };

  const endCall = () => {
    peerConnection?.close();
    localStream?.getTracks().forEach(track => track.stop());
    setPeerConnection(null);
    setLocalStream(null);
    setCurrentCallTarget(null);
    setIsMuted(false);
    setMessages([]);
  };

  const handleEndCall = () => {
    if (currentCallTarget) {
      socket.emit('end-call', { targetId: currentCallTarget });
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
      socket.emit('chat-message', { targetId: currentCallTarget, message: chatInput.trim() });
      setMessages(prev => [...prev, { from: 'me', message: chatInput.trim() }]);
      setChatInput("");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <Toaster position="top-right" />
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-4">
        <h1 className="text-xl font-bold mb-4 text-center">🎙️ Voice Chat</h1>

        {!userId ? (
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="اكتب اسمك أو معرفك"
              className="flex-grow p-2 border rounded-lg"
              onChange={(e) => setUserIdInput(e.target.value)}
            />
            <button onClick={handleLogin} className="bg-blue-500 text-white px-4 py-2 rounded-lg">دخول</button>
          </div>
        ) : (
          <>
            <div className="mb-4 text-center text-gray-700">أهلاً، {userId} 👋</div>

            {peerConnection && (
              <>
                <div className="flex gap-2 mb-4">
                  <button onClick={handleEndCall} className="bg-red-600 text-white px-4 py-2 rounded">📴 إنهاء</button>
                  <button onClick={toggleMute} className="bg-gray-700 text-white px-4 py-2 rounded">
                    {isMuted ? '🎙️ تشغيل المايك' : '🔇 كتم المايك'}
                  </button>
                </div>
                <div className="border rounded p-2 mb-2 bg-gray-50 h-40 overflow-y-auto">
                  {messages.map((msg, idx) => (
                    <div key={idx} className={msg.from === 'me' ? 'text-right' : 'text-left'}>
                      <span className="text-sm text-gray-800">{msg.from === 'me' ? 'أنا' : 'الطرف الآخر'}:</span> {msg.message}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="اكتب رسالة..."
                    className="flex-grow p-2 border rounded"
                  />
                  <button onClick={sendMessage} className="bg-blue-500 text-white px-3 rounded">إرسال</button>
                </div>
              </>
            )}

            <div className="border p-2 rounded bg-gray-50 mt-4 max-h-60 overflow-y-auto">
              <p className="font-semibold mb-2">🧑‍🤝‍🧑 المتصلين حاليًا:</p>
              {connectedUsers.length === 0 ? (
                <p className="text-sm text-gray-500">لا يوجد مستخدمين حاليًا.</p>
              ) : (
                connectedUsers.map(([id, name]) => (
                  <div key={id} className="flex items-center justify-between mb-2">
                    <span className="text-sm break-all">{name}</span>
                    <button onClick={() => handleCall(id)} className="bg-green-500 text-white px-2 py-1 rounded text-sm">اتصل</button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
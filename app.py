from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from threading import Lock
import uuid
import random
from datetime import datetime
import logging

# ------------------ LOGGING SETUP ------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ------------------ APP SETUP ------------------
app = Flask(__name__)
app.config["SECRET_KEY"] = "omegle-enhanced-2024"

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    logger=False,  # Disable Socket.IO internal logging
    engineio_logger=False
)

# ------------------ STATE ------------------
waiting_users = []          # queue for human matchmaking
active_pairs = {}           # sid -> partner_sid
active_rooms = {}           # sid -> room_id
ai_rooms = {}               # room_id -> chat data
state_lock = Lock()         # thread safety for shared state

# ------------------ CONSTANTS ------------------
AI_RESPONSES = [
    "👋 Hey! I'm your AI chat partner!",
    "🤖 I'm always online. What do you want to talk about?",
    "😊 Nice to meet you!",
    "✨ Ready for an interesting conversation?",
    "💬 Ask me anything!"
]

RESPONSE_TEMPLATES = {
    "greeting": "Hello! 👋",
    "status": "I'm doing great! 😊",
    "joke": "Why do programmers hate nature? Too many bugs 😄"
}

# ------------------ HELPER FUNCTIONS ------------------
def _validate_room_data(data):
    """Validate room-related socket data."""
    room_id = data.get("room") or data.get("room_id")
    return room_id if room_id and isinstance(room_id, str) else None

def _cleanup_user(sid):
    """Clean up all user state atomically."""
    with state_lock:
        # Remove from waiting queue
        if sid in waiting_users:
            waiting_users.remove(sid)
        
        # Handle active pairs
        partner = active_pairs.pop(sid, None)
        if partner:
            active_pairs.pop(partner, None)
            return partner
        
        # Clean up room assignments
        room = active_rooms.pop(sid, None)
        if room:
            ai_rooms.pop(room, None)
        
        return None

def _generate_ai_reply(text):
    """Generate AI response with template matching."""
    text_lower = text.lower()
    
    if any(word in text_lower for word in ["hello", "hi", "hey"]):
        return RESPONSE_TEMPLATES["greeting"]
    if "how are" in text_lower:
        return RESPONSE_TEMPLATES["status"]
    if "joke" in text_lower:
        return RESPONSE_TEMPLATES["joke"]
    
    return random.choice(AI_RESPONSES)

# ------------------ ROUTES ------------------
@app.route("/")
def home():
    return render_template("index.html")

@app.route("/chat")
def chat():
    return render_template("chat.html")

@app.route("/api/status")
def status():
    with state_lock:
        user_count = len(waiting_users) + len(active_pairs)
    
    return jsonify({
        "status": "online",
        "users": user_count,
        "time": datetime.now().isoformat()
    })

# ------------------ SOCKET EVENTS ------------------
@socketio.on("connect")
def on_connect():
    logger.info(f"✅ Connected: {request.sid}")
    emit("connected", {"status": "ok"})

@socketio.on("join_room")
def join_chat(data):
    room_id = _validate_room_data(data)
    if not room_id:
        return
    
    join_room(room_id)
    with state_lock:
        active_rooms[request.sid] = room_id
    logger.info(f"🔗 {request.sid} joined room {room_id}")

# ------------------ WEBRTC SIGNALING ------------------
@socketio.on("webrtc_offer")
def webrtc_offer(data):
    """Forward WebRTC offer to partner."""
    with state_lock:
        partner = active_pairs.get(request.sid)
    
    if partner and isinstance(data, dict):
        emit("webrtc_offer", data, to=partner)

@socketio.on("webrtc_answer")
def webrtc_answer(data):
    """Forward WebRTC answer to partner."""
    with state_lock:
        partner = active_pairs.get(request.sid)
    
    if partner and isinstance(data, dict):
        emit("webrtc_answer", data, to=partner)

@socketio.on("webrtc_ice_candidate")
def webrtc_ice_candidate(data):
    """Forward ICE candidate to partner."""
    with state_lock:
        partner = active_pairs.get(request.sid)
    
    if partner and isinstance(data, dict):
        emit("webrtc_ice_candidate", data, to=partner)

# ------------------ AI CHAT ------------------
@socketio.on("start_ai_chat")
def start_ai_chat():
    """Initialize AI chat session."""
    room_id = str(uuid.uuid4())[:8]
    join_room(room_id)
    
    with state_lock:
        ai_rooms[room_id] = []
        active_rooms[request.sid] = room_id
    
    emit("ai_connected", {
        "room_id": room_id,
        "welcome": random.choice(AI_RESPONSES)
    })
    
    logger.info(f"🤖 AI chat started: {room_id}")

# ------------------ HUMAN MATCHMAKING ------------------
@socketio.on("find_human")
def find_human():
    """Find or queue user for human matching."""
    sid = request.sid
    logger.info(f"🔍 {sid} is searching for a stranger")
    
    with state_lock:
        # If someone is waiting, match them
        if waiting_users:
            partner_sid = waiting_users.pop(0)
            room_id = str(uuid.uuid4())[:8]
            
            # Create bidirectional mapping
            active_pairs[sid] = partner_sid
            active_pairs[partner_sid] = sid
            active_rooms[sid] = room_id
            active_rooms[partner_sid] = room_id
            
            # Join room for both users
            join_room(room_id, sid=sid)
            join_room(room_id, sid=partner_sid)
            
            emit("human_matched", {"room_id": room_id}, to=sid)
            emit("human_matched", {"room_id": room_id}, to=partner_sid)
            
            logger.info(f"🤝 Matched {sid} ↔ {partner_sid} in room {room_id}")
        else:
            # Add to waiting queue
            waiting_users.append(sid)
            emit("waiting", {"message": "Waiting for a stranger..."})
            logger.info(f"⏳ {sid} added to waiting queue")

@socketio.on("next_human")
def next_human():
    """Disconnect from current partner and find new one."""
    sid = request.sid
    partner = _cleanup_user(sid)
    
    if partner:
        emit("partner_left", {}, to=partner)
    
    emit("system", {"message": "Finding new stranger..."})
    find_human()

# ------------------ MESSAGING ------------------
@socketio.on("send_message")
def handle_message(data):
    """Handle chat messages."""
    room_id = _validate_room_data(data)
    message = data.get("message", "").strip()
    
    if not room_id or not message:
        return
    
    timestamp = datetime.now().strftime("%H:%M")
    
    # Broadcast user message
    emit("new_message", {
        "text": message,
        "sender": "user",
        "time": timestamp
    }, room=room_id)
    
    # Handle AI response if this is an AI room
    with state_lock:
        is_ai_room = room_id in ai_rooms
    
    if is_ai_room:
        # Simulate AI thinking delay
        socketio.sleep(random.uniform(0.4, 0.9))
        reply = _generate_ai_reply(message)
        
        emit("ai_message", {
            "text": reply,
            "sender": "ai",
            "time": datetime.now().strftime("%H:%M")
        }, room=room_id)

# ------------------ DISCONNECT CLEANUP ------------------
@socketio.on("disconnect")
def on_disconnect():
    """Clean up user state on disconnect."""
    sid = request.sid
    partner = _cleanup_user(sid)
    
    if partner:
        emit("partner_left", {}, to=partner)
    
    logger.info(f"❌ Disconnected: {sid}")

# ------------------ RUN ------------------
if __name__ == "__main__":
    print("🚀 Omegle-Style Human Matchmaking Enabled")
    print("🌐 http://localhost:5000")
    socketio.run(app, debug=True, port=5000)
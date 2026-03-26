from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from threading import Lock
import uuid
import random
from datetime import datetime
import logging
import os
from collections import defaultdict

# ------------------ LOGGING SETUP ------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ------------------ APP SETUP ------------------
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "conecteen-premium-secret-2024")
app.config['SESSION_TYPE'] = 'filesystem'

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25
)

# ------------------ STATE MANAGEMENT ------------------
class ConnectionManager:
    def __init__(self):
        self.waiting_users = []
        self.active_pairs = {}
        self.active_rooms = {}
        self.ai_rooms = {}
        self.user_data = {}
        self.lock = Lock()
    
    def add_waiting_user(self, sid):
        with self.lock:
            if sid not in self.waiting_users:
                self.waiting_users.append(sid)
                return True
            return False
    
    def remove_waiting_user(self, sid):
        with self.lock:
            if sid in self.waiting_users:
                self.waiting_users.remove(sid)
                return True
            return False
    
    def create_match(self, sid1, sid2):
        with self.lock:
            room_id = str(uuid.uuid4())[:8]
            self.active_pairs[sid1] = sid2
            self.active_pairs[sid2] = sid1
            self.active_rooms[sid1] = room_id
            self.active_rooms[sid2] = room_id
            return room_id
    
    def remove_match(self, sid):
        with self.lock:
            partner = self.active_pairs.pop(sid, None)
            if partner:
                self.active_pairs.pop(partner, None)
                room1 = self.active_rooms.pop(sid, None)
                room2 = self.active_rooms.pop(partner, None)
                return partner, room1
            return None, None
    
    def create_ai_room(self, sid):
        with self.lock:
            room_id = str(uuid.uuid4())[:8]
            self.ai_rooms[room_id] = {
                'created_at': datetime.now(),
                'messages': [],
                'ai_active': True
            }
            self.active_rooms[sid] = room_id
            return room_id
    
    def cleanup_user(self, sid):
        with self.lock:
            self.remove_waiting_user(sid)
            partner, room = self.remove_match(sid)
            room_id = self.active_rooms.pop(sid, None)
            if room_id and room_id in self.ai_rooms:
                del self.ai_rooms[room_id]
            self.user_data.pop(sid, None)
            return partner, room_id

connection_manager = ConnectionManager()

# ------------------ AI RESPONSE SYSTEM ------------------
AI_RESPONSES = {
    "greetings": [
        "👋 Hey there! I'm your AI chat partner!",
        "🤖 Hello! I'm always here to chat with you!",
        "😊 Nice to meet you! I'm ready for our conversation!",
        "✨ Welcome! Let's have an interesting chat!",
        "💬 Hi! Ask me anything you'd like to talk about!"
    ],
    "how_are_you": [
        "I'm doing great! Thanks for asking! 😊",
        "Feeling fantastic! How about you?",
        "I'm always in a good mood when chatting with you!",
        "Doing well! Ready to have a fun conversation!"
    ],
    "jokes": [
        "Why do programmers prefer dark mode? Because light attracts bugs! 😄",
        "What do you call a fake noodle? An impasta! 🍝",
        "Why don't scientists trust atoms? Because they make up everything! 🔬",
        "I told my wife she was drawing her eyebrows too high. She looked surprised! 👀"
    ],
    "default": [
        "That's interesting! Tell me more about that.",
        "I see! What are your thoughts on this?",
        "Fascinating! Let's explore that topic further.",
        "Thanks for sharing! I'd love to hear more."
    ]
}

def generate_ai_response(message):
    """Generate intelligent AI response based on message content."""
    message_lower = message.lower().strip()
    
    # Check for greetings
    if any(word in message_lower for word in ["hello", "hi", "hey", "hola", "greetings"]):
        return random.choice(AI_RESPONSES["greetings"])
    
    # Check for how are you
    if "how are" in message_lower:
        return random.choice(AI_RESPONSES["how_are_you"])
    
    # Check for jokes
    if any(word in message_lower for word in ["joke", "funny", "laugh"]):
        return random.choice(AI_RESPONSES["jokes"])
    
    # Check for questions
    if message_lower.endswith("?"):
        return "That's a great question! What do you think about it?"
    
    # Default response
    return random.choice(AI_RESPONSES["default"])

# ------------------ ROUTES ------------------
@app.route("/")
def home():
    """Render the premium landing page."""
    return render_template("index.html")

@app.route("/chat")
def chat():
    """Render the premium chat interface."""
    return render_template("chat.html")

@app.route("/api/status")
def api_status():
    """API endpoint for real-time status."""
    with connection_manager.lock:
        waiting_count = len(connection_manager.waiting_users)
        active_count = len(connection_manager.active_pairs) // 2
        ai_rooms_count = len(connection_manager.ai_rooms)
        
        total_users = waiting_count + active_count * 2 + ai_rooms_count
    
    return jsonify({
        "status": "online",
        "users": total_users,
        "waiting": waiting_count,
        "active_pairs": active_count,
        "ai_chats": ai_rooms_count,
        "timestamp": datetime.now().isoformat(),
        "uptime": get_uptime()
    })

def get_uptime():
    """Calculate application uptime."""
    from datetime import datetime
    start_time = app.config.get('START_TIME', datetime.now())
    uptime = datetime.now() - start_time
    hours = uptime.seconds // 3600
    minutes = (uptime.seconds % 3600) // 60
    return f"{uptime.days}d {hours}h {minutes}m"

# ------------------ SOCKET EVENT HANDLERS ------------------
@socketio.on("connect")
def handle_connect():
    """Handle new client connection."""
    sid = request.sid
    logger.info(f"✅ New connection: {sid}")
    
    # Store connection time
    connection_manager.user_data[sid] = {
        'connected_at': datetime.now(),
        'status': 'connected',
        'last_active': datetime.now()
    }
    
    emit("connected", {
        "status": "connected",
        "message": "Welcome to CONECTEEN Premium",
        "timestamp": datetime.now().isoformat()
    })

@socketio.on("disconnect")
def handle_disconnect():
    """Handle client disconnection."""
    sid = request.sid
    logger.info(f"❌ Disconnected: {sid}")
    
    # Clean up user data and notify partner
    partner, room_id = connection_manager.cleanup_user(sid)
    
    if partner:
        emit("partner_disconnected", {
            "message": "Your chat partner has disconnected",
            "timestamp": datetime.now().isoformat()
        }, to=partner)
    
    if room_id and room_id in connection_manager.ai_rooms:
        del connection_manager.ai_rooms[room_id]

@socketio.on("find_human")
def handle_find_human():
    """Find or queue user for human matching."""
    sid = request.sid
    logger.info(f"🔍 User {sid} searching for human match")
    
    with connection_manager.lock:
        # Check if user is already waiting
        if sid in connection_manager.waiting_users:
            logger.info(f"User {sid} already in waiting queue")
            emit("searching", {
                "message": "Already in search queue",
                "position": connection_manager.waiting_users.index(sid) + 1,
                "timestamp": datetime.now().isoformat()
            })
            return
        
        # IMPORTANT: Check if this user is already in an active pair
        if sid in connection_manager.active_pairs:
            logger.info(f"User {sid} already in active chat, not searching")
            return
        
        # Log current waiting queue
        logger.info(f"Current waiting queue: {connection_manager.waiting_users}")
        
        # Check for available matches
        if connection_manager.waiting_users:
            # Get the first waiting user
            partner_sid = connection_manager.waiting_users.pop(0)
            logger.info(f"Found waiting partner: {partner_sid}")
            
            # Create room and match
            room_id = connection_manager.create_match(sid, partner_sid)
            
            # Join both users to the room
            join_room(room_id, sid=sid)
            join_room(room_id, sid=partner_sid)
            
            logger.info(f"🤝 Matched {sid} with {partner_sid} in room {room_id}")
            
            # Notify both users
            emit("match_found", {
                "room_id": room_id,
                "partner_connected": True,
                "timestamp": datetime.now().isoformat()
            }, to=sid)
            
            emit("match_found", {
                "room_id": room_id,
                "partner_connected": True,
                "timestamp": datetime.now().isoformat()
            }, to=partner_sid)
            
        else:
            # Add to waiting queue
            connection_manager.add_waiting_user(sid)
            queue_position = len(connection_manager.waiting_users)
            logger.info(f"⏳ User {sid} added to waiting queue (position: {queue_position})")
            
            emit("waiting", {
                "message": "Waiting for a stranger to connect...",
                "queue_position": queue_position,
                "estimated_wait": "15-30 seconds",
                "timestamp": datetime.now().isoformat()
            })
@socketio.on("start_ai_chat")
def handle_start_ai_chat():
    """Initialize AI chat session."""
    sid = request.sid
    logger.info(f"🤖 User {sid} starting AI chat")
    
    # Create AI room
    room_id = connection_manager.create_ai_room(sid)
    join_room(room_id, sid=sid)
    
    emit("ai_connected", {
        "room_id": room_id,
        "welcome_message": random.choice(AI_RESPONSES["greetings"]),
        "timestamp": datetime.now().isoformat()
    })
    
    logger.info(f"🤖 AI chat started in room {room_id}")

@socketio.on("send_message")
def handle_send_message(data):
    """Handle chat messages."""
    sid = request.sid
    room_id = data.get("room_id")
    message = data.get("message", "").strip()
    
    if not room_id or not message:
        return
    
    timestamp = datetime.now().strftime("%H:%M")
    
    # Broadcast message to room
    emit("new_message", {
        "text": message,
        "sender": "user",
        "sender_id": sid,
        "timestamp": timestamp,
        "message_id": str(uuid.uuid4())[:8]
    }, room=room_id)
    
    # Handle AI response if this is an AI room
    if room_id in connection_manager.ai_rooms:
        # Simulate AI typing delay
        socketio.sleep(random.uniform(0.5, 1.2))
        
        # Generate AI response
        ai_response = generate_ai_response(message)
        
        emit("ai_message", {
            "text": ai_response,
            "sender": "ai",
            "timestamp": datetime.now().strftime("%H:%M"),
            "message_id": str(uuid.uuid4())[:8]
        }, room=room_id)

@socketio.on("next_stranger")
def handle_next_stranger():
    """Disconnect from current partner and find new one."""
    sid = request.sid
    
    # Clean up current connection
    partner, room_id = connection_manager.cleanup_user(sid)
    
    if partner:
        emit("partner_left", {
            "message": "Your partner has moved to another chat",
            "timestamp": datetime.now().isoformat()
        }, to=partner)
    
    if room_id:
        leave_room(room_id, sid=sid)
    
    # Start searching for new match
    emit("searching_new", {
        "message": "Finding new stranger...",
        "timestamp": datetime.now().isoformat()
    })
    
    # Add small delay before searching again
    socketio.sleep(1)
    handle_find_human()

@socketio.on("join_room")
def handle_join_room(data):
    """Handle joining a specific room."""
    room_id = data.get("room")
    if not room_id:
        return
    
    join_room(room_id)
    connection_manager.active_rooms[request.sid] = room_id
    logger.info(f"🔗 User {request.sid} joined room {room_id}")

# ------------------ WEBRTC SIGNALING ------------------
@socketio.on("webrtc_offer")
def handle_webrtc_offer(data):
    """Forward WebRTC offer to partner."""
    sid = request.sid
    partner = connection_manager.active_pairs.get(sid)
    
    if partner and data:
        emit("webrtc_offer", data, to=partner)

@socketio.on("webrtc_answer")
def handle_webrtc_answer(data):
    """Forward WebRTC answer to partner."""
    sid = request.sid
    partner = connection_manager.active_pairs.get(sid)
    
    if partner and data:
        emit("webrtc_answer", data, to=partner)

@socketio.on("webrtc_ice_candidate")
def handle_webrtc_ice_candidate(data):
    """Forward ICE candidate to partner."""
    sid = request.sid
    partner = connection_manager.active_pairs.get(sid)
    
    if partner and data:
        emit("webrtc_ice_candidate", data, to=partner)

# ------------------ TYPING INDICATORS ------------------
@socketio.on("typing_start")
def handle_typing_start(data):
    """Handle typing start event."""
    room_id = data.get("room_id")
    if room_id:
        emit("partner_typing", {
            "typing": True,
            "timestamp": datetime.now().isoformat()
        }, room=room_id, include_self=False)

@socketio.on("typing_stop")
def handle_typing_stop(data):
    """Handle typing stop event."""
    room_id = data.get("room_id")
    if room_id:
        emit("partner_typing", {
            "typing": False,
            "timestamp": datetime.now().isoformat()
        }, room=room_id, include_self=False)

# ------------------ RUN APPLICATION ------------------
if __name__ == "__main__":
    # Store start time for uptime calculation
    app.config['START_TIME'] = datetime.now()
    
    print("""
    ╔══════════════════════════════════════════════════════╗
    ║         CONECTEEN • PREMIUM VIDEO CHAT               ║
    ╠══════════════════════════════════════════════════════╣
    ║ 🚀 Features:                                         ║
    ║   • Premium Dark UI with Glassmorphism              ║
    ║   • Anonymous Video & Text Chat                     ║
    ║   • AI Chat Partner (Instant Connect)               ║
    ║   • WebRTC Video Calling                            ║
    ║   • Real-time Typing Indicators                     ║
    ║   • Responsive Design                               ║
    ╠══════════════════════════════════════════════════════╣
    ║ 🌐 Server running at: http://localhost:5000         ║
    ║ 📱 Mobile Optimized • 🎨 Premium Design             ║
    ╚══════════════════════════════════════════════════════╝
    """)
    
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)
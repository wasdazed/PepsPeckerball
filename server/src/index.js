const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// Game constants
const TICK_RATE = 30; // Updates per second
const COURT_WIDTH = 800;
const COURT_HEIGHT = 480;
const PLAYER_WIDTH = 65;
const PLAYER_HEIGHT = 65;
const BALL_RADIUS = 30;
const NET_WIDTH = 10;
const NET_HEIGHT = 225;
const GRAVITY = 0.5;         // Reduced gravity for better gameplay
const JUMP_VELOCITY = -12;   // Back to original value
const MOVE_SPEED = 10;       // Match ball's horizontal velocity
const MAX_SCORE = 11;
const SERVE_DELAY = 1000; // 1 second delay

// Setup Express
const app = express();
const server = http.createServer(app);

// Debug logging for file serving
try {
  const clientDistPath = path.join(__dirname, '../../client/dist');
  if (fs.existsSync(clientDistPath)) {
    console.log(`Client dist directory exists. Contents:`, fs.readdirSync(clientDistPath));
  } else {
    console.log(`Client dist directory does not exist: ${clientDistPath}`);
  }
} catch (err) {
  console.error(`Error checking client files:`, err);
}

// Health check route for Railway
app.get('/health', (req, res) => {
  res.status(200).send('Server is running');
});

// Configure CORS properly for Socket.IO
const io = new Server(server, {
  cors: {
    origin: true, // Allow all origins
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Serve static files
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Fallback route for SPA
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../../client/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pepe's Peckerball Server</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
          h1 { color: #333; }
        </style>
      </head>
      <body>
        <h1>Pepe's Peckerball Server is Running</h1>
        <p>The game server is operational and ready for WebSocket connections.</p>
        <p>To play the game:</p>
        <ol>
          <li>Open the client at <a href="https://peps-peckerball.vercel.app">https://peps-peckerball.vercel.app</a></li>
          <li>Click "Find Match" to start a game</li>
          <li>Use arrow keys to move and spacebar to jump</li>
        </ol>
        <p>Server information:</p>
        <ul>
          <li>Version: ${process.env.npm_package_version || 'unknown'}</li>
          <li>Environment: ${process.env.NODE_ENV || 'development'}</li>
          <li>CORS allowed origins: ${JSON.stringify(io.engine.opts.cors.origin)}</li>
        </ul>
      </body>
      </html>
    `);
  }
});

// Game state
const waitingPlayers = [];
const activeSessions = new Map();

// Game session class
class GameSession {
  constructor(player1Id, player2Id) {
    this.id = uuidv4();
    this.player1 = {
      id: player1Id,
      x: COURT_WIDTH / 4 - PLAYER_WIDTH / 2,
      y: COURT_HEIGHT - PLAYER_HEIGHT,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      velocity: { x: 0, y: 0 },
      score: 0,
      inputs: { left: false, right: false, jump: false }
    };
    this.player2 = {
      id: player2Id,
      x: COURT_WIDTH * 3/4 - PLAYER_WIDTH / 2,
      y: COURT_HEIGHT - PLAYER_HEIGHT,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      velocity: { x: 0, y: 0 },
      score: 0,
      inputs: { left: false, right: false, jump: false }
    };
    this.ball = {
      x: COURT_WIDTH / 4, // Start on left side for player 1
      y: COURT_HEIGHT - (PLAYER_HEIGHT * 2 + BALL_RADIUS),
      radius: BALL_RADIUS,
      velocity: { x: 0, y: 0 }
    };
    this.net = {
      x: COURT_WIDTH / 2 - NET_WIDTH / 2,
      y: COURT_HEIGHT - NET_HEIGHT,
      width: NET_WIDTH,
      height: NET_HEIGHT
    };
    this.servingState = {
      isServing: true,
      servingPlayer: 1,
      serveTimer: SERVE_DELAY // Start with 1s delay
    };
    this.server = 1;
    this.isGameActive = true;
    this.lastUpdateTime = Date.now();
    this.startGameLoop();
  }

  startGameLoop() {
    this.intervalId = setInterval(() => {
      this.update();
    }, 1000 / TICK_RATE);
  }

  update() {
    const now = Date.now();
    const dt = Math.min(33, now - this.lastUpdateTime) / 16.67;
    this.lastUpdateTime = now;
    if (!this.isGameActive) return;

    this.updatePlayer(this.player1, dt, 0, COURT_WIDTH / 2 - PLAYER_WIDTH);
    this.updatePlayer(this.player2, dt, COURT_WIDTH / 2, COURT_WIDTH - PLAYER_WIDTH);

    if (this.servingState.isServing) {
      // Lock ball to serving player's side
      if (this.servingState.servingPlayer === 1) {
        this.ball.x = COURT_WIDTH / 4;
      } else {
        this.ball.x = COURT_WIDTH * 3/4;
      }
      this.ball.y = COURT_HEIGHT - (PLAYER_HEIGHT * 2 + BALL_RADIUS);
      this.ball.velocity = { x: 0, y: 0 };
      this.servingState.serveTimer -= dt * 16.67;
      // Log for debugging
      console.log(`Serve timer: ${this.servingState.serveTimer}`);
    } else {
      this.updateBall(dt); // Normal physics
    }

    // Always check player-ball collisions
    this.checkPlayerBallCollisions();

    this.checkScoring();
    this.broadcastGameState();
  }

  checkPlayerBallCollisions() {
    if (this.checkCollision(
      this.ball.x - this.ball.radius, this.ball.y - this.ball.radius,
      this.ball.radius * 2, this.ball.radius * 2,
      this.player1.x, this.player1.y, this.player1.width, this.player1.height
    )) {
      console.log('Collision detected with player1');
      this.handlePlayerBallCollision(this.player1);
    }
    if (this.checkCollision(
      this.ball.x - this.ball.radius, this.ball.y - this.ball.radius,
      this.ball.radius * 2, this.ball.radius * 2,
      this.player2.x, this.player2.y, this.player2.width, this.player2.height
    )) {
      console.log('Collision detected with player2');
      this.handlePlayerBallCollision(this.player2);
    }
  }

  updateBall(dt) {
    // Apply gravity to the ball
    this.ball.velocity.y += GRAVITY * dt;
    
    // Update position
    this.ball.x += this.ball.velocity.x * dt;
    this.ball.y += this.ball.velocity.y * dt;

    // Bounce off walls
    if (this.ball.x - this.ball.radius < 0) {
      this.ball.x = this.ball.radius;
      this.ball.velocity.x = -this.ball.velocity.x * 0.9;
    } else if (this.ball.x + this.ball.radius > COURT_WIDTH) {
      this.ball.x = COURT_WIDTH - this.ball.radius;
      this.ball.velocity.x = -this.ball.velocity.x * 0.9;
    }

    // Bounce off ceiling
    if (this.ball.y - this.ball.radius < 0) {
      this.ball.y = this.ball.radius;
      this.ball.velocity.y = -this.ball.velocity.y * 0.9;
    }

    // Check for collision with net
    if (this.checkCollision(
      this.ball.x - this.ball.radius, this.ball.y - this.ball.radius,
      this.ball.radius * 2, this.ball.radius * 2,
      this.net.x, this.net.y, this.net.width, this.net.height
    )) {
      if (this.ball.x < this.net.x) {
        this.ball.x = this.net.x - this.ball.radius;
      } else {
        this.ball.x = this.net.x + this.net.width + this.ball.radius;
      }
      this.ball.velocity.x = -this.ball.velocity.x * 0.9;
    }
  }

  handlePlayerBallCollision(player) {
    if (this.servingState.isServing && this.servingState.serveTimer > 0) {
      console.log('Hit blocked: Serve timer still active');
      return; // Can't hit during delay
    }
    this.servingState.isServing = false; // Ball is now in play
    const hitPoint = (this.ball.x - (player.x + player.width / 2)) / (player.width / 2);
    // Set initial serve direction if this is the first hit
    if (this.ball.velocity.x === 0) {
      this.ball.velocity.x = (this.servingState.servingPlayer === 1 ? 1 : -1) * Math.abs(hitPoint * 10);
    } else {
      this.ball.velocity.x = hitPoint * 10;
    }
    this.ball.velocity.y = -10 - Math.abs(hitPoint * 4);
    this.ball.y = player.y - this.ball.radius;
    console.log('Ball hit by player, velocity:', this.ball.velocity);
  }

  updatePlayer(player, dt, minX, maxX) {
    // Apply horizontal movement based on inputs
    if (player.inputs.left) {
      player.velocity.x = -MOVE_SPEED;
    } else if (player.inputs.right) {
      player.velocity.x = MOVE_SPEED;
    } else {
      player.velocity.x = 0;
    }

    // Apply jump if on ground and jump input is active
    if (player.inputs.jump && player.y >= COURT_HEIGHT - player.height) {
      player.velocity.y = JUMP_VELOCITY;
      player.inputs.jump = false; // Consume the jump input
    }

    // Apply gravity
    player.velocity.y += GRAVITY * dt;

    // Update position
    player.x += player.velocity.x * dt;
    player.y += player.velocity.y * dt;

    // Constrain to court boundaries
    player.x = Math.max(minX, Math.min(maxX, player.x));
    player.y = Math.min(COURT_HEIGHT - player.height, player.y);
  }

  checkCollision(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  checkScoring() {
    // Check if ball hit the ground
    if (this.ball.y + this.ball.radius >= COURT_HEIGHT) {
      // Determine which side the ball landed on
      if (this.ball.x < COURT_WIDTH / 2) {
        this.player2.score++;
        this.server = 2;
        this.broadcastScore();
      } else {
        this.player1.score++;
        this.server = 1;
        this.broadcastScore();
      }

      if (this.player1.score >= MAX_SCORE || this.player2.score >= MAX_SCORE) {
        this.endGame();
      } else {
        this.resetBall();
      }
    }
  }

  resetBall() {
    if (this.servingState.servingPlayer === 1) {
      this.ball.x = COURT_WIDTH / 4; // Left side
    } else {
      this.ball.x = COURT_WIDTH * 3/4; // Right side
    }
    this.ball.y = COURT_HEIGHT - (PLAYER_HEIGHT * 2 + BALL_RADIUS);
    this.ball.velocity = { x: 0, y: 0 };
    this.servingState = {
      isServing: true,
      servingPlayer: this.server,
      serveTimer: SERVE_DELAY // 1s delay
    };
  }

  endGame() {
    this.isGameActive = false;
    clearInterval(this.intervalId);
    
    // Notify clients of game over
    io.to(this.id).emit('gameOver', {
      winner: this.player1.score > this.player2.score ? 1 : 2,
      finalScore: [this.player1.score, this.player2.score]
    });
    
    // Clean up after delay
    setTimeout(() => {
      // Remove session data
      activeSessions.delete(this.id);
    }, 5000);
  }

  broadcastGameState() {
    // Debug - every 50 frames (about 1.5 seconds)
    if (Math.random() < 0.02) {
      console.log(`Broadcasting state to room: ${this.id}, Players: ${this.player1.id}, ${this.player2.id}`);
      console.log(`Active session details:`, {
        serving: this.servingState.isServing,
        p1Pos: { x: this.player1.x, y: this.player1.y },
        p2Pos: { x: this.player2.x, y: this.player2.y },
        ballPos: { x: this.ball.x, y: this.ball.y }
      });
    }
    
    // Get socket objects directly
    const player1Socket = io.sockets.sockets.get(this.player1.id);
    const player2Socket = io.sockets.sockets.get(this.player2.id);
    
    // Define game state object once to reduce duplication
    const gameState = {
      p1: { x: this.player1.x, y: this.player1.y },
      p2: { x: this.player2.x, y: this.player2.y },
      ball: { x: this.ball.x, y: this.ball.y, visible: true },
      serving: this.servingState.isServing
    };
    
    // Always emit directly to player sockets - more reliable than room broadcasting
    if (player1Socket) {
      player1Socket.emit('gameStateUpdate', gameState);
    }
    
    if (player2Socket) {
      player2Socket.emit('gameStateUpdate', gameState);
    }
  }

  broadcastScore() {
    io.to(this.id).emit('scoreUpdate', {
      score: [this.player1.score, this.player2.score]
    });
  }

  handlePlayerInput(playerId, inputData) {
    console.log(`Received input from ${playerId}:`, inputData);
    const player = this.player1.id === playerId ? this.player1 : this.player2;
    if (inputData.action === 'move') {
      player.inputs.left = inputData.direction === 'left';
      player.inputs.right = inputData.direction === 'right';
    } else if (inputData.action === 'jump') {
      player.inputs.jump = true;
    } else if (inputData.action === 'stop') {
      player.inputs.left = false;
      player.inputs.right = false;
    }
  }

  cleanup() {
    clearInterval(this.intervalId);
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  const clientTransport = socket.conn.transport.name;
  console.log(`Player connected: ${socket.id}, Transport: ${clientTransport}, Total clients: ${Object.keys(io.sockets.sockets).length}`);
  
  // Log transport upgrades
  socket.conn.on('upgrade', (transport) => {
    console.log(`Socket ${socket.id} upgraded transport: ${transport.name}`);
  });

  // Handle client disconnection
  socket.on('disconnect', (reason) => {
    console.log(`Player disconnected: ${socket.id}, Reason: ${reason}, Remaining clients: ${Object.keys(io.sockets.sockets).length - 1}`);
    
    // Remove from waiting queue if they were waiting
    const waitingIndex = waitingPlayers.indexOf(socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
      console.log(`Removed ${socket.id} from waiting queue. New queue:`, waitingPlayers);
    }
    
    // Check if they were in an active game session
    for (const [sessionId, session] of activeSessions.entries()) {
      if (session.player1.id === socket.id || session.player2.id === socket.id) {
        // Notify the other player
        const otherPlayerId = session.player1.id === socket.id ? session.player2.id : session.player1.id;
        console.log(`Player in active session disconnected. Notifying other player: ${otherPlayerId}`);
        io.to(otherPlayerId).emit('opponentDisconnect');
        
        // Clean up the session
        session.cleanup();
        activeSessions.delete(sessionId);
        console.log(`Session ${sessionId} cleaned up due to player disconnect`);
        break;
      }
    }
  });

  // Handle find match request
  socket.on('findMatch', () => {
    console.log(`FindMatch received from ${socket.id}`);
    
    // Check if already in queue, don't add twice
    if (!waitingPlayers.includes(socket.id)) {
      // Add player to waiting queue
      waitingPlayers.push(socket.id);
      console.log(`Player ${socket.id} added to queue. Queue size: ${waitingPlayers.length}, Queue:`, waitingPlayers);
    } else {
      console.log(`Player ${socket.id} already in queue. Queue size: ${waitingPlayers.length}, Queue:`, waitingPlayers);
    }
    
    // Check if we can create a match
    if (waitingPlayers.length >= 2) {
      const player1Id = waitingPlayers.shift();
      const player2Id = waitingPlayers.shift();
      
      console.log(`Creating match between ${player1Id} and ${player2Id}`);
      
      // Create a new game session
      const session = new GameSession(player1Id, player2Id);
      activeSessions.set(session.id, session);
      
      // Make sure both players join the session room
      const player1Socket = io.sockets.sockets.get(player1Id);
      const player2Socket = io.sockets.sockets.get(player2Id);
      
      let player1Joined = false;
      let player2Joined = false;
      
      if (player1Socket) {
        player1Socket.join(session.id);
        player1Joined = true;
        console.log(`Player 1 (${player1Id}) joined room ${session.id}`);
      } else {
        console.error(`Error: Socket for player 1 (${player1Id}) not found!`);
      }
      
      if (player2Socket) {
        player2Socket.join(session.id);
        player2Joined = true;
        console.log(`Player 2 (${player2Id}) joined room ${session.id}`);
      } else {
        console.error(`Error: Socket for player 2 (${player2Id}) not found!`);
      }
      
      // Notify both players of the match with direct messages to ensure delivery
      if (player1Joined) {
        player1Socket.emit('matchFound', { sessionId: session.id, playerNum: 1 });
        console.log(`Emitted matchFound to player 1 (${player1Id})`);
      }
      
      if (player2Joined) {
        player2Socket.emit('matchFound', { sessionId: session.id, playerNum: 2 });
        console.log(`Emitted matchFound to player 2 (${player2Id})`);
      }
      
      console.log(`Match created: ${session.id} between ${player1Id} and ${player2Id}`);
    }
  });

  // Handle player input
  socket.on('playerInput', (inputData) => {
    // Find the game session for this player
    let sessionFound = false;
    for (const session of activeSessions.values()) {
      if (session.player1.id === socket.id || session.player2.id === socket.id) {
        session.handlePlayerInput(socket.id, inputData);
        sessionFound = true;
        break;
      }
    }
    if (!sessionFound) {
      console.warn(`Received input from ${socket.id} but no active session found for this player`);
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Game constants
const TICK_RATE = 30; // Updates per second
const COURT_WIDTH = 800;
const COURT_HEIGHT = 400;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 40;
const BALL_RADIUS = 20;
const NET_WIDTH = 10;
const NET_HEIGHT = 120;
const GRAVITY = 0.5;
const JUMP_VELOCITY = -12;
const MOVE_SPEED = 5;
const MAX_SCORE = 11;
const GROUND_HEIGHT = 400;

// Setup Express
const app = express();
const server = http.createServer(app);

// Configure CORS properly for Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ["https://peps-peckerball-production.up.railway.app"]
      : ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST"],
    allowedHeaders: ["my-custom-header"],
    credentials: true
  }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

// Game state
const waitingPlayers = [];
const activeSessions = new Map();

// Game session class
class GameSession {
  constructor(player1Id, player2Id) {
    this.id = uuidv4();
    this.player1 = {
      id: player1Id,
      x: 50,
      y: COURT_HEIGHT - PLAYER_HEIGHT,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      velocity: { x: 0, y: 0 },
      score: 0,
      inputs: { left: false, right: false, jump: false }
    };
    this.player2 = {
      id: player2Id,
      x: COURT_WIDTH - PLAYER_WIDTH - 50,
      y: COURT_HEIGHT - PLAYER_HEIGHT,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      velocity: { x: 0, y: 0 },
      score: 0,
      inputs: { left: false, right: false, jump: false }
    };
    this.ball = {
      x: 50,
      y: COURT_HEIGHT - PLAYER_HEIGHT - PLAYER_HEIGHT - PLAYER_HEIGHT, // 40 units above player's top
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
      serveTimer: 0,
      serveDelay: 2000 // 2 seconds delay
    };
    this.server = 1;
    this.isGameActive = true;
    this.lastUpdateTime = Date.now();
    
    // Start the game loop for this session
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

    // Always update players, regardless of serving state
    this.updatePlayer(this.player1, dt, 0, COURT_WIDTH / 2 - PLAYER_WIDTH);
    this.updatePlayer(this.player2, dt, COURT_WIDTH / 2, COURT_WIDTH - PLAYER_WIDTH);

    if (this.servingState.isServing) {
      // Keep ball stationary at its initial position (set in resetBall)
      // Do NOT update ball.x or ball.y here—let resetBall handle it once
      this.ball.velocity = { x: 0, y: 0 }; // Ensure no residual velocity

      const servingPlayer = this.servingState.servingPlayer === 1 ? this.player1 : this.player2;

      // Check for collision to start the serve
      if (this.checkCollision(
        this.ball.x - this.ball.radius, this.ball.y - this.ball.radius,
        this.ball.radius * 2, this.ball.radius * 2,
        servingPlayer.x, servingPlayer.y,
        servingPlayer.width, servingPlayer.height
      )) {
        // Only allow hitting the ball when the player is jumping
        if (servingPlayer.velocity.y < 0) {
          this.servingState.isServing = false;
          this.ball.velocity.x = (this.servingState.servingPlayer === 1 ? 1 : -1) * 5;
          this.ball.velocity.y = -8;
        }
      }
    } else {
      // Normal ball physics when not serving
      this.updateBall(dt);
    }

    this.checkScoring();
    this.broadcastGameState();
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

  updateBall(dt) {
    // Apply gravity to the ball
    this.ball.velocity.y += GRAVITY * dt * 0.7; // Reduced gravity for ball
    
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

    // Check for collision with players
    if (this.checkCollision(
      this.ball.x - this.ball.radius, this.ball.y - this.ball.radius, 
      this.ball.radius * 2, this.ball.radius * 2,
      this.player1.x, this.player1.y, this.player1.width, this.player1.height
    )) {
      this.handlePlayerBallCollision(this.player1);
    }

    if (this.checkCollision(
      this.ball.x - this.ball.radius, this.ball.y - this.ball.radius, 
      this.ball.radius * 2, this.ball.radius * 2,
      this.player2.x, this.player2.y, this.player2.width, this.player2.height
    )) {
      this.handlePlayerBallCollision(this.player2);
    }
  }

  handlePlayerBallCollision(player) {
    // During serving state, only the serving player can hit the ball
    if (this.servingState.isServing) {
      if ((this.servingState.servingPlayer === 1 && player === this.player1) ||
          (this.servingState.servingPlayer === 2 && player === this.player2)) {
        // Only allow hitting the ball when the player is jumping
        if (player.velocity.y < 0) {
          this.servingState.isServing = false;
          this.ball.velocity.x = (this.servingState.servingPlayer === 1 ? 1 : -1) * 5;
          this.ball.velocity.y = -8;
        }
        return;
      } else {
        return;
      }
    }

    // Regular collision handling during gameplay
    const hitPoint = (this.ball.x - (player.x + player.width / 2)) / (player.width / 2);
    this.ball.velocity.x = hitPoint * 10;
    this.ball.velocity.y = -10 - Math.abs(hitPoint * 4);
    
    if (!this.servingState.isServing) {
      this.ball.y = player.y - this.ball.radius;
    }
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
    const servingPlayer = this.server === 1 ? this.player1 : this.player2;
    this.ball.x = servingPlayer.x + servingPlayer.width / 2;
    this.ball.y = COURT_HEIGHT - PLAYER_HEIGHT - PLAYER_HEIGHT - PLAYER_HEIGHT; // 60 units above player's top
    this.ball.velocity = { x: 0, y: 0 };
    
    this.servingState = {
      isServing: true,
      servingPlayer: this.server,
      serveTimer: 0,
      serveDelay: 2000 // 2 seconds delay
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
    io.to(this.id).emit('gameStateUpdate', {
      p1: { x: this.player1.x, y: this.player1.y },
      p2: { x: this.player2.x, y: this.player2.y },
      ball: { x: this.ball.x, y: this.ball.y, visible: true },
      serving: this.servingState.isServing
    });
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
  console.log(`Player connected: ${socket.id}`);

  // Handle client disconnection
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Remove from waiting queue if they were waiting
    const waitingIndex = waitingPlayers.indexOf(socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    // Check if they were in an active game session
    for (const [sessionId, session] of activeSessions.entries()) {
      if (session.player1.id === socket.id || session.player2.id === socket.id) {
        // Notify the other player
        const otherPlayerId = session.player1.id === socket.id ? session.player2.id : session.player1.id;
        io.to(otherPlayerId).emit('opponentDisconnect');
        
        // Clean up the session
        session.cleanup();
        activeSessions.delete(sessionId);
        break;
      }
    }
  });

  // Handle find match request
  socket.on('findMatch', () => {
    console.log(`Player ${socket.id} looking for match. Current queue:`, waitingPlayers);
    
    // Add player to waiting queue
    waitingPlayers.push(socket.id);
    console.log(`Player ${socket.id} added to queue. Queue size: ${waitingPlayers.length}`);
    
    // Check if we can create a match
    if (waitingPlayers.length >= 2) {
      const player1Id = waitingPlayers.shift();
      const player2Id = waitingPlayers.shift();
      
      console.log(`Creating match between ${player1Id} and ${player2Id}`);
      
      // Create a new game session
      const session = new GameSession(player1Id, player2Id);
      activeSessions.set(session.id, session);
      
      // Add both players to the session room
      socket.join(session.id);
      io.sockets.sockets.get(player1Id)?.join(session.id);
      
      // Notify both players of the match
      io.to(player1Id).emit('matchFound', { sessionId: session.id, playerNum: 1 });
      io.to(player2Id).emit('matchFound', { sessionId: session.id, playerNum: 2 });
      
      console.log(`Match created: ${session.id} between ${player1Id} and ${player2Id}`);
    }
  });

  // Handle player input
  socket.on('playerInput', (inputData) => {
    // Find the game session for this player
    for (const session of activeSessions.values()) {
      if (session.player1.id === socket.id || session.player2.id === socket.id) {
        session.handlePlayerInput(socket.id, inputData);
        break;
      }
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 
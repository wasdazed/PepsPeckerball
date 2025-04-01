import { io } from 'socket.io-client';
import * as THREE from 'three';

// Game constants (match server)
const COURT_WIDTH = 800;
const COURT_HEIGHT = 400;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 40;
const BALL_RADIUS = 20;
const NET_WIDTH = 10;
const NET_HEIGHT = 120;
const GROUND_HEIGHT = 20;

// Socket.IO connection
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
console.log('Connecting to server at:', SERVER_URL);
const socket = io(SERVER_URL, { 
  reconnectionDelayMax: 10000,
  reconnectionAttempts: 10,
  transports: ['websocket', 'polling'], // Try WebSocket first, fall back to polling
  timeout: 10000 // Longer timeout
});

// Debug socket connection
socket.on('connect', () => {
  console.log('Connected to server with socket ID:', socket.id);
  
  // If user was waiting for a match, re-emit findMatch
  if (document.getElementById('waiting-screen').classList.contains('visible') || 
      !document.getElementById('waiting-screen').classList.contains('hidden')) {
    console.log('Reconnected while waiting for match, re-emitting findMatch');
    socket.emit('findMatch');
  }
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason);
});

socket.on('reconnect', (attemptNumber) => {
  console.log(`Reconnected to server after ${attemptNumber} attempts`);
});

socket.on('reconnect_attempt', (attemptNumber) => {
  console.log(`Reconnection attempt #${attemptNumber}`);
});

// Game state
let playerNum = 0;
let sessionId = null;
let gameActive = false;
let score = [0, 0];

// DOM elements
const menuScreen = document.getElementById('menu-screen');
const waitingScreen = document.getElementById('waiting-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreDisplay = document.getElementById('score-display');
const player1ScoreElem = document.getElementById('player1-score');
const player2ScoreElem = document.getElementById('player2-score');
const winnerTextElem = document.getElementById('winner-text');
const finalScoreElem = document.getElementById('final-score');
const findMatchBtn = document.getElementById('find-match-btn');
const playAgainBtn = document.getElementById('play-again-btn');

// Three.js setup
const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(COURT_WIDTH, COURT_HEIGHT);
renderer.setClearColor(0x87CEEB); // Sky blue background

// Add canvas to the game container
const gameContainer = document.getElementById('game-container');
gameContainer.appendChild(canvas);

// Create a scene
const scene = new THREE.Scene();

// Camera (orthographic for 2D-like view)
const camera = new THREE.OrthographicCamera(
  0,               // left
  COURT_WIDTH,     // right
  0,               // bottom
  COURT_HEIGHT,    // top
  1,               // near
  1000             // far
);
camera.position.z = 100;

// Create game objects
console.log('Creating game objects...');
const player1 = createPlayer(0x7777ff); // Blue player
const player2 = createPlayer(0xff7777); // Red player
const ball = createBall();
const net = createNet();
const court = createCourt();

// Set initial positions
player1.position.set(50 + PLAYER_WIDTH / 2, COURT_HEIGHT - PLAYER_HEIGHT, 5);
player2.position.set(COURT_WIDTH - PLAYER_WIDTH - 50 + PLAYER_WIDTH / 2, COURT_HEIGHT - PLAYER_HEIGHT, 5);
ball.position.set(50 + PLAYER_WIDTH / 2, COURT_HEIGHT - (2 * PLAYER_HEIGHT), 6);
net.position.set(COURT_WIDTH / 2, COURT_HEIGHT - NET_HEIGHT / 2, 5);

// Add objects to the scene
console.log('Adding objects to scene...');
scene.add(court);
scene.add(net);
scene.add(player1);
scene.add(player2);
scene.add(ball);

// Input state
const keyState = {
  left: false,
  right: false,
  jump: false
};

// Network state for interpolation
const networkState = {
  p1: { x: 50, y: COURT_HEIGHT - PLAYER_HEIGHT },
  p2: { x: COURT_WIDTH - PLAYER_WIDTH - 50, y: COURT_HEIGHT - PLAYER_HEIGHT },
  ball: { x: 50 + PLAYER_WIDTH / 2, y: COURT_HEIGHT - (2 * PLAYER_HEIGHT), visible: true },
  serving: true
};

// Functions to create game objects
function createPlayer(color) {
  const geometry = new THREE.CircleGeometry(PLAYER_WIDTH / 2, 32);
  const material = new THREE.MeshBasicMaterial({ 
    color,
    side: THREE.DoubleSide  // Make sure both sides are visible
  });
  const player = new THREE.Mesh(geometry, material);
  return player;
}

function createBall() {
  const geometry = new THREE.CircleGeometry(BALL_RADIUS, 32);
  const material = new THREE.MeshBasicMaterial({ 
    color: 0xffffff,
    side: THREE.DoubleSide  // Make sure both sides are visible
  });
  const ball = new THREE.Mesh(geometry, material);
  return ball;
}

function createNet() {
  const geometry = new THREE.BoxGeometry(NET_WIDTH, NET_HEIGHT, 10);
  const material = new THREE.MeshBasicMaterial({ 
    color: 0xcccccc,
    side: THREE.DoubleSide  // Make sure both sides are visible
  });
  const net = new THREE.Mesh(geometry, material);
  net.position.set(
    COURT_WIDTH / 2, 
    COURT_HEIGHT - NET_HEIGHT / 2, 
    0
  );
  return net;
}

function createCourt() {
  // Create the ground
  const groundGeometry = new THREE.BoxGeometry(COURT_WIDTH, GROUND_HEIGHT, 20);
  const groundMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x008800,
    side: THREE.DoubleSide
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.position.set(COURT_WIDTH / 2, GROUND_HEIGHT/2, 0);  // Adjusted to align with ground collision

  // Create left wall
  const leftWallGeometry = new THREE.BoxGeometry(20, COURT_HEIGHT, 20);
  const wallMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x888888,
    side: THREE.DoubleSide
  });
  const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
  leftWall.position.set(-10, COURT_HEIGHT / 2, 0);

  // Create right wall
  const rightWallGeometry = new THREE.BoxGeometry(20, COURT_HEIGHT, 20);
  const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
  rightWall.position.set(COURT_WIDTH + 10, COURT_HEIGHT / 2, 0);

  // Create ceiling
  const ceilingGeometry = new THREE.BoxGeometry(COURT_WIDTH, 20, 20);
  const ceilingMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x888888,
    side: THREE.DoubleSide
  });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.set(COURT_WIDTH / 2, COURT_HEIGHT + 10, 0);

  // Group all court elements
  const court = new THREE.Group();
  court.add(ground);
  court.add(leftWall);
  court.add(rightWall);
  court.add(ceiling);
  
  return court;
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  
  if (gameActive) {
    const lerpFactor = 0.2;
    const targetP1X = networkState.p1.x + PLAYER_WIDTH / 2;
    const targetP1Y = networkState.p1.y;
    const targetP2X = networkState.p2.x + PLAYER_WIDTH / 2;
    const targetP2Y = networkState.p2.y;
    const targetBallX = networkState.ball.x;
    const targetBallY = networkState.ball.y;

    player1.position.x += (targetP1X - player1.position.x) * lerpFactor;
    player1.position.y += (targetP1Y - player1.position.y) * lerpFactor;
    player2.position.x += (targetP2X - player2.position.x) * lerpFactor;
    player2.position.y += (targetP2Y - player2.position.y) * lerpFactor;

    if (networkState.serving) {
      ball.position.x = targetBallX;
      ball.position.y = targetBallY;
    } else {
      ball.position.x += (targetBallX - ball.position.x) * lerpFactor;
      ball.position.y += (targetBallY - ball.position.y) * lerpFactor;
    }
    ball.visible = networkState.ball.visible;
  }
  
  renderer.render(scene, camera);
}

// Start the animation loop
animate();

// Make sure the menu screen doesn't hide the game
menuScreen.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
waitingScreen.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
gameOverScreen.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';

// Debug logging
console.log('Game objects created:', {
  player1: player1.position,
  player2: player2.position,
  ball: ball.position,
  net: net.position,
  court: court.position
});

// Force initial render
console.log('Rendering scene...');
renderer.render(scene, camera);

// Check if canvas is properly sized
console.log('Canvas size:', {
  width: canvas.width,
  height: canvas.height,
  styleWidth: canvas.style.width,
  styleHeight: canvas.style.height
});

// Check if game container exists and is properly sized
console.log('Game container:', {
  exists: !!gameContainer,
  width: gameContainer.offsetWidth,
  height: gameContainer.offsetHeight
});

// Socket event handlers
socket.on('matchFound', (data) => {
  console.log('Match found with data:', data);
  sessionId = data.sessionId;
  playerNum = data.playerNum;
  gameActive = true;
  
  // Hide waiting screen, show score
  waitingScreen.classList.add('hidden');
  scoreDisplay.classList.remove('hidden');
  
  // Reset scores
  score = [0, 0];
  updateScoreDisplay();
  
  console.log('Game is now active, player number:', playerNum);
});

socket.on('gameStateUpdate', (state) => {
  // Log state updates occasionally (every ~5 seconds) to avoid console spam
  if (Math.random() < 0.02) {
    console.log('Game state update:', {
      p1: { x: state.p1.x.toFixed(2), y: state.p1.y.toFixed(2) },
      p2: { x: state.p2.x.toFixed(2), y: state.p2.y.toFixed(2) },
      ball: { 
        x: state.ball.x.toFixed(2), 
        y: state.ball.y.toFixed(2),
        visible: state.ball.visible
      },
      serving: state.serving
    });
  }
  
  // Update network state for interpolation
  networkState.p1.x = state.p1.x;
  networkState.p1.y = state.p1.y;
  networkState.p2.x = state.p2.x;
  networkState.p2.y = state.p2.y;
  networkState.ball.x = state.ball.x;
  networkState.ball.y = state.ball.y;
  networkState.ball.visible = state.ball.visible;
  networkState.serving = state.serving;
});

socket.on('scoreUpdate', (data) => {
  score = data.score;
  updateScoreDisplay();
});

socket.on('gameOver', (data) => {
  gameActive = false;
  
  // Show game over screen
  gameOverScreen.classList.remove('hidden');
  scoreDisplay.classList.add('hidden');
  
  // Update game over screen
  winnerTextElem.textContent = `Player ${data.winner} wins!`;
  finalScoreElem.textContent = `Final Score: ${data.finalScore[0]} - ${data.finalScore[1]}`;
  
  // Mark if player won
  if ((playerNum === 1 && data.winner === 1) || (playerNum === 2 && data.winner === 2)) {
    winnerTextElem.textContent += ' (You win!)';
  } else {
    winnerTextElem.textContent += ' (You lose!)';
  }
});

socket.on('opponentDisconnect', () => {
  gameActive = false;
  
  // Hide all screens and show main menu
  waitingScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  scoreDisplay.classList.add('hidden');
  menuScreen.classList.remove('hidden');
  
  // Reset game state
  score = [0, 0];
  playerNum = 0;
  sessionId = null;
});

// Input handlers
function handleKeyDown(e) {
  if (!gameActive) return;
  console.log(`Key down: ${e.key}`);
  switch (e.key) {
    case 'ArrowLeft':
      if (!keyState.left) {
        keyState.left = true;
        socket.emit('playerInput', { action: 'move', direction: 'left' });
      }
      break;
    case 'ArrowRight':
      if (!keyState.right) {
        keyState.right = true;
        socket.emit('playerInput', { action: 'move', direction: 'right' });
      }
      break;
    case ' ': // Spacebar
      e.preventDefault(); // Prevent page scrolling
      keyState.jump = true;
      socket.emit('playerInput', { action: 'jump' });
      break;
  }
}

function handleKeyUp(e) {
  if (!gameActive) return;
  console.log(`Key up: ${e.key}`);
  switch (e.key) {
    case 'ArrowLeft':
      keyState.left = false;
      if (!keyState.right) {
        socket.emit('playerInput', { action: 'stop' });
      } else {
        socket.emit('playerInput', { action: 'move', direction: 'right' });
      }
      break;
    case 'ArrowRight':
      keyState.right = false;
      if (!keyState.left) {
        socket.emit('playerInput', { action: 'stop' });
      } else {
        socket.emit('playerInput', { action: 'move', direction: 'left' });
      }
      break;
    case ' ': // Spacebar
      keyState.jump = false;
      break;
  }
}

function updateScoreDisplay() {
  player1ScoreElem.textContent = score[0];
  player2ScoreElem.textContent = score[1];
}

// Event listeners
findMatchBtn.addEventListener('click', () => {
  console.log('Find Match button clicked, emitting findMatch event');
  menuScreen.classList.add('hidden');
  waitingScreen.classList.remove('hidden');
  socket.emit('findMatch');
});

playAgainBtn.addEventListener('click', () => {
  gameOverScreen.classList.add('hidden');
  menuScreen.classList.remove('hidden');
});

// Add keyboard event listeners
window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

// Start animation loop
animate(); 
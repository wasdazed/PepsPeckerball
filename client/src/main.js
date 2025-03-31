import { io } from 'socket.io-client';
import * as THREE from 'three';

// Game constants (need to match server)
const COURT_WIDTH = 800;
const COURT_HEIGHT = 400;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 60;
const BALL_RADIUS = 20;
const NET_WIDTH = 10;
const NET_HEIGHT = 120;

// Socket.IO connection
const socket = io('http://localhost:3001');

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

// Create a scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue background

// Camera (orthographic for 2D-like view)
const camera = new THREE.OrthographicCamera(
  0, COURT_WIDTH, 
  0, COURT_HEIGHT, 
  1, 1000
);
camera.position.z = 100;

// Create game objects
const player1 = createPlayer(0x7777ff); // Blue player
const player2 = createPlayer(0xff7777); // Red player
const ball = createBall();
const net = createNet();
const court = createCourt();

// Add objects to the scene
scene.add(player1);
scene.add(player2);
scene.add(ball);
scene.add(net);
scene.add(court);

// Input state
const keyState = {
  left: false,
  right: false,
  jump: false
};

// Network state for interpolation
const networkState = {
  player1: { x: COURT_WIDTH / 4, y: COURT_HEIGHT - PLAYER_HEIGHT },
  player2: { x: (COURT_WIDTH / 4) * 3, y: COURT_HEIGHT - PLAYER_HEIGHT },
  ball: { x: COURT_WIDTH / 4, y: COURT_HEIGHT / 2 }
};

// Functions to create game objects
function createPlayer(color) {
  const geometry = new THREE.BoxGeometry(PLAYER_WIDTH, PLAYER_HEIGHT, 10);
  const material = new THREE.MeshBasicMaterial({ color });
  const player = new THREE.Mesh(geometry, material);
  player.position.set(COURT_WIDTH / 4, COURT_HEIGHT - PLAYER_HEIGHT / 2, 0);
  return player;
}

function createBall() {
  const geometry = new THREE.CircleGeometry(BALL_RADIUS, 32);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const ball = new THREE.Mesh(geometry, material);
  ball.position.set(COURT_WIDTH / 4, COURT_HEIGHT / 2, 0);
  return ball;
}

function createNet() {
  const geometry = new THREE.BoxGeometry(NET_WIDTH, NET_HEIGHT, 10);
  const material = new THREE.MeshBasicMaterial({ color: 0xcccccc });
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
  const groundGeometry = new THREE.BoxGeometry(COURT_WIDTH, 10, 10);
  const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x008800 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.position.set(COURT_WIDTH / 2, COURT_HEIGHT + 5, 0);

  // Create left wall
  const leftWallGeometry = new THREE.BoxGeometry(10, COURT_HEIGHT, 10);
  const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x888888 });
  const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
  leftWall.position.set(-5, COURT_HEIGHT / 2, 0);

  // Create right wall
  const rightWallGeometry = new THREE.BoxGeometry(10, COURT_HEIGHT, 10);
  const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
  rightWall.position.set(COURT_WIDTH + 5, COURT_HEIGHT / 2, 0);

  // Group all court elements
  const court = new THREE.Group();
  court.add(ground);
  court.add(leftWall);
  court.add(rightWall);
  
  return court;
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  
  if (gameActive) {
    // Interpolate toward network state for smooth movement
    const lerpFactor = 0.2;
    player1.position.x += (networkState.player1.x - player1.position.x) * lerpFactor;
    player1.position.y += (networkState.player1.y - player1.position.y) * lerpFactor;
    
    player2.position.x += (networkState.player2.x - player2.position.x) * lerpFactor;
    player2.position.y += (networkState.player2.y - player2.position.y) * lerpFactor;
    
    ball.position.x += (networkState.ball.x - ball.position.x) * lerpFactor;
    ball.position.y += (networkState.ball.y - ball.position.y) * lerpFactor;
  }
  
  renderer.render(scene, camera);
}

// Socket event handlers
socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('matchFound', (data) => {
  console.log('Match found', data);
  sessionId = data.sessionId;
  playerNum = data.playerNum;
  gameActive = true;
  
  // Hide waiting screen, show score
  waitingScreen.classList.add('hidden');
  scoreDisplay.classList.remove('hidden');
  
  // Reset scores
  score = [0, 0];
  updateScoreDisplay();
});

socket.on('gameStateUpdate', (state) => {
  // Update network state for interpolation
  networkState.player1.x = state.p1.x;
  networkState.player1.y = state.p1.y;
  networkState.player2.x = state.p2.x;
  networkState.player2.y = state.p2.y;
  networkState.ball.x = state.ball.x;
  networkState.ball.y = state.ball.y;
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
  
  // Show game over screen with disconnect message
  gameOverScreen.classList.remove('hidden');
  scoreDisplay.classList.add('hidden');
  
  winnerTextElem.textContent = 'Opponent disconnected';
  finalScoreElem.textContent = `Score: ${score[0]} - ${score[1]}`;
});

// Input handlers
function handleKeyDown(e) {
  if (!gameActive) return;
  
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
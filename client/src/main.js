import { io } from 'socket.io-client';
import * as THREE from 'three';

// Game constants (must match server)
const COURT_WIDTH = 800;
const COURT_HEIGHT = 480;
const PLAYER_WIDTH = 65;
const PLAYER_HEIGHT = 65;
const BALL_RADIUS = 30;
const NET_WIDTH = 10;
const NET_HEIGHT = 225;
const GROUND_HEIGHT = 15;
const GRAVITY = 0.45;
const MOVE_SPEED = 15;
const JUMP_VELOCITY = -16;

const SERVER_URL = 'https://pepspeckerball-production.up.railway.app'; // Production URL

// Socket.IO connection
console.log('Connecting to:', SERVER_URL);
const socket = io(SERVER_URL, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

// Game state
let playerNum = 0;
let sessionId = null;
let gameActive = false;
let score = [0, 0];

// Interpolation state
const SERVER_TICK_RATE = 30;
const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;
let stateHistory = [];
const interpolationDelay = 50; // Try 50 or 150 based on latency
let localPlayerTarget = { x: 0, y: 0 };

// Local player prediction state
let localPlayer = null;
let remotePlayer = null;
let localInputs = { left: false, right: false, jump: false };

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
renderer.setClearColor(0x87CEEB);

const gameContainer = document.getElementById('game-container');
gameContainer.appendChild(canvas);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, COURT_WIDTH, 0, COURT_HEIGHT, 1, 1000);
camera.position.z = 100;

const player1 = createPlayer(0x7777ff);
const player2 = createPlayer(0xff7777);
const ball = createBall();
const net = createNet();
const court = createCourt();

player1.position.set(COURT_WIDTH / 4, COURT_HEIGHT - PLAYER_HEIGHT, 5);
player2.position.set(COURT_WIDTH * 3/4, COURT_HEIGHT - PLAYER_HEIGHT, 5);
ball.position.set(COURT_WIDTH / 4, COURT_HEIGHT - PLAYER_HEIGHT * 2 - BALL_RADIUS, 6);
net.position.set(COURT_WIDTH / 2, COURT_HEIGHT - NET_HEIGHT / 2, 5);

scene.add(court);
scene.add(net);
scene.add(player1);
scene.add(player2);
scene.add(ball);

const keyState = { left: false, right: false, jump: false };

function createPlayer(color) {
    const geometry = new THREE.CircleGeometry(PLAYER_WIDTH / 2, 32);
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    return new THREE.Mesh(geometry, material);
}

function createBall() {
    const geometry = new THREE.CircleGeometry(BALL_RADIUS, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    return new THREE.Mesh(geometry, material);
}

function createNet() {
    const geometry = new THREE.BoxGeometry(NET_WIDTH, NET_HEIGHT, 10);
    const material = new THREE.MeshBasicMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
    return new THREE.Mesh(geometry, material);
}

function createCourt() {
    const groundGeometry = new THREE.BoxGeometry(COURT_WIDTH, GROUND_HEIGHT, 20);
    const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x008800, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.position.set(COURT_WIDTH / 2, COURT_HEIGHT - GROUND_HEIGHT * 2, 0);

    const leftWallGeometry = new THREE.BoxGeometry(20, COURT_HEIGHT, 20);
    const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide });
    const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
    leftWall.position.set(-10, COURT_HEIGHT / 2, 0);

    const rightWallGeometry = new THREE.BoxGeometry(20, COURT_HEIGHT, 20);
    const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
    rightWall.position.set(COURT_WIDTH + 10, COURT_HEIGHT / 2, 0);

    const ceilingGeometry = new THREE.BoxGeometry(COURT_WIDTH, 20, 20);
    const ceilingMaterial = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide });
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
    ceiling.position.set(COURT_WIDTH / 2, -20, 0);

    const court = new THREE.Group();
    court.add(ground);
    court.add(leftWall);
    court.add(rightWall);
    court.add(ceiling);
    return court;
}

let lastFrameTime = performance.now();

function animate() {
    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    requestAnimationFrame(animate);

    if (gameActive && localPlayer) {
        const dt = deltaTime * 60;
        const renderTime = now - interpolationDelay;

        // Predict local player
        if (localInputs.left) {
            localPlayer.velocity.x = -MOVE_SPEED;
        } else if (localInputs.right) {
            localPlayer.velocity.x = MOVE_SPEED;
        } else {
            localPlayer.velocity.x = 0;
        }
        if (localInputs.jump && localPlayer.position.y >= COURT_HEIGHT - PLAYER_HEIGHT) {
            localPlayer.velocity.y = JUMP_VELOCITY;
            localInputs.jump = false;
        }
        localPlayer.velocity.y += GRAVITY * dt;
        localPlayer.position.x += localPlayer.velocity.x * dt;
        localPlayer.position.y += localPlayer.velocity.y * dt;
        const minX = playerNum === 1 ? 0 : COURT_WIDTH / 2;
        const maxX = playerNum === 1 ? COURT_WIDTH / 2 - PLAYER_WIDTH : COURT_WIDTH - PLAYER_WIDTH;
        localPlayer.position.x = Math.max(minX, Math.min(maxX, localPlayer.position.x));
        localPlayer.position.y = Math.min(COURT_HEIGHT - PLAYER_HEIGHT, localPlayer.position.y);

        // Smooth correction
        const correctionSpeed = 0.1;
        localPlayer.position.x += (localPlayerTarget.x - localPlayer.position.x) * correctionSpeed;
        localPlayer.position.y += (localPlayerTarget.y - localPlayer.position.y) * correctionSpeed;

        // Interpolate remote player and ball
        let stateA = null, stateB = null;
        for (let i = stateHistory.length - 1; i >= 1; i--) {
            if (stateHistory[i - 1].timestamp <= renderTime && stateHistory[i].timestamp >= renderTime) {
                stateA = stateHistory[i - 1];
                stateB = stateHistory[i];
                break;
            }
        }
        if (stateA && stateB) {
            const alpha = (renderTime - stateA.timestamp) / (stateB.timestamp - stateA.timestamp);
            const remoteP1X = lerp(stateA.p1.x + PLAYER_WIDTH / 2, stateB.p1.x + PLAYER_WIDTH / 2, alpha);
            const remoteP1Y = lerp(stateA.p1.y, stateB.p1.y, alpha);
            const remoteP2X = lerp(stateA.p2.x + PLAYER_WIDTH / 2, stateB.p2.x + PLAYER_WIDTH / 2, alpha);
            const remoteP2Y = lerp(stateA.p2.y, stateB.p2.y, alpha);
            const ballX = lerp(stateA.ball.x, stateB.ball.x, alpha);
            const ballY = lerp(stateA.ball.y, stateB.ball.y, alpha);

            if (playerNum === 1) {
                remotePlayer.position.x = remoteP2X;
                remotePlayer.position.y = remoteP2Y;
            } else {
                remotePlayer.position.x = remoteP1X;
                remotePlayer.position.y = remoteP1Y;
            }
            ball.position.x = ballX;
            ball.position.y = ballY;
            ball.visible = stateB.ball.visible;
        } else if (stateHistory.length > 0) {
            const latestState = stateHistory[stateHistory.length - 1];
            if (playerNum === 1) {
                remotePlayer.position.x = latestState.p2.x + PLAYER_WIDTH / 2;
                remotePlayer.position.y = latestState.p2.y;
            } else {
                remotePlayer.position.x = latestState.p1.x + PLAYER_WIDTH / 2;
                remotePlayer.position.y = latestState.p1.y;
            }
            ball.position.x = latestState.ball.x;
            ball.position.y = latestState.ball.y;
            ball.visible = latestState.ball.visible;
        }
    }

    renderer.render(scene, camera);
}

function lerp(start, end, alpha) {
    return start + (end - start) * alpha;
}

animate();

// Socket.IO event handlers
socket.on('matchFound', (data) => {
    sessionId = data.sessionId;
    playerNum = data.playerNum;
    gameActive = true;
    waitingScreen.classList.add('hidden');
    scoreDisplay.classList.remove('hidden');
    score = [0, 0];
    updateScoreDisplay();
    stateHistory = [];
    localPlayer = playerNum === 1 ? player1 : player2;
    remotePlayer = playerNum === 1 ? player2 : player1;
    localPlayer.velocity = { x: 0, y: 0 };
});

socket.on('gameStateUpdate', (state) => {
    state.timestamp = Date.now();
    if (stateHistory.length > 0) {
        const lastTime = stateHistory[stateHistory.length - 1].timestamp;
        const delay = state.timestamp - lastTime;
        console.log(`Network update interval: ${delay}ms`);
    }
    stateHistory.push(state);
    if (stateHistory.length > 20) stateHistory.shift();

    if (playerNum === 1) {
        localPlayerTarget.x = state.p1.x + PLAYER_WIDTH / 2;
        localPlayerTarget.y = state.p1.y;
    } else if (playerNum === 2) {
        localPlayerTarget.x = state.p2.x + PLAYER_WIDTH / 2;
        localPlayerTarget.y = state.p2.y;
    }
});

socket.on('scoreUpdate', (data) => {
    score = data.score;
    updateScoreDisplay();
});

socket.on('gameOver', (data) => {
    gameActive = false;
    gameOverScreen.classList.remove('hidden');
    scoreDisplay.classList.add('hidden');
    winnerTextElem.textContent = `Player ${data.winner} wins!`;
    finalScoreElem.textContent = `Final Score: ${data.finalScore[0]} - ${data.finalScore[1]}`;
    if ((playerNum === 1 && data.winner === 1) || (playerNum === 2 && data.winner === 2)) {
        winnerTextElem.textContent += ' (You win!)';
    } else {
        winnerTextElem.textContent += ' (You lose!)';
    }
});

socket.on('opponentDisconnect', (data) => {
    gameActive = false;
    waitingScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    scoreDisplay.classList.add('hidden');
    menuScreen.classList.remove('hidden');
    score = [0, 0];
    playerNum = 0;
    sessionId = null;
    console.log('Opponent disconnected:', data.reason);
});

// Input handling
function handleKeyDown(e) {
    if (!gameActive) return;
    switch (e.key) {
        case 'ArrowLeft':
            if (!keyState.left) {
                keyState.left = true;
                localInputs.left = true;
                socket.emit('playerInput', { action: 'move', direction: 'left' });
            }
            break;
        case 'ArrowRight':
            if (!keyState.right) {
                keyState.right = true;
                localInputs.right = true;
                socket.emit('playerInput', { action: 'move', direction: 'right' });
            }
            break;
        case ' ':
            e.preventDefault();
            if (!keyState.jump) {
                keyState.jump = true;
                localInputs.jump = true;
                socket.emit('playerInput', { action: 'jump' });
            }
            break;
    }
}

function handleKeyUp(e) {
    if (!gameActive) return;
    switch (e.key) {
        case 'ArrowLeft':
            keyState.left = false;
            localInputs.left = false;
            if (keyState.right) {
                socket.emit('playerInput', { action: 'move', direction: 'right' });
            } else {
                socket.emit('playerInput', { action: 'stop' });
            }
            break;
        case 'ArrowRight':
            keyState.right = false;
            localInputs.right = false;
            if (keyState.left) {
                socket.emit('playerInput', { action: 'move', direction: 'left' });
            } else {
                socket.emit('playerInput', { action: 'stop' });
            }
            break;
        case ' ':
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

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import pepImageUrl from './assets/pep.jpg?url';

// Game constants
const COURT_WIDTH = 800;
const COURT_HEIGHT = 480;
const PLAYER_WIDTH = 65;
const PLAYER_HEIGHT = 65;
const BALL_RADIUS = 30;
const NET_WIDTH = 10;
const NET_HEIGHT = 225;
const GROUND_HEIGHT = 15;
const GRAVITY = 500;
const MOVE_SPEED = 200;
const JUMP_VELOCITY = -350;

const SERVER_URL = 'http://localhost:3001';
const socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

let playerNum = 0;
let sessionId = null;
let gameActive = false;
let score = [0, 0];

const SERVER_TICK_RATE = 60;
const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;
let stateHistory = [];
const interpolationDelay = 100;
let localPlayerTarget = { x: 0, y: 0 };
let localPlayer = null;
let remotePlayer = null;
let localInputs = { left: false, right: false, jump: false };

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

const config = {
    type: Phaser.AUTO,
    width: COURT_WIDTH,
    height: COURT_HEIGHT,
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: GRAVITY },
            debug: false
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    backgroundColor: '#000000'
};

const game = new Phaser.Game(config);

function preload() {
    this.load.image('pep', pepImageUrl);
}

function create() {
    this.physics.world.setBounds(0, 0, COURT_WIDTH, COURT_HEIGHT);

   

    const leftWall = this.add.rectangle(0, COURT_HEIGHT / 2, 20, COURT_HEIGHT, 0x000000);
    this.physics.add.existing(leftWall, true);

    const rightWall = this.add.rectangle(COURT_WIDTH, COURT_HEIGHT / 2, 20, COURT_HEIGHT, 0x000000);
    this.physics.add.existing(rightWall, true);

    const ceiling = this.add.rectangle(COURT_WIDTH / 2, 0, COURT_WIDTH, 20, 0x000000);
    this.physics.add.existing(ceiling, true);

    this.net = this.add.rectangle(COURT_WIDTH / 2, COURT_HEIGHT - NET_HEIGHT / 2, NET_WIDTH, NET_HEIGHT, 0xd3d3d3); // Light grey
    this.physics.add.existing(this.net, true);

    this.ground = this.add.rectangle(COURT_WIDTH / 2, COURT_HEIGHT - GROUND_HEIGHT / 2, COURT_WIDTH, GROUND_HEIGHT, 0x00ff00); // Green
    this.physics.add.existing(this.ground, true);

    this.player1 = this.physics.add.sprite(COURT_WIDTH / 4, COURT_HEIGHT - PLAYER_HEIGHT, 'pep')
        .setDisplaySize(PLAYER_WIDTH, PLAYER_HEIGHT).setCollideWorldBounds(true);
    this.player2 = this.physics.add.sprite(COURT_WIDTH * 3/4, COURT_HEIGHT - PLAYER_HEIGHT, 'pep')
        .setDisplaySize(PLAYER_WIDTH, PLAYER_HEIGHT).setCollideWorldBounds(true);

    this.ball = this.physics.add.sprite(COURT_WIDTH / 4, COURT_HEIGHT - PLAYER_HEIGHT * 2 - BALL_RADIUS, 'pep')
        .setDisplaySize(BALL_RADIUS * 2, BALL_RADIUS * 2).setCircle(BALL_RADIUS).setCollideWorldBounds(true);

    this.physics.add.collider([this.player1, this.player2, this.ball], [this.ground, leftWall, rightWall, ceiling, this.net]);
    this.physics.add.collider(this.ball, this.net, () => {
        this.ball.setVelocityX(-this.ball.body.velocity.x * 0.8);
    });
    this.physics.add.collider(this.player1, this.ball, handlePlayerBallCollision, null, this);
    this.physics.add.collider(this.player2, this.ball, handlePlayerBallCollision, null, this);

    this.cursors = this.input.keyboard.createCursorKeys();

    this.scoreText = this.add.text(16, 16, 'Score: 0 - 0', { fontSize: '24px', color: '#fff' });
    this.updateScoreDisplay = updateScoreDisplay.bind(this);

    console.log('Ground created at:', this.ground.x, this.ground.y);
}

function handlePlayerBallCollision(player, ball) {
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < BALL_RADIUS + PLAYER_WIDTH / 2) {
        const angle = Math.atan2(dy, dx);
        const speed = Math.sqrt(ball.body.velocity.x ** 2 + ball.body.velocity.y ** 2) || 300;
        ball.setVelocity(
            Math.cos(angle) * speed * 1.2 + player.body.velocity.x * 0.5,
            Math.sin(angle) * speed * 1.2 + player.body.velocity.y * 0.5
        );
        ball.x = player.x + Math.cos(angle) * (BALL_RADIUS + PLAYER_WIDTH / 2 + 1);
        ball.y = player.y + Math.sin(angle) * (BALL_RADIUS + PLAYER_HEIGHT / 2 + 1);
    }
}

function update(time, delta) {
    if (!gameActive || !localPlayer) return;

    console.log('Ground position:', this.ground.x, this.ground.y);

    const dt = delta / 1000;

    if (localInputs.left) {
        localPlayer.setVelocityX(-MOVE_SPEED);
    } else if (localInputs.right) {
        localPlayer.setVelocityX(MOVE_SPEED);
    } else {
        localPlayer.setVelocityX(0);
    }
    if (localInputs.jump && localPlayer.body.touching.down) {
        localPlayer.setVelocityY(JUMP_VELOCITY);
        localInputs.jump = false;
    }

    const minX = playerNum === 1 ? 0 : COURT_WIDTH / 2;
    const maxX = playerNum === 1 ? COURT_WIDTH / 2 - PLAYER_WIDTH : COURT_WIDTH - PLAYER_WIDTH;
    localPlayer.x = Math.max(minX, Math.min(maxX, localPlayer.x));

    const correctionSpeed = 0.8;
    localPlayer.x += (localPlayerTarget.x - localPlayer.x) * correctionSpeed;
    localPlayer.y += (localPlayerTarget.y - localPlayer.y) * correctionSpeed;

    const renderTime = time - interpolationDelay;
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
            remotePlayer.x = remoteP2X;
            remotePlayer.y = remoteP2Y;
        } else {
            remotePlayer.x = remoteP1X;
            remotePlayer.y = remoteP1Y;
        }
        this.ball.x = ballX;
        this.ball.y = ballY;
        this.ball.visible = stateB.ball.visible;
    } else if (stateHistory.length > 0) {
        const latestState = stateHistory[stateHistory.length - 1];
        if (playerNum === 1) {
            remotePlayer.x = latestState.p2.x + PLAYER_WIDTH / 2;
            remotePlayer.y = latestState.p2.y;
        } else {
            remotePlayer.x = latestState.p1.x + PLAYER_WIDTH / 2;
            remotePlayer.y = latestState.p1.y;
        }
        this.ball.x = latestState.ball.x;
        this.ball.y = latestState.ball.y;
        this.ball.visible = latestState.ball.visible;
    }
}

function lerp(start, end, alpha) {
    return start + (end - start) * alpha;
}

function updateScoreDisplay() {
    if (!this || !this.scoreText) return;
    player1ScoreElem.textContent = score[0];
    player2ScoreElem.textContent = score[1];
    this.scoreText.setText(`Score: ${score[0]} - ${score[1]}`);
}

socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
});

socket.on('connect_error', (err) => {
    console.error('Socket.IO connection error:', err.message);
    waitingScreen.classList.add('hidden');
    menuScreen.classList.remove('hidden');
});

socket.on('matchFound', (data) => {
    if (gameActive) return;
    console.log('Match found:', data);
    sessionId = data.sessionId;
    playerNum = data.playerNum;
    gameActive = true;
    waitingScreen.classList.add('hidden');
    scoreDisplay.classList.remove('hidden');
    score = [0, 0];
    game.scene.scenes[0].updateScoreDisplay();
    stateHistory = [];
    localPlayer = playerNum === 1 ? game.scene.scenes[0].player1 : game.scene.scenes[0].player2;
    remotePlayer = playerNum === 1 ? game.scene.scenes[0].player2 : game.scene.scenes[0].player1;
});

socket.on('gameStateUpdate', (state) => {
    state.timestamp = Date.now();
    stateHistory.push(state);
    if (stateHistory.length > 20) stateHistory.shift();

    if (playerNum === 1) {
        localPlayerTarget.x = state.p1.x + PLAYER_WIDTH / 2;
        localPlayerTarget.y = state.p1.y;
    } else {
        localPlayerTarget.x = state.p2.x + PLAYER_WIDTH / 2;
        localPlayerTarget.y = state.p2.y;
    }
});

socket.on('scoreUpdate', (data) => {
    if (!gameActive) return;
    score = data.score;
    game.scene.scenes[0].updateScoreDisplay();
});

socket.on('gameOver', (data) => {
    gameActive = false;
    gameOverScreen.classList.remove('hidden');
    scoreDisplay.classList.add('hidden');
    winnerTextElem.textContent = `Player ${data.winner} wins!`;
    finalScoreElem.textContent = `Final Score: ${data.finalScore[0]} - ${data.finalScore[1]}`;
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
    stateHistory = [];
    localPlayer = null;
    remotePlayer = null;
    console.log('Opponent disconnected:', data.reason);
});

function handleKeyDown(e) {
    if (!gameActive) return;
    switch (e.key) {
        case 'ArrowLeft':
            if (!localInputs.left) {
                localInputs.left = true;
                socket.emit('playerInput', { action: 'move', direction: 'left' });
            }
            break;
        case 'ArrowRight':
            if (!localInputs.right) {
                localInputs.right = true;
                socket.emit('playerInput', { action: 'move', direction: 'right' });
            }
            break;
        case ' ':
            e.preventDefault();
            if (!localInputs.jump) {
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
            localInputs.left = false;
            if (localInputs.right) {
                socket.emit('playerInput', { action: 'move', direction: 'right' });
            } else {
                socket.emit('playerInput', { action: 'stop' });
            }
            break;
        case 'ArrowRight':
            localInputs.right = false;
            if (localInputs.left) {
                socket.emit('playerInput', { action: 'move', direction: 'left' });
            } else {
                socket.emit('playerInput', { action: 'stop' });
            }
            break;
        case ' ':
            localInputs.jump = false;
            break;
    }
}

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
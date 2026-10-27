const CELL = 20;
const GRID = 20;
const SCORE_PER_LEVEL = 50;
const SPEEDUP_MS = 10;
const MIN_TICK_MS = 20;
const STORAGE_KEY = 'snake-high-score';
const MUTE_KEY = 'snake-muted';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');
const messageEl = document.getElementById('message');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const soundBtn = document.getElementById('sound-btn');
const pauseBtn = document.getElementById('pause-btn');
const difficultyEl = document.getElementById('difficulty');
const levelEl = document.getElementById('level');

const KEY_DIRS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

let snake = [];
let dir, nextDir, food, score, highScore, timer;
let playing = false;
let paused = false;
let dead = false;
let level = 1;
let baseMs = 150;
let particles = [];
let shake = 0;

/* ---------- 저장 ---------- */

function loadHighScore() {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch (e) {
    return 0;
  }
}

function saveHighScore() {
  try {
    localStorage.setItem(STORAGE_KEY, String(highScore));
  } catch (e) {
    // 저장소 사용 불가 시 무시
  }
}

/* ---------- 소리 (Web Audio로 합성) ---------- */

let audioCtx = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch (e) {
  muted = false;
}

function getAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// notes: [{ f: 주파수, d: 길이(초), t: 시작 오프셋(초) }]
function playNotes(notes, type = 'square', volume = 0.08) {
  if (muted) return;
  const ac = getAudio();
  if (!ac) return;
  notes.forEach(({ f, d, t = 0, f2 }) => {
    const start = ac.currentTime + t;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, start);
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, start + d);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + d);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + d);
  });
}

const sounds = {
  start: () => playNotes([
    { f: 523, d: 0.1, t: 0 },
    { f: 659, d: 0.1, t: 0.09 },
    { f: 784, d: 0.18, t: 0.18 },
  ], 'triangle', 0.12),
  eat: () => playNotes([{ f: 520, f2: 1040, d: 0.12 }], 'square', 0.07),
  over: () => playNotes([
    { f: 392, f2: 330, d: 0.18, t: 0 },
    { f: 311, f2: 262, d: 0.18, t: 0.17 },
    { f: 247, f2: 131, d: 0.45, t: 0.34 },
  ], 'sawtooth', 0.09),
  record: () => playNotes([
    { f: 659, d: 0.1, t: 0 },
    { f: 784, d: 0.1, t: 0.1 },
    { f: 988, d: 0.1, t: 0.2 },
    { f: 1319, d: 0.3, t: 0.3 },
  ], 'triangle', 0.12),
};

function updateSoundBtn() {
  soundBtn.textContent = muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐';
}

/* ---------- 게임 로직 ---------- */

function placeFood() {
  const free = [];
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
    }
  }
  food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

// 레벨이 오를 때마다 틱 간격을 10ms씩 줄임(= 속도 증가)
function tickMs() {
  return Math.max(MIN_TICK_MS, baseMs - (level - 1) * SPEEDUP_MS);
}

function startTimer() {
  clearInterval(timer);
  timer = setInterval(tick, tickMs());
}

function togglePause() {
  if (!playing) return;
  paused = !paused;
  if (paused) {
    clearInterval(timer);
    messageEl.textContent = '일시정지';
  } else {
    messageEl.textContent = '';
    startTimer();
  }
  pauseBtn.textContent = paused ? '재개' : '일시정지';
  pauseBtn.blur();
}

function startGame() {
  clearInterval(timer);
  baseMs = Number(difficultyEl.value);
  level = 1;
  levelEl.textContent = level;
  paused = false;
  pauseBtn.textContent = '일시정지';
  pauseBtn.hidden = false;
  difficultyEl.disabled = true;
  snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ];
  dir = { x: 1, y: 0 };
  nextDir = dir;
  score = 0;
  scoreEl.textContent = score;
  particles = [];
  shake = 0;
  playing = true;
  dead = false;
  placeFood();

  startBtn.hidden = true;
  restartBtn.hidden = true;
  messageEl.textContent = '';
  messageEl.classList.remove('over');

  sounds.start();
  startTimer();
}

function tick() {
  dir = nextDir;
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  const hitWall = head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID;
  const ate = food && head.x === food.x && head.y === food.y;
  // 꼬리는 이번 틱에 빠지므로(먹이를 먹지 않을 때) 충돌 대상에서 제외
  const body = ate ? snake : snake.slice(0, -1);
  const hitSelf = body.some((s) => s.x === head.x && s.y === head.y);

  if (hitWall || hitSelf) {
    gameOver();
    return;
  }

  snake.unshift(head);
  if (ate) {
    score += 10;
    scoreEl.textContent = score;
    burst(food.x, food.y);
    const newLevel = Math.floor(score / SCORE_PER_LEVEL) + 1;
    if (newLevel > level) {
      level = newLevel;
      levelEl.textContent = level;
      startTimer();
      sounds.record();
    } else {
      sounds.eat();
    }
    placeFood();
    if (!food) {
      gameOver();
      return;
    }
  } else {
    snake.pop();
  }
}

function gameOver() {
  clearInterval(timer);
  playing = false;
  paused = false;
  pauseBtn.hidden = true;
  difficultyEl.disabled = false;
  dead = true;
  shake = 12;
  const newRecord = score > highScore;
  if (newRecord) {
    highScore = score;
    highScoreEl.textContent = highScore;
    saveHighScore();
  }
  if (newRecord) sounds.record();
  else sounds.over();

  messageEl.textContent = newRecord
    ? `🏆 최고 기록! 점수: ${score}`
    : `게임 오버! 점수: ${score}`;
  messageEl.classList.add('over');
  restartBtn.hidden = false;
}

/* ---------- 이펙트 ---------- */

function burst(gx, gy) {
  const cx = gx * CELL + CELL / 2;
  const cy = gy * CELL + CELL / 2;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 0.8 + Math.random() * 2.2;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: 1,
      r: 1.5 + Math.random() * 2,
    });
  }
}

/* ---------- 렌더링 ---------- */

function drawBackground() {
  const g = ctx.createRadialGradient(200, 200, 40, 200, 200, 300);
  g.addColorStop(0, '#1e293b');
  g.addColorStop(1, '#0b1120');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 은은한 체스판 + 격자선
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }
}

function drawFood(time) {
  if (!food) return;
  const cx = food.x * CELL + CELL / 2;
  const cy = food.y * CELL + CELL / 2;
  const pulse = 1 + Math.sin(time / 180) * 0.1;

  ctx.save();
  ctx.shadowColor = 'rgba(248, 113, 113, 0.9)';
  ctx.shadowBlur = 14;
  const g = ctx.createRadialGradient(cx - 2, cy - 3, 1, cx, cy, 8 * pulse);
  g.addColorStop(0, '#fecaca');
  g.addColorStop(0.35, '#f87171');
  g.addColorStop(1, '#b91c1c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 7.5 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 잎
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy - 8, 3.5, 1.8, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawSnake() {
  if (!snake.length) return;
  const n = snake.length;
  const center = (s) => [s.x * CELL + CELL / 2, s.y * CELL + CELL / 2];
  const color = (i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    // 머리(밝은 에메랄드) -> 꼬리(진한 틸)
    const h = 155 - t * 15;
    const l = 55 - t * 22;
    return `hsl(${h}, 75%, ${l}%)`;
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (dead) ctx.globalAlpha = 0.55;
  ctx.shadowColor = 'rgba(52, 211, 153, 0.55)';
  ctx.shadowBlur = 10;

  // 꼬리부터 머리 순으로 선분을 이어서 몸통을 그림
  for (let i = n - 1; i > 0; i--) {
    const [x1, y1] = center(snake[i]);
    const [x2, y2] = center(snake[i - 1]);
    ctx.strokeStyle = color(i);
    ctx.lineWidth = CELL - 4 - (i / n) * 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // 머리
  const [hx, hy] = center(snake[0]);
  ctx.fillStyle = color(0);
  ctx.beginPath();
  ctx.arc(hx, hy, (CELL - 2) / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 눈 (진행 방향 기준으로 좌우에 배치)
  const d = dir || { x: 1, y: 0 };
  const px = -d.y;
  const py = d.x;
  [-1, 1].forEach((side) => {
    const ex = hx + d.x * 3.5 + px * side * 4;
    const ey = hy + d.y * 3.5 + py * side * 4;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dead ? '#ef4444' : '#0f172a';
    ctx.beginPath();
    ctx.arc(ex + d.x * 0.8, ey + d.y * 0.8, 1.3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawParticles() {
  particles = particles.filter((p) => p.life > 0);
  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= 0.035;
    if (p.life <= 0) return;
    ctx.fillStyle = `rgba(252, 165, 165, ${p.life})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fill();
  });
}

function frame(time) {
  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake -= 0.8;
  }
  drawBackground();
  drawFood(time);
  drawSnake();
  drawParticles();
  ctx.restore();

  if (dead) {
    ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(frame);
}

/* ---------- 입력 ---------- */

document.addEventListener('keydown', (e) => {
  const d = KEY_DIRS[e.key];
  if (!d) return;
  e.preventDefault();
  if (!playing || paused) return;
  // 반대 방향(자기 몸 쪽)으로의 즉시 회전 금지
  if (d.x === -dir.x && d.y === -dir.y) return;
  nextDir = d;
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', togglePause);
soundBtn.addEventListener('click', () => {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch (e) {
    // 저장소 사용 불가 시 무시
  }
  updateSoundBtn();
  soundBtn.blur();
  if (!muted) sounds.eat();
});

highScore = loadHighScore();
highScoreEl.textContent = highScore;
food = null;
updateSoundBtn();
requestAnimationFrame(frame);

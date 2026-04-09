import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

// --- Audio Engine ---
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.currentSource = null;
        this.unlocked = false;
        this.currentType = 'none';
        this.isShuffle = false;
        this.shuffleInterval = null;
        this.alarmOsc = null;
        this.alarmGain = null;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        this.unlocked = true;
    }

    playBell() {
        if (!this.unlocked) this.init();
        if (!this.ctx) return;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 1);
        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 1);
    }

    startAlarm() {
        if (!this.unlocked) this.init();
        if (!this.ctx) return;
        this.stopAlarm(); // Clear existing

        // Soft beeps: Sine wave, low gain
        this.alarmOsc = this.ctx.createOscillator();
        this.alarmGain = this.ctx.createGain();
        this.alarmOsc.type = 'sine';
        this.alarmOsc.frequency.value = 880;
        this.alarmGain.gain.value = 0;
        
        // Beeping effect
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.type = 'square';
        lfo.frequency.value = 2; // 2Hz beep
        lfoGain.gain.value = 0.05; // Soft volume
        lfo.connect(lfoGain.gain);
        lfoGain.connect(this.alarmGain.gain);
        
        this.alarmOsc.connect(this.alarmGain);
        this.alarmGain.connect(this.ctx.destination);
        
        this.alarmOsc.start();
        lfo.start();
        
        this.activeLfo = lfo;

        // Auto stop after 30s
        setTimeout(() => this.stopAlarm(), 30000);
    }

    stopAlarm() {
        if (this.alarmOsc) {
            this.alarmOsc.stop();
            this.alarmOsc = null;
        }
        if (this.activeLfo) {
            this.activeLfo.stop();
            this.activeLfo = null;
        }
    }

    setSound(type) {
        if (!this.unlocked) this.init();
        if (!this.ctx) return;

        if (this.currentSource) {
            this.currentSource.stop();
            this.currentSource = null;
        }

        this.currentType = type;
        if (type === 'none') return;

        const bufferSize = 2 * this.ctx.sampleRate;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);

        if (type === 'white' || type === 'rain') {
            for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
        } else if (type === 'brown') {
            let lastOut = 0;
            for (let i = 0; i < bufferSize; i++) {
                let white = Math.random() * 2 - 1;
                output[i] = (lastOut + (0.02 * white)) / 1.02;
                lastOut = output[i];
                output[i] *= 3.5;
            }
        }

        const source = this.ctx.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        if (type === 'rain') {
            filter.type = 'lowpass';
            filter.frequency.value = 400;
            gain.gain.value = 0.15;
        } else if (type === 'white') {
            filter.type = 'lowpass';
            filter.frequency.value = 8000;
            gain.gain.value = 0.05;
        } else if (type === 'brown') {
            filter.type = 'lowpass';
            filter.frequency.value = 400;
            gain.gain.value = 0.25;
        } else if (type === 'waves') {
            for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
            filter.type = 'lowpass';
            filter.frequency.value = 500;
            const lfo = this.ctx.createOscillator();
            const lfoGain = this.ctx.createGain();
            lfo.type = 'sine';
            lfo.frequency.value = 0.1;
            lfoGain.gain.value = 0.1;
            lfo.connect(lfoGain.gain);
            gain.gain.value = 0.15;
            lfo.start();
        }

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        source.start();
        this.currentSource = source;
    }

    toggleShuffle(on) {
        this.isShuffle = on;
        if (this.shuffleInterval) clearInterval(this.shuffleInterval);
        if (on) {
            this.shuffleSound();
            this.shuffleInterval = setInterval(() => this.shuffleSound(), 600000); // 10 mins
        }
    }

    shuffleSound() {
        const options = ['rain', 'white', 'brown', 'waves'];
        const random = options[Math.floor(Math.random() * options.length)];
        this.setSound(random);
        // Update UI
        document.querySelectorAll('.sound-opt').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.sound === random);
        });
    }
}

const audio = new AudioEngine();

// --- Timer Logic ---
class Timer {
    constructor(idPrefix, isPrimary = true) {
        this.idPrefix = idPrefix;
        this.isPrimary = isPrimary;
        this.totalSeconds = 1500;
        this.secondsLeft = 1500;
        this.timerId = null;
        this.startTime = null;
        this.isPaused = false;
        this.isActive = false;

        // Elements
        this.els = {
            inputGroup: document.getElementById(isPrimary ? 'input-group' : null),
            inHH: document.getElementById(isPrimary ? 'in-hh' : null),
            inMM: document.getElementById(isPrimary ? 'in-mm' : null),
            inSS: document.getElementById(isPrimary ? 'in-ss' : null),
            display: document.getElementById(isPrimary ? 'time-display' : 'mini-time-display'),
            progressBar: document.getElementById(isPrimary ? 'progress-bar' : 'mini-progress-bar'),
            statusText: document.getElementById(isPrimary ? 'status-text' : null),
            container: document.getElementById(isPrimary ? null : 'secondary-timer'),
            btnStart: document.getElementById(isPrimary ? 'btn-start' : 'btn-mini-start'),
            btnPause: document.getElementById(isPrimary ? 'btn-pause' : 'btn-mini-pause')
        };
    }

    updateDisplay() {
        const timeStr = this.formatTime(this.secondsLeft);
        this.els.display.textContent = timeStr;
        if (this.isPrimary) document.title = `${timeStr} | Focus`;

        const RING_LENGTH = 301.6;
        const offset = RING_LENGTH - (this.secondsLeft / this.totalSeconds) * RING_LENGTH;
        if (this.els.progressBar) {
            this.els.progressBar.style.strokeDashoffset = offset;
        }
    }

    formatTime(total) {
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    tick() {
        const now = Date.now();
        const elapsed = Math.floor((now - this.startTime) / 1000);
        this.secondsLeft = Math.max(0, this.totalSeconds - elapsed);
        this.updateDisplay();

        if (this.secondsLeft <= 0) {
            this.finish();
        }
    }

    start(seconds) {
        if (seconds !== undefined) {
            this.totalSeconds = seconds;
            this.secondsLeft = seconds;
        }
        audio.init();
        if (this.timerId) clearInterval(this.timerId);
        this.startTime = Date.now() - (this.totalSeconds - this.secondsLeft) * 1000;
        this.timerId = setInterval(() => this.tick(), 100);
        this.isActive = true;
        this.isPaused = false;
        
        if (this.isPrimary) {
            this.els.inputGroup.classList.add('hidden');
            document.getElementById('presets').classList.add('hidden');
            this.els.display.classList.remove('hidden');
            this.els.btnStart.classList.add('hidden');
            this.els.btnPause.classList.remove('hidden');
            document.getElementById('btn-reset').classList.remove('hidden');
            document.getElementById('btn-add-timer-active').classList.remove('hidden');
            this.els.statusText.textContent = 'Focusing';
        } else {
            this.els.btnStart.classList.add('hidden');
            this.els.btnPause.classList.remove('hidden');
            document.getElementById('mini-input-group').classList.add('hidden');
            this.els.display.classList.remove('hidden');
        }
        this.updateDisplay();
    }

    pause() {
        clearInterval(this.timerId);
        this.timerId = null;
        this.isPaused = true;
        if (this.isPrimary) {
            this.els.btnPause.innerHTML = '<div class="hold-progress"></div><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
            this.els.statusText.textContent = 'Paused';
        } else {
            this.els.btnPause.innerHTML = '<div class="hold-progress"></div><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        }
    }

    resume() {
        this.startTime = Date.now() - (this.totalSeconds - this.secondsLeft) * 1000;
        this.timerId = setInterval(() => this.tick(), 100);
        this.isPaused = false;
        if (this.isPrimary) {
            this.els.btnPause.innerHTML = '<div class="hold-progress"></div><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
            this.els.statusText.textContent = 'Focusing';
        } else {
            this.els.btnPause.innerHTML = '<div class="hold-progress"></div><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
        }
    }

    finish() {
        clearInterval(this.timerId);
        this.timerId = null;
        this.isActive = false;
        showBanner(`Timer ${this.isPrimary ? '1' : '2'} complete!`);
        audio.startAlarm();
        if (Notification.permission === "granted") {
            new Notification("Session Complete", { body: "Focused time complete." });
        }
        this.reset();
    }

    reset() {
        clearInterval(this.timerId);
        this.timerId = null;
        this.isActive = false;
        this.isPaused = false;
        
        if (this.isPrimary) {
            this.els.inputGroup.classList.remove('hidden');
            document.getElementById('presets').classList.remove('hidden');
            this.els.display.classList.add('hidden');
            this.els.btnStart.classList.remove('hidden');
            this.els.btnPause.classList.add('hidden');
            document.getElementById('btn-reset').classList.add('hidden');
            document.getElementById('btn-add-timer-active').classList.add('hidden');
            this.els.btnPause.innerHTML = '<div class="hold-progress"></div><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
            this.els.statusText.textContent = 'Ready to focus';
        } else {
            this.els.container.classList.add('hidden');
            this.els.btnStart.classList.remove('hidden');
            this.els.btnPause.classList.add('hidden');
            document.getElementById('mini-input-group').classList.remove('hidden');
            this.els.display.classList.add('hidden');
        }
        
        this.secondsLeft = this.totalSeconds;
        this.updateDisplay();
    }
}

let primaryTimer;
let secondaryTimer;
let miniInMM;
let miniInSS;

// --- UI Helpers ---
function showBanner(msg) {
    const banner = document.getElementById('banner-alert');
    document.getElementById('banner-msg').textContent = msg;
    banner.classList.remove('hidden');
}

document.getElementById('btn-stop-alarm').addEventListener('click', () => {
    audio.stopAlarm();
    document.getElementById('banner-alert').classList.add('hidden');
});

function swapTimers() {
    // Swap data
    const temp = {
        total: primaryTimer.totalSeconds,
        left: primaryTimer.secondsLeft,
        active: primaryTimer.isActive,
        paused: primaryTimer.isPaused,
        timerId: primaryTimer.timerId
    };

    // Stop intervals
    if (primaryTimer.timerId) clearInterval(primaryTimer.timerId);
    if (secondaryTimer.timerId) clearInterval(secondaryTimer.timerId);

    primaryTimer.totalSeconds = secondaryTimer.totalSeconds;
    primaryTimer.secondsLeft = secondaryTimer.secondsLeft;
    primaryTimer.isActive = secondaryTimer.isActive;
    primaryTimer.isPaused = secondaryTimer.isPaused;

    secondaryTimer.totalSeconds = temp.total;
    secondaryTimer.secondsLeft = temp.left;
    secondaryTimer.isActive = temp.active;
    secondaryTimer.isPaused = temp.paused;

    // Restart intervals if active
    if (primaryTimer.isActive && !primaryTimer.isPaused) {
        primaryTimer.startTime = Date.now() - (primaryTimer.totalSeconds - primaryTimer.secondsLeft) * 1000;
        primaryTimer.timerId = setInterval(() => primaryTimer.tick(), 100);
    }
    if (secondaryTimer.isActive && !secondaryTimer.isPaused) {
        secondaryTimer.startTime = Date.now() - (secondaryTimer.totalSeconds - secondaryTimer.secondsLeft) * 1000;
        secondaryTimer.timerId = setInterval(() => secondaryTimer.tick(), 100);
    }

    // Update UI
    if (primaryTimer.isActive) {
        primaryTimer.els.inputGroup.classList.add('hidden');
        document.getElementById('presets').classList.add('hidden');
        primaryTimer.els.display.classList.remove('hidden');
        primaryTimer.els.btnStart.classList.add('hidden');
        primaryTimer.els.btnPause.classList.remove('hidden');
        document.getElementById('btn-reset').classList.remove('hidden');
        document.getElementById('btn-add-timer-active').classList.remove('hidden');
        if (primaryTimer.isPaused) {
            primaryTimer.els.btnPause.innerHTML = '<div class="hold-progress"></div><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
            primaryTimer.els.statusText.textContent = 'Paused';
        } else {
            primaryTimer.els.btnPause.innerHTML = '<div class="hold-progress"></div><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
            primaryTimer.els.statusText.textContent = 'Focusing...';
        }
    } else {
        primaryTimer.reset();
    }

    if (secondaryTimer.isActive) {
        secondaryTimer.els.container.classList.remove('hidden');
        document.getElementById('mini-input-group').classList.add('hidden');
        secondaryTimer.els.display.classList.remove('hidden');
        if (secondaryTimer.isPaused) {
            secondaryTimer.els.btnStart.classList.remove('hidden');
            secondaryTimer.els.btnPause.classList.add('hidden');
        } else {
            secondaryTimer.els.btnStart.classList.add('hidden');
            secondaryTimer.els.btnPause.classList.remove('hidden');
        }
    } else {
        secondaryTimer.els.container.classList.add('hidden');
        document.getElementById('mini-input-group').classList.remove('hidden');
        secondaryTimer.els.display.classList.add('hidden');
    }

    primaryTimer.updateDisplay();
    secondaryTimer.updateDisplay();
}

// --- Dragging Logic ---
function setupDragging(elId, handleId) {
    const el = document.getElementById(elId);
    const handle = document.getElementById(handleId);
    let isDragging = false;
    let startX, startY;
    let initialX, initialY;

    const onStart = (e) => {
        isDragging = true;
        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;
        startX = clientX;
        startY = clientY;
        const rect = el.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.left = initialX + 'px';
        el.style.top = initialY + 'px';
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;
        const dx = clientX - startX;
        const dy = clientY - startY;
        
        let nextX = initialX + dx;
        let nextY = initialY + dy;
        
        // Boundaries
        const rect = el.getBoundingClientRect();
        nextX = Math.max(0, Math.min(window.innerWidth - rect.width, nextX));
        nextY = Math.max(0, Math.min(window.innerHeight - rect.height, nextY));
        
        el.style.left = nextX + 'px';
        el.style.top = nextY + 'px';
    };

    const onEnd = () => {
        isDragging = false;
    };

    handle.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);

    handle.addEventListener('touchstart', (e) => {
        e.preventDefault();
        onStart(e);
    }, { passive: false });
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);
}

// --- Event Listeners ---
const htmlEl = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');
const soundMenuBtn = document.getElementById('sound-menu-btn');
const soundMenu = document.getElementById('sound-menu');
const soundOpts = document.querySelectorAll('.sound-opt');
const btnShuffle = document.getElementById('btn-shuffle');

function updateThemeUI(theme) {
    const lightIcon = document.getElementById('theme-icon-light');
    const darkIcon = document.getElementById('theme-icon-dark');
    if (theme === 'light') {
        lightIcon.classList.remove('hidden');
        darkIcon.classList.add('hidden');
    } else {
        lightIcon.classList.add('hidden');
        darkIcon.classList.remove('hidden');
    }
}

// Input handling
function clamp(v, min, max) { return Math.max(min, Math.min(max, parseInt(v) || 0)); }

function getPrimarySeconds() {
    const h = parseInt(primaryTimer.els.inHH.value) || 0;
    const m = parseInt(primaryTimer.els.inMM.value) || 0;
    const s = parseInt(primaryTimer.els.inSS.value) || 0;
    return (h * 3600) + (m * 60) + s;
}

function getSecondarySeconds() {
    const m = parseInt(miniInMM.value) || 0;
    const s = parseInt(miniInSS.value) || 0;
    return (m * 60) + s;
}

const addTimerHandler = () => {
    secondaryTimer.els.container.classList.remove('hidden');
    secondaryTimer.totalSeconds = 900;
    secondaryTimer.secondsLeft = 900;
    miniInMM.value = '15';
    miniInSS.value = '00';
    secondaryTimer.updateDisplay();
};

// Long Press Logic
function setupHold(btnId, onComplete, duration = 1000, isToggle = false, timerObj = null) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    let holdTimer = null;
    
    const start = () => {
        if (btn.classList.contains('hidden')) return;
        
        // If it's a pause button and we are in "Resume" mode (showing play icon), don't hold
        if (isToggle && timerObj && timerObj.isPaused) {
            onComplete();
            return;
        }

        const progress = btn.querySelector('.hold-progress');
        progress.style.transition = `width ${duration}ms linear`;
        progress.style.width = '100%';
        holdTimer = setTimeout(() => {
            onComplete();
            cancel();
        }, duration);
    };
    
    const cancel = () => {
        clearTimeout(holdTimer);
        const progress = btn.querySelector('.hold-progress');
        progress.style.transition = 'width 0.2s ease-out';
        progress.style.width = '0%';
    };

    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', cancel);
    btn.addEventListener('mouseleave', cancel);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); start(); });
    btn.addEventListener('touchend', cancel);
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    const theme = localStorage.getItem('theme') || 'light';
    htmlEl.setAttribute('data-theme', theme);
    updateThemeUI(theme);
    
    // Initialize Timers
    primaryTimer = new Timer('main', true);
    secondaryTimer = new Timer('mini', false);

    // Initialize Mini Inputs
    miniInMM = document.getElementById('mini-in-mm');
    miniInSS = document.getElementById('mini-in-ss');

    // --- Event Listeners ---
    themeToggle.addEventListener('click', () => {
        const current = htmlEl.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        htmlEl.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeUI(next);
    });

    soundMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        soundMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', () => soundMenu.classList.add('hidden'));

    soundOpts.forEach(opt => {
        if (opt.id === 'btn-shuffle') return;
        opt.addEventListener('click', () => {
            audio.toggleShuffle(false);
            audio.setSound(opt.dataset.sound);
            soundOpts.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
        });
    });

    btnShuffle.addEventListener('click', () => {
        audio.toggleShuffle(true);
        soundOpts.forEach(o => o.classList.remove('active'));
        btnShuffle.classList.add('active');
    });

    // Input handling
    [primaryTimer.els.inHH, primaryTimer.els.inMM, primaryTimer.els.inSS].forEach(input => {
        if (!input) return;
        input.addEventListener('blur', () => {
            if (input.value === '') return;
            input.value = clamp(input.value, 0, input.id === 'in-hh' ? 99 : 59).toString().padStart(2, '0');
        });
        input.addEventListener('input', () => {
            if (input.value.length >= 2) {
                if (input === primaryTimer.els.inHH) primaryTimer.els.inMM.focus();
                else if (input === primaryTimer.els.inMM) primaryTimer.els.inSS.focus();
            }
        });
    });

    [miniInMM, miniInSS].forEach(input => {
        if (!input) return;
        input.addEventListener('blur', () => {
            if (input.value === '') return;
            input.value = clamp(input.value, 0, 59).toString().padStart(2, '0');
        });
        input.addEventListener('input', () => {
            if (input.value.length >= 2 && input === miniInMM) miniInSS.focus();
        });
    });

    document.getElementById('btn-start').addEventListener('click', () => {
        primaryTimer.start(getPrimarySeconds() || 900);
    });

    document.querySelectorAll('.preset-btn').forEach(btn => {
        if (btn.id === 'btn-add-timer' || btn.id === 'btn-add-timer-active') return;
        btn.addEventListener('click', () => {
            primaryTimer.start(parseInt(btn.dataset.time));
        });
    });

    document.getElementById('btn-add-timer').addEventListener('click', addTimerHandler);
    document.getElementById('btn-add-timer-active').addEventListener('click', addTimerHandler);

    document.getElementById('btn-mini-start').addEventListener('click', () => {
        secondaryTimer.start(getSecondarySeconds() || 900);
    });

    document.getElementById('btn-mini-swap').addEventListener('click', swapTimers);

    // Hold only for Pause and Reset
    setupHold('btn-pause', () => {
        if (primaryTimer.isPaused) primaryTimer.resume();
        else primaryTimer.pause();
    }, 1000, true, primaryTimer);

    setupHold('btn-reset', () => primaryTimer.reset(), 2000);

    setupHold('btn-mini-pause', () => {
        if (secondaryTimer.isPaused) secondaryTimer.resume();
        else secondaryTimer.pause();
    }, 1000, true, secondaryTimer);

    setupHold('btn-mini-close', () => secondaryTimer.reset(), 2000);

    // Default to 15:00
    primaryTimer.els.inHH.value = '00';
    primaryTimer.els.inMM.value = '15';
    primaryTimer.els.inSS.value = '00';
    
    primaryTimer.updateDisplay();
    secondaryTimer.updateDisplay();
    setupDragging('secondary-timer', 'mini-drag-handle');
});

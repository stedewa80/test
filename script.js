let video = document.getElementById('webcam');
let canvas = document.getElementById('motion-canvas');
let ctx = canvas.getContext('2d', { willReadFrequently: true });

let timerDisplay = document.getElementById('timer-display');
let statusText = document.getElementById('status-text');
let startBtn = document.getElementById('start-btn');
let stopBtn = document.getElementById('stop-btn');
let warningOverlay = document.getElementById('warning-overlay');
let taskDisplay = document.getElementById('task-display');

// Bericht-Elemente
let reportPanel = document.getElementById('report-panel');
let reportViolations = document.getElementById('report-violations');
let reportPenalty = document.getElementById('report-penalty');
let reportTasks = document.getElementById('report-tasks');

let countdown;
let timeLeft = 0;
let isSessionActive = false;

let lastFrameData = null;
let motionDetectionInterval;
let taskTimeout;
let audioCtx = null;

// Statistik-Zähler
let totalViolations = 0;
let totalPenaltyTime = 0;
let totalTasksAssigned = 0;

// Pool an zufälligen Aufgaben während des Stillstehens
const tasksPool = [
    "Hebe dein linkes Bein für zwanzig Sekunden.",
    "Strecke beide Arme seitlich aus.",
    "Schließe deine Augen bis zur nächsten Ansage.",
    "Blicke starr nach oben zur Decke.",
    "Verschränke die Arme hinter dem Kopf.",
    "Stehe auf den Zehenspitzen."
];

function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Laufende Ansagen abbrechen
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'de-DE';
        window.speechSynthesis.speak(utterance);
    }
}

function playBeep() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

async function initWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
        video.srcObject = stream;
        canvas.width = 320;
        canvas.height = 240;
    } catch (err) {
        statusText.textContent = "Kamera-Zugriff verweigert.";
        startBtn.disabled = true;
    }
}

function detectMotion() {
    if (!isSessionActive) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = currentFrame.data;

    if (lastFrameData) {
        let changedPixels = 0;
        const threshold = 30;

        for (let i = 0; i < data.length; i += 4) {
            const rDiff = Math.abs(data[i] - lastFrameData[i]);
            const gDiff = Math.abs(data[i+1] - lastFrameData[i+1]);
            const bDiff = Math.abs(data[i+2] - lastFrameData[i+2]);

            if ((rDiff + gDiff + bDiff) / 3 > threshold) {
                changedPixels++;
            }
        }

        const totalPixels = canvas.width * canvas.height;
        const motionPercentage = (changedPixels / totalPixels) * 100;
        
        const sensitivity = 100 - document.getElementById('sensitivity-input').value;
        const triggerLimit = sensitivity * 0.1;

        if (motionPercentage > triggerLimit) {
            triggerViolation();
        }
    }
    lastFrameData = data;
}

function triggerViolation() {
    playBeep();
    warningOverlay.classList.remove('hidden');
    
    // Statistiken & Strafe aktualisieren (+10s)
    totalViolations++;
    totalPenaltyTime += 10;
    timeLeft += 10;
    updateDisplay();

    setTimeout(() => {
        warningOverlay.classList.add('hidden');
    }, 1000);
}

// Planer für die zufälligen Aufgaben
function scheduleNextTask() {
    if (!isSessionActive || !document.getElementById('tasks-checkbox').checked) return;

    // Zufälliges Intervall zwischen 30 und 60 Sekunden generieren
    const randomDelay = (Math.floor(Math.random() * 31) + 30) * 1000;

    taskTimeout = setTimeout(() => {
        if (!isSessionActive) return;

        const randomTask = tasksPool[Math.floor(Math.random() * tasksPool.length)];
        
        taskDisplay.textContent = `Aufgabe: ${randomTask}`;
        taskDisplay.classList.remove('hidden');
        speak(randomTask);
        
        totalTasksAssigned++;

        // Nach 15 Sekunden die Textanzeige der Aufgabe wieder leeren
        setTimeout(() => {
            if (isSessionActive) {
                taskDisplay.textContent = "Aktuelle Aufgabe: Stillstehen";
            }
        }, 15000);

        // Nächste Aufgabe in die Warteschlange einreihen
        scheduleNextTask();
    }, randomDelay);
}

function updateDisplay() {
    const min = Math.floor(timeLeft / 60);
    const sec = timeLeft % 60;
    timerDisplay.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

startBtn.addEventListener('click', () => {
    const durationInput = document.getElementById('duration-input').value;
    timeLeft = parseInt(durationInput) * 60;
    
    // Zähler zurücksetzen
    totalViolations = 0;
    totalPenaltyTime = 0;
    totalTasksAssigned = 0;
    
    isSessionActive = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    reportPanel.classList.add('hidden');
    taskDisplay.classList.add('hidden');
    statusText.textContent = "Sitzung läuft. Bitte nicht bewegen!";
    
    speak("Geh in die Ecke und bleibe still stehen.");
    updateDisplay();

    countdown = setInterval(() => {
        if(timeLeft > 0) {
            timeLeft--;
            updateDisplay();
        } else {
            endSession();
        }
    }, 1000);

    motionDetectionInterval = setInterval(detectMotion, 100);
    scheduleNextTask();
});

function endSession() {
    clearInterval(countdown);
    clearInterval(motionDetectionInterval);
    clearTimeout(taskTimeout);
    
    isSessionActive = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    statusText.textContent = "Sitzung beendet!";
    taskDisplay.classList.add('hidden');
    speak("Die Sitzung ist beendet. Du darfst die Ecke verlassen.");

    // Bericht befüllen und einblenden
    reportViolations.textContent = totalViolations;
    reportPenalty.textContent = `${totalPenaltyTime}s`;
    reportTasks.textContent = totalTasksAssigned;
    reportPanel.classList.remove('hidden');
}

stopBtn.addEventListener('click', () => {
    clearInterval(countdown);
    clearInterval(motionDetectionInterval);
    clearTimeout(taskTimeout);
    
    isSessionActive = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent = "Sitzung abgebrochen.";
    timerDisplay.textContent = "00:00";
    taskDisplay.classList.add('hidden');
});

window.addEventListener('DOMContentLoaded', initWebcam);

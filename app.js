// =========================================================================
// 1. Define all Cornertime Settings and Variables
// =========================================================================

// --- Routine Selection ---
let selPos = "", selArm = "", selLeg = "";

// --- Duration and Penalties ---
let minD = 30, maxD = 45, capD = 120;
let minP = 5, maxP = 10;

// --- Advanced Settings ---
let isTimerHidden = false;

// --- Custom Phrases ---
let customStart = "";
let customEncouragements = "";
let customEnd = "";
let minE = 20, maxE = 40;

// --- Display Settings ---
let standardFPS = 15, reducedFPS = 4, aicheckFPS = 2;
let isDisplayDim = false;

// --- Crypto Settings ---
let salt = "";

// Routine input
let inputRoutine = "";

// =========================================================================
// 2. Define all Video Settings and Variables
// =========================================================================

// --- DOM Layout Reference Elements ---
const video = document.getElementById('webcam');
const canvas = document.getElementById('processingCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('camContainer');
const status = document.getElementById('status');
const timerDisplay = document.getElementById('timerDisplay');

// --- Canvas Sizing ---
canvas.width = 257; 
canvas.height = 257;

// --- Zoom Coordinates (Cropped Snapshot Bounds) ---
let staticZoomCoords = null

// --- DOM Overlay Elements (Physical Keypoint Tracking Indicators) ---
const pts = { 
    head: document.getElementById('ptHead'), 
    lS: document.getElementById('ptLShoulder'), rS: document.getElementById('ptRShoulder'), 
    lW: document.getElementById('ptLWrist'),    rW: document.getElementById('ptRWrist'), 
    lE: document.getElementById('ptLElbow'),    rE: document.getElementById('ptRElbow'), 
    lH: document.getElementById('ptLHip'),      rH: document.getElementById('ptRHip'),
    lK: document.getElementById('ptLKnee'),     rK: document.getElementById('ptRKnee'), 
    lF: document.getElementById('ptLFoot'),     rF: document.getElementById('ptRFoot')
};

// --- Frame Delay ---
let standardDelay = 66; // Standard: ~15 FPS (1000 / 15)
let increasedDelay = 250; // Standard: ~4 FPS (1000 / 4)
let aiCheckInterval = 500;    // Standard: ~2 FPS (1000 / 2)
let currentFrameDelay = standardDelay;

// --- Wake Lock ---
let wakeLock = null;

// =========================================================================
// 3. Define all Audio Settings and Variables including Speech Output
// =========================================================================

// --- Default Speech Output ---
let phrases = {
    start: "In Position gehen",
    drift: "Bewegung erkannt bei {joint}. Plus {penalty} Sekunden. Haltung korrigieren.",
    escalation: "{msg}. Strafe plus {penalty} Sekunden.",
    checkpoint: "Position erfolgreich wiederhergestellt.",
    success: "Training beendet. Ausgezeichnet.",
    capReached: "Maximalzeit erreicht. Abbruch."
};
let encouragementPhrases = ["Halt durch!", "Sehr gute Haltung!", "Bleib genau so.", "Rücken gerade lassen, perfekt!"];

// --- Encouragement Settings ---
let nextEncouragementTimestamp = 0;
let minEncouragementInterval = 20;
let maxEncouragementInterval = 40;

// --- Audio State ---
let isAudioSpeakingBlock = false;
let activeUtterance = null; 

// =========================================================================
// 4. Define all Physical Keypoints and Variables including Translation
// =========================================================================

// --- Physical Keypoints (Pre-allocated Matrix Object Pool) ---
const latestKeypoints = {
    left_shoulder: { x: 0, y: 0, score: 0 }, right_shoulder: { x: 0, y: 0, score: 0 },
    left_wrist:    { x: 0, y: 0, score: 0 }, right_wrist:    { x: 0, y: 0, score: 0 },
    left_elbow:    { x: 0, y: 0, score: 0 }, right_elbow:    { x: 0, y: 0, score: 0 },
    left_hip:      { x: 0, y: 0, score: 0 }, right_hip:      { x: 0, y: 0, score: 0 },
    left_knee:     { x: 0, y: 0, score: 0 }, right_knee:     { x: 0, y: 0, score: 0 },
    left_heel:     { x: 0, y: 0, score: 0 }, right_heel:     { x: 0, y: 0, score: 0 },
    left_ear:      { x: 0, y: 0, score: 0 }, right_ear:      { x: 0, y: 0, score: 0 },
    left_foot_index:  { x: 0, y: 0, score: 0 }, right_foot_index: { x: 0, y: 0, score: 0 }
};

// --- Translation of Physical Keypoints ---
const punktNamenDe = {
    'left_shoulder': 'Rechte Schulter', 'right_shoulder': 'Linke Schulter', 
    'left_elbow': 'Rechter Ellbogen',   'right_elbow': 'Linker Ellbogen',
    'left_wrist': 'Rechtes Handgelenk', 'right_wrist': 'Linkes Handgelenk', 
    'left_hip': 'Rechte Hüfte',         'right_hip': 'Linke Hüfte',
    'left_knee': 'Rechtes Knie',        'right_knee': 'Linkes Knie', 
    'left_heel': 'Rechte Ferse',        'right_heel': 'Linke Ferse',
    'left_foot_index': 'Rechte Fußspitze', 'right_foot_index': 'Linke Fußspitze', 
    'left_ear': 'Kopf',                 'right_ear': 'Kopf'
};

// --- Anchor Pose ---
let anchorPose = {};

// --- Base Shoulder Width ---
let baseShoulderWidth = 100;

// =========================================================================
// 3. Define all Management States, Time Trackers and Logging Variables
// =========================================================================

// --- Core Tracking Engine ---
let detector = null;

// --- Status Management States ---
let isPrepared = false;
let isProcessingPose = false;
let isGracePeriodActive = false;
let appEnded = false;

// --- Workout Time Trackers ---
let timeRemainingSeconds = 30;
let totalTimeElapsed = 0;
let workoutInterval = null;
let gracePeriodEndTime = 0;
let remainingSecondsCounter = 3;

// --- Chrono Log Timestamps ---
let initialTargetDuration = 0;
let realStartTimestamp = 0;
let startTimeStr = "";
let lastCheckpointTimestamp = 0;
let lastAICheckTimestamp = 0; 

// --- Analytics and Penalties Tracking ---
let logEvents = [];
let totalPenaltiesCount = 0;
let totalPenaltySecondsSum = 0;

// --- Llamalab Endpoint ---
let llamaLabEndpoint = "";

// =========================================================================
// 1. GLOBAL CONFIGURATION & APP CONSTANTS
// =========================================================================
// Diese Werte werden beim Start dynamisch aus der HTML überschrieben
//let tierRepositionDelay = 66; // Standard: ~15 FPS (1000 / 15)
//let tierStillnessDelay = 250; // Standard: ~4 FPS (1000 / 4)
//let aiCheckInterval = 500;    // Standard: ~2 FPS (1000 / 2)

// Flag für das optionale Dimmen aus der HTML
//let allowDimming = false;

// --- DOM Layout Reference Elements ---
//const video = document.getElementById('webcam');
//const canvas = document.getElementById('processingCanvas');
//const ctx = canvas.getContext('2d');
//const container = document.getElementById('camContainer');
//const status = document.getElementById('status');
//const timerDisplay = document.getElementById('timerDisplay');

// Set permanent input sizing properties for the rendering context
//canvas.width = 257; 
//canvas.height = 257;

// --- Physical UI Tracking Indicators (DOM Overlays) ---
//const pts = { 
//    head: document.getElementById('ptHead'), 
//    lS: document.getElementById('ptLShoulder'), rS: document.getElementById('ptRShoulder'), 
//    lW: document.getElementById('ptLWrist'),    rW: document.getElementById('ptRWrist'), 
//    lE: document.getElementById('ptLElbow'),    rE: document.getElementById('ptRElbow'), 
//    lH: document.getElementById('ptLHip'),      rH: document.getElementById('ptRHip'),
//    lK: document.getElementById('ptLKnee'),     rK: document.getElementById('ptRKnee'), 
//    lF: document.getElementById('ptLFoot'),     rF: document.getElementById('ptRFoot')
//};

// =========================================================================
// 2. RUNTIME STATE FLAGS & GLOBAL MEMORY ALLOCATION
// =========================================================================
// --- Active Routine Selection ---
//let selPos = "", selArm = "", selLeg = "";

// --- Target Boundaries and Crypto Settings ---
//let minD = 30, maxD = 45, capD = 120, minP = 5, maxP = 10, salt = "";

// --- Core Tracking Engines ---
//let detector = null;
//let anchorPose = {};
//let isPrepared = false;
//let baseShoulderWidth = 100;
//let wakeLock = null;

// --- Workout Timeline Trackers ---
//let timeRemainingSeconds = 30;
//let totalTimeElapsed = 0;
//let workoutInterval = null;

// --- Status Management States ---
//let isGracePeriodActive = false;
//let gracePeriodEndTime = 0;
//let remainingSecondsCounter = 3;
//let appEnded = false;
//let isAudioSpeakingBlock = false;
//let activeUtterance = null; 

// --- Crop Snapshot Bounds ---
//let staticZoomCoords = null; 

// --- Motivation Settings & Telemetry ---
//let isTimerHidden = false;
//let llamaLabEndpoint = ""; 
//let nextEncouragementTimestamp = 0;
//let minEncouragementInterval = 20;
//let maxEncouragementInterval = 40;

// --- Chrono Log Timestamps ---
//let initialTargetDuration = 0;
//let realStartTimestamp = 0;
//let startTimeStr = "";
//let lastCheckpointTimestamp = 0;
//let lastAICheckTimestamp = 0;
//let isProcessingPose = false; 

// --- Analytics and Penalties Tracking ---
//let logEvents = [];
//let totalPenaltiesCount = 0;
//let totalPenaltySecondsSum = 0;

// --- Hardware Execution Rate Setting ---
//let currentFrameDelay = tierRepositionDelay; 

// --- Pre-Allocated Keypoint Matrix Object Pool ---
//const latestKeypoints = {
//    left_shoulder: { x: 0, y: 0, score: 0 }, right_shoulder: { x: 0, y: 0, score: 0 },
//    left_wrist:    { x: 0, y: 0, score: 0 }, right_wrist:    { x: 0, y: 0, score: 0 },
//    left_elbow:    { x: 0, y: 0, score: 0 }, right_elbow:    { x: 0, y: 0, score: 0 },
//    left_hip:      { x: 0, y: 0, score: 0 }, right_hip:      { x: 0, y: 0, score: 0 },
//    left_knee:     { x: 0, y: 0, score: 0 }, right_knee:     { x: 0, y: 0, score: 0 },
//    left_heel:     { x: 0, y: 0, score: 0 }, right_heel:     { x: 0, y: 0, score: 0 },
//    left_ear:      { x: 0, y: 0, score: 0 }, right_ear:      { x: 0, y: 0, score: 0 },
//    left_foot_index:  { x: 0, y: 0, score: 0 }, right_foot_index: { x: 0, y: 0, score: 0 }
//};

// --- Language Strings & Translation Mappings ---
//let phrases = {
//    start: "In Position gehen",
//    drift: "Bewegung erkannt bei {joint}. Plus {penalty} Sekunden. Haltung korrigieren.",
//    escalation: "{msg}. Strafe plus {penalty} Sekunden.",
//    checkpoint: "Position erfolgreich wiederhergestellt.",
//    success: "Training beendet. Ausgezeichnet.",
//    capReached: "Maximalzeit erreicht. Abbruch."
//};
//let encouragementPhrases = ["Halt durch!", "Sehr gute Haltung!", "Bleib genau so.", "Rücken gerade lassen, perfekt!"];

//const punktNamenDe = {
//    'left_shoulder': 'Rechte Schulter', 'right_shoulder': 'Linke Schulter', 
//    'left_elbow': 'Rechter Ellbogen',   'right_elbow': 'Linker Ellbogen',
//    'left_wrist': 'Rechtes Handgelenk', 'right_wrist': 'Linkes Handgelenk', 
//    'left_hip': 'Rechte Hüfte',         'right_hip': 'Linke Hüfte',
//    'left_knee': 'Rechtes Knie',        'right_knee': 'Linkes Knie', 
//    'left_heel': 'Rechte Ferse',        'right_heel': 'Linke Ferse',
//    'left_foot_index': 'Rechte Fußspitze', 'right_foot_index': 'Linke Fußspitze', 
//    'left_ear': 'Kopf',                 'right_ear': 'Kopf'
//};

// =========================================================================
// 3. TEXT-TO-SPEECH (TTS) & METRIC UI UTILITIES
// =========================================================================

/**
 * Handles synthesized vocal instructions through the Web Speech API with fallback execution safety nets.
 */
function speak(text, force = false, callbackOnEnd = null) {
    try {
        if (force) { window.speechSynthesis.cancel(); }
        if (!force && window.speechSynthesis.speaking) { if (callbackOnEnd) callbackOnEnd(); return; }
        
        activeUtterance = new SpeechSynthesisUtterance(text); 
        activeUtterance.lang = 'de-DE'; 
        activeUtterance.rate = 1.15; 
        
        let fallbackTriggered = false;
        const safetyTimeout = setTimeout(() => {
            if (!fallbackTriggered) {
                fallbackTriggered = true;
                activeUtterance = null;
                console.warn("SpeechSynthesis timeout protection triggered.");
                if (callbackOnEnd) callbackOnEnd();
            }
        }, 15000);
        
        activeUtterance.onend = () => { 
            clearTimeout(safetyTimeout);
            if (!fallbackTriggered) { fallbackTriggered = true; activeUtterance = null; if (callbackOnEnd) callbackOnEnd(); }
        };
        activeUtterance.onerror = () => { 
            clearTimeout(safetyTimeout);
            if (!fallbackTriggered) { fallbackTriggered = true; activeUtterance = null; if (callbackOnEnd) callbackOnEnd(); }
        };
        window.speechSynthesis.speak(activeUtterance);
    } catch (e) { 
        console.error("Audio execution error:", e); 
        activeUtterance = null; 
        if (callbackOnEnd) callbackOnEnd(); 
    }
}

// Format time from sec to min:sec
function formatTime(totalSeconds) {
    const min = Math.floor(totalSeconds / 60).toString().padStart(2, '0'); 
    const sec = (totalSeconds % 60).toString().padStart(2, '0'); 
    return `${min}:${sec}`;
}

// Display updated timer (hidden if isTimerHidden selected)
function updateTimerUI() { 
    timerDisplay.innerText = isTimerHidden ? "••:••" : formatTime(timeRemainingSeconds); 
}

// =========================================================================
// 4. COORDINATE EVALUATION HELPERS
// =========================================================================

// Get latest keypoints and store in pre-allocated matrix
function f(part) { return latestKeypoints[part] && latestKeypoints[part].score > 0.4; }

// Calculate keypoints for the head from available keypoints for ears, eyes or nose
function getHeadY() {
    if (f('left_ear') && f('right_ear')) return (latestKeypoints.left_ear.y + latestKeypoints.right_ear.y) / 2;
    if (f('left_eye') && f('right_eye')) return (latestKeypoints.left_eye.y + latestKeypoints.right_eye.y) / 2;
    if (f('nose')) return latestKeypoints.nose.y;
    return 0;
}

function getBestFootY(side) {
    const heel = side === 'left' ? 'left_heel' : 'right_heel'; 
    const tip = side === 'left' ? 'left_foot_index' : 'right_foot_index';
    if (f(heel)) return latestKeypoints[heel].y; 
    if (f(tip)) return latestKeypoints[tip].y; 
    return 0;
}

function hasAnyFoot(side) { 
    return f(side === 'left' ? 'left_heel' : 'right_heel') || f(side === 'left' ? 'left_foot_index' : 'right_foot_index'); 
}

// =========================================================================
// 5. HARDWARE CORE INITIALIZATION & PREPARATION TIMERS
// =========================================================================

async function startApp() {
    
    //salt = document.getElementById('secretSalt').value;
    //isTimerHidden = document.getElementById('hideTimerCheckbox').checked;
    //allowDimming = document.getElementById('dimDisplayCheckbox').checked;

    // --- Display- & Performance-Einstellungen übernehmen ---
    //const standardFPS = parseInt(document.getElementById('standardFPS').value) || 15;
    //const reducedFPS = parseInt(document.getElementById('reducedFPS').value) || 4;
    //const aicheckFPS = parseInt(document.getElementById('aicheckFPS').value) || 2;

    //tierRepositionDelay = Math.round(1000 / standardFPS);
    //tierStillnessDelay = Math.round(1000 / reducedFPS);
    //aiCheckInterval = Math.round(1000 / aicheckFPS);
    //currentFrameDelay = tierRepositionDelay;

    // --- Eigene Ansagen / Phrasen übernehmen ---
    //const customStart = document.getElementById('customStartInput').value.trim();
    //const customEncouragements = document.getElementById('customEncouragementInput').value.trim();
    //const customEnd = document.getElementById('customEndInput').value.trim();

    //if (customEncouragements !== "") {
    //    encouragementPhrases = customEncouragements.split(';').map(s => s.trim()).filter(s => s !== "");
    //}
    //if (customEnd !== "") {
    //    phrases.success = customEnd;
    //}

    // --- Read parameters from imported routine or from website ---
    const routinePaste = document.getElementById('routineImportInput').value.trim();
    if (routinePaste !== "") {
        const success = await loadImportedRoutine(routinePaste);
        if(!success) return;
    } else {
        selPos = document.getElementById('positionSelect').value; 
        selArm = document.getElementById('armSelect').value; 
        selLeg = document.getElementById('legSelect').value;
        minD = parseInt(document.getElementById('minDuration').value); 
        maxD = parseInt(document.getElementById('maxDuration').value); 
        capD = parseInt(document.getElementById('capDuration').value);
        minP = parseInt(document.getElementById('minPenalty').value); 
        maxP = parseInt(document.getElementById('maxPenalty').value); 
        isTimerHidden = document.getElementById('hideTimerCheckbox').checked;
        customStart = document.getElementById('customStartInput').value.trim();
        customEncouragements = document.getElementById('customEncouragementInput').value.trim();
        customEnd = document.getElementById('customEndInput').value.trim();
        minE = parseInt(document.getElementById('minEncouragement').value); 
        maxE = parseInt(document.getElementById('maxEncouragement').value); 
        standardFPS = parseInt(document.getElementById('standardFPS').value) || 15;
        reducedFPS = parseInt(document.getElementById('reducedFPS').value) || 4;
        aicheckFPS = parseInt(document.getElementById('aicheckFPS').value) || 2;
        isDisplayDim = document.getElementById('dimDisplayCheckbox').checked;
        salt = document.getElementById('secretSalt').value;
    }

    // --- Define posture announcements ---
    let announcePos = selPos.replace("_", " ").toLowerCase();
    let announceArm = selArm.replace("_", " ").toLowerCase();
    let announceLeg = selLeg.replace("_", " ").toLowerCase();

    // --- Define custom start phrase ---
    if (customStart !== "") {
        
        // Replace existing placeholders with posture announcements
        let processedStart = customStart
            .replaceAll("{Position}", announcePos)
            .replaceAll("{Arme}", announceArm)
            .replaceAll("{Beine}", announceLeg);
    
        // Check for missing placeholders in the original input
        const missingPos = !customStart.includes("{Position}");
        const missingArm = !customStart.includes("{Arme}");
        const missingLeg = !customStart.includes("{Beine}");
    
        // Add posture reminder in case of missing placeholders
        if (missingPos || missingArm || missingLeg) {
            let addon = " Zur Erinnerung:";
            
            if (missingPos) addon += ` Ausgangsposition: ${announcePos}.`;
            if (missingArm) addon += ` Armhaltung: ${announceArm}.`;
            if (missingLeg) addon += ` Beinhaltung: Beine ${announceLeg}.`;
            
            // Append reminder to processed input
            processedStart += addon;
        }
    
        // Define custom start phrase 
        phrases.start = processedStart;
    } else {

        // Define default start phrase
        phrases.start = `In Position gehen für deine Routine. Ausgangsposition: ${ansagePosition}. Armhaltung: ${ansageArme}. Beinhaltung: Beine ${ansageBeine}.`;
    }
    
    //if (customStart !== "") {
    //    customStart = processedStart.replaceAll("{Position}", ansagePosition);
    //    customStart = processedStart.replaceAll("{Arme}", ansageArme);
    //    customStart = processedStart.replaceAll("{Beine}", ansageBeine);
    //    phrases.start = customStart;
    //} else {
    //    //let ansagePosition = selPos.replace("_", " ").toLowerCase();
    //    //let ansageArme = selArm.replace("_", " ").toLowerCase();
    //    //let ansageBeine = selLeg.toLowerCase();
    //    phrases.start = `In Position gehen für deine Routine. Ausgangsposition: ${ansagePosition}. Armhaltung: ${ansageArme}. Beinhaltung: Beine ${ansageBeine}.`;
    //}

    // --- Define custom encouragement phrases ---
    if (customEncouragements !== "") {
        encouragementPhrases = customEncouragements.split(';').map(s => s.trim()).filter(s => s !== "");
    }
    // --- Define custom end phrase ---
    if (customEnd !== "") {
        phrases.success = customEnd;
    }

    standardDelay = Math.round(1000 / standardFPS);
    increasedDelay = Math.round(1000 / reducedFPS);
    aiCheckInterval = Math.round(1000 / aicheckFPS);
    currentFrameDelay = standardDelay;
    
    //minP = parseInt(document.getElementById('minPenalty').value); 
    //maxP = parseInt(document.getElementById('maxPenalty').value); 

    // --- Update screen visibility ---
    document.getElementById('setupScreen').style.display = 'none'; 
    document.getElementById('activeScreen').style.display = 'block';
    
    timeRemainingSeconds = Math.floor(Math.random() * (maxD - minD + 1)) + minD; 
    initialTargetDuration = timeRemainingSeconds; 
    //updateTimerUI();

    // --- Initialize camera ---
    try {
        status.innerText = "Kamera-Zugriff anfordern...";
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } 
        }); 
        video.srcObject = stream;
        await video.play(); 

        // Wait for video element to load
        let videoCheckTimeout = setInterval(() => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                clearInterval(videoCheckTimeout);
                initModelAndCountdown();
            }
        }, 100);

    } catch(e) { 
        status.innerText = "Kamerafehler! " + e.message; 
        status.style.color = "red"; 
        console.error(e); 
    }
}

async function initModelAndCountdown() {
    try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (err) { }
    
    status.innerText = "Lade MediaPipe-Modell...";
    status.style.color = "#ffaa00";
    
    detector = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, { 
        runtime: 'mediapipe', modelType: 'lite', solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/' 
    });
    
    updateLoopPerformance('SETUP');
    loop();
    
    let setupCountdown = 5;
    status.innerText = "Bereite Routine vor... ⏳"; 
    status.style.color = "#ffaa00"; 
    
    speak(phrases.start, true, () => {
        status.innerText = `In Position gehen! (${setupCountdown}s)`; 
        
        let startTimer = setInterval(() => {
            setupCountdown--;
            if (setupCountdown > 0) {
                status.innerText = `In Position gehen! (${setupCountdown}s)`;
            } else {
                clearInterval(startTimer);
                let result = validateHaltung(); 
                if (result.valid) { 
                    initWorkout(); 
                } else {
                    status.innerText = result.msg; 
                    status.style.color = "#ff3333"; 
                    speak(result.msg, true);
                    
                    let retryAnchor = setInterval(() => {
                        let check = validateHaltung(); 
                        if (check.valid) { initWorkout(); clearInterval(retryAnchor); } 
                        else { status.innerText = check.msg; }
                    }, 1000);
                }
            }
        }, 1000);
    });
}

function initWorkout() {
    realStartTimestamp = Date.now(); 
    startTimeStr = new Date(realStartTimestamp).toLocaleString('de-DE');
    nextEncouragementTimestamp = Date.now() + (Math.floor(Math.random() * (maxEncouragementInterval - minEncouragementInterval + 1)) + minEncouragementInterval) * 1000;
    
    if (Object.keys(latestKeypoints).length > 0) {
        let minX = 257, maxX = 0, minY = 257, maxY = 0, validPoints = 0;
        for (let kp in latestKeypoints) {
            if (latestKeypoints[kp].score > 0.4) {
                let kpX = 257 - latestKeypoints[kp].x; 
                let kpY = latestKeypoints[kp].y;
                if(kpX < minX) minX = kpX; if(kpX > maxX) maxX = kpX;
                if(kpY < minY) minY = kpY; if(kpY > maxY) maxY = kpY;
                validPoints++;
            }
        }
        if (validPoints > 4) {
            let boxW = (maxX - minX); let boxH = (maxY - minY);
            let cx = minX + (boxW / 2); let cy = minY + (boxH / 2);
            let size = Math.max(boxW, boxH) * 1.35; 
            
            let videoMinDim = Math.min(video.videoWidth, video.videoHeight);
            let scaleFactor = videoMinDim / 257;
            let sWidth = Math.min(videoMinDim, size * scaleFactor);
            
            let videoLeftOffset = (video.videoWidth - videoMinDim) / 2;
            let videoTopOffset = (video.videoHeight - videoMinDim) / 2;
            
            staticZoomCoords = {
                sx: Math.max(videoLeftOffset, Math.min(video.videoWidth - sWidth - videoLeftOffset, videoLeftOffset + (cx * scaleFactor) - (sWidth / 2))),
                sy: Math.max(videoTopOffset, Math.min(video.videoHeight - sWidth - videoTopOffset, videoTopOffset + (cy * scaleFactor) - (sWidth / 2))),
                sWidth: sWidth,
                sHeight: sWidth
            };
        }
    }

    setTimeout(() => {
        setNewAnchor("Wächter aktiv");
        lastCheckpointTimestamp = Date.now() + 3000; 
        
        workoutInterval = setInterval(() => {
            if (isPrepared && !appEnded) {
                totalTimeElapsed++;
                if (!isGracePeriodActive && !isAudioSpeakingBlock) { 
                    timeRemainingSeconds--; 
                    updateTimerUI(); 
                }
                
                if (!isGracePeriodActive && !isAudioSpeakingBlock && Date.now() >= nextEncouragementTimestamp) {
                    let randomPhrase = encouragementPhrases[Math.floor(Math.random() * encouragementPhrases.length)];
                    speak(randomPhrase, false);
                    nextEncouragementTimestamp = Date.now() + (Math.floor(Math.random() * (maxEncouragementInterval - minEncouragementInterval + 1)) + minEncouragementInterval) * 1000;
                }

                if (totalTimeElapsed >= capD || timeRemainingSeconds <= 0) { 
                    endWorkout(totalTimeElapsed >= capD ? "CAP_REACHED" : "SUCCESS"); 
                }
            }
        }, 1000);
    }, 1500); 
}

// =========================================================================
// 6. MULTI-TIER ENGINE PERFORMANCE & GRAPHICS PREVIEW LOOP
// =========================================================================

async function loop() {
    if (appEnded) return; 
    
    if (!video.videoWidth || video.videoWidth === 0) {
        requestAnimationFrame(loop);
        return;
    }

    let sx = 0, sy = 0, sWidth = video.videoWidth, sHeight = video.videoHeight;

    if (staticZoomCoords) {
        sx = staticZoomCoords.sx;
        sy = staticZoomCoords.sy;
        sWidth = staticZoomCoords.sWidth;
        sHeight = staticZoomCoords.sHeight;
    } else {
        const minDim = Math.min(video.videoWidth, video.videoHeight || 480);
        sx = (video.videoWidth - minDim) / 2; sy = (video.videoHeight - minDim) / 2;
        sWidth = minDim; sHeight = minDim;
    }

    ctx.save(); 
    ctx.translate(257, 0); 
    ctx.scale(-1, 1); 
    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, 257, 257); 
    ctx.restore();
    
    if (detector && video.readyState >= 2 && !isProcessingPose && Date.now() - lastAICheckTimestamp >= aiCheckInterval) { 
        isProcessingPose = true;
        lastAICheckTimestamp = Date.now();
        
        detector.estimatePoses(canvas).then(async (poses) => {
            if (poses && poses.length > 0) { 
                poses[0].keypoints.forEach(k => { 
                    if (latestKeypoints[k.name]) {
                        latestKeypoints[k.name].x = k.x; 
                        latestKeypoints[k.name].y = k.y; 
                        latestKeypoints[k.name].score = k.score; 
                    }
                }); 
                
                let cW = container.clientWidth; 
                let cH = container.clientHeight;
                renderDOMPoints(cW, cH);
            } 
            await checkRules(); 
            isProcessingPose = false; 
        }).catch(err => {
            console.error("AI estimation pipeline execution error:", err);
            isProcessingPose = false;
        });
    }
    
    scheduleNextFrame(currentFrameDelay);
}

function renderDOMPoints(cW, cH) {
    updatePointDOM(pts.lS, 'left_shoulder', cW, cH); 
    updatePointDOM(pts.rS, 'right_shoulder', cW, cH); 
    updatePointDOM(pts.lW, 'left_wrist', cW, cH); 
    updatePointDOM(pts.rW, 'right_wrist', cW, cH); 
    updatePointDOM(pts.lE, 'left_elbow', cW, cH); 
    updatePointDOM(pts.rE, 'right_elbow', cW, cH); 
    updatePointDOM(pts.lH, 'left_hip', cW, cH); 
    updatePointDOM(pts.rH, 'right_hip', cW, cH); 
    updatePointDOM(pts.lK, 'left_knee', cW, cH); 
    updatePointDOM(pts.rK, 'right_knee', cW, cH);
    
    if (f('left_heel')) updatePointDOM(pts.lF, 'left_heel', cW, cH); else updatePointDOM(pts.lF, 'left_foot_index', cW, cH);
    if (f('right_heel')) updatePointDOM(pts.rF, 'right_heel', cW, cH); else updatePointDOM(pts.rF, 'right_foot_index', cW, cH);

    if (f('left_ear') && f('right_ear')) { 
        const midX = (latestKeypoints.left_ear.x + latestKeypoints.right_ear.x) / 2;
        const midY = (latestKeypoints.left_ear.y + latestKeypoints.right_ear.y) / 2;
        pts.head.style.left = `${(midX / 257) * cW}px`; 
        pts.head.style.top = `${(midY / 257) * cH}px`; 
        pts.head.style.display = 'block'; 
    } else { 
        pts.head.style.display = 'none'; 
    }
}

function updatePointDOM(element, partName, containerWidth, containerHeight) {
    if (f(partName)) { 
        element.style.left = `${(latestKeypoints[partName].x / 257) * containerWidth}px`; 
        element.style.top = `${(latestKeypoints[partName].y / 257) * containerHeight}px`; 
        element.style.display = 'block'; 
    } else { 
        element.style.display = 'none'; 
    } 
}

function updateLoopPerformance(state) {
    if (state === 'SETUP' || state === 'GRACE_PERIOD') {
        currentFrameDelay = standardDelay;
        document.body.style.filter = "none";
    } 
    else if (state === 'STILLNESS') {
        currentFrameDelay = increasedDelay;
        if (isDisplayDim) {
            document.body.style.filter = "brightness(0.3)";
        } else {
            document.body.style.filter = "none";
        }
    }
}

function scheduleNextFrame(delay) {
    if (appEnded) return;

    setTimeout(() => {
        requestAnimationFrame(loop);
    }, delay);
}

// =========================================================================
// 7. POSTURE ANALYSIS & DRIFT ENFORCEMENT ENGINE
// =========================================================================

async function checkRules() {
    if (Date.now() - lastCheckpointTimestamp < 2000) return; 
    if (!detector || !isPrepared || appEnded) return;
    
    if (isAudioSpeakingBlock) {
        if (!isGracePeriodActive) {
            status.innerText = "Haltung verletzt! Bitte zuhören... ⏳";
            status.style.color = "#ffaa00"; 
            container.style.borderColor = "#ffaa00";
        }
        return; 
    }

    if (isGracePeriodActive) {
        if (Date.now() >= gracePeriodEndTime) {
            let check = validateHaltung();
            if (check.valid) { 
                const timeStamp = new Date().toLocaleTimeString('de-DE'); 
                logEvents.push(`[${timeStamp}] CHECKPOINT: Position erfolgreich wiederhergestellt.`); 
                setNewAnchor(phrases.checkpoint); 
            } else {
                let penalty = Math.floor(Math.random() * (maxP - minP + 1)) + minP; 
                timeRemainingSeconds += penalty; 
                totalPenaltiesCount++; 
                totalPenaltySecondsSum += penalty; 
                updateTimerUI();
                
                const timeStamp = new Date().toLocaleTimeString('de-DE'); 
                logEvents.push(`[${timeStamp}] ESKALATION: Haltung falsch (${check.msg}) -> FOLGE-STRAFE: +${penalty}s`);
                
                status.innerText = `${check.msg.toUpperCase()}! +${penalty}s! ⏳`; 
                status.style.color = "#ff3333"; 
                if(!isTimerHidden) timerDisplay.style.color = "#ff3333";
                
                isAudioSpeakingBlock = true;
                let utteranceText = phrases.escalation.replace("{msg}", check.msg).replace("{penalty}", penalty);
                speak(utteranceText, true, () => {
                    isAudioSpeakingBlock = false;
                    triggerVisualGracePeriod(); 
                });
            }
        }
        return;
    }

    let brokenJoint = ""; 
    let globalDriftDetected = false; 
    const allowedDeviation = 0.14 * baseShoulderWidth;

    for (const joint in anchorPose) { 
        if (f(joint)) { 
            const dist = Math.sqrt(Math.pow(latestKeypoints[joint].x - anchorPose[joint].x, 2) + Math.pow(latestKeypoints[joint].y - anchorPose[joint].y, 2)); 
            if (dist > allowedDeviation) { 
                globalDriftDetected = true; 
                brokenJoint = punktNamenDe[joint] || joint; 
                break; 
            } 
        } 
    }

    if (globalDriftDetected) {
        let check = validateHaltung();
        isAudioSpeakingBlock = true; 
        
        let penalty = Math.floor(Math.random() * (maxP - minP + 1)) + minP; 
        timeRemainingSeconds += penalty; 
        totalPenaltiesCount++; 
        totalPenaltySecondsSum += penalty; 
        updateTimerUI();
        
        const timeStamp = new Date().toLocaleTimeString('de-DE'); 
        logEvents.push(`[${timeStamp}] DRIFT: Bewegung erkannt bei [${brokenJoint}] -> SOFORT-STRAFE: +${penalty}s`);
        
        updateLoopPerformance('GRACE_PERIOD');
        
        let utteranceText = phrases.drift.replace("{joint}", brokenJoint).replace("{penalty}", penalty);
        speak(utteranceText, true, () => {
            isAudioSpeakingBlock = false; 
            triggerVisualGracePeriod(); 
        }); 
    }
}

function validateHaltung() {
    if (!f('left_shoulder') || !f('right_shoulder')) return { valid: false, msg: "Körper nicht im Bild" };
    const sb = Math.sqrt(Math.pow(latestKeypoints.left_shoulder.x - latestKeypoints.right_shoulder.x, 2) + Math.pow(latestKeypoints.left_shoulder.y - latestKeypoints.right_shoulder.y, 2));
    
    let headY = getHeadY();
    const shoulderY = (latestKeypoints.left_shoulder.y + latestKeypoints.right_shoulder.y) / 2;
    
    if (selPos === "STEHEND") {
        if (!f('left_hip') || !f('right_hip') || !hasAnyFoot('left') || !hasAnyFoot('right')) {
            if (headY === 0 || headY > shoulderY || (shoulderY - headY) < 0.3 * sb) return { valid: false, msg: "Bitte gerade stehen" };
        } else {
            const hipY = (latestKeypoints.left_hip.y + latestKeypoints.right_hip.y) / 2; 
            const footY = (getBestFootY('left') + getBestFootY('right')) / 2;
            if ((footY - hipY) <= 2.0 * sb) return { valid: false, msg: "Bitte Beine strecken" };
        }
    }
    if (selPos === "KNIEND_AUFRECHT") {
        if (!f('left_hip') || !f('right_hip') || !hasAnyFoot('left') || !hasAnyFoot('right')) return { valid: false, msg: "Unterkörper nicht sichtbar" };
        const hipY = (latestKeypoints.left_hip.y + latestKeypoints.right_hip.y) / 2; 
        const footY = (getBestFootY('left') + getBestFootY('right')) / 2;
        if ((footY - hipY) < 1.1 * sb || (footY - hipY) > 1.8 * sb) return { valid: false, msg: "Bitte aufrecht knien" };
    }
    if (selPos === "KNIEND_SITZEND") {
        if (!f('left_hip') || !f('right_hip') || !hasAnyFoot('left') || !hasAnyFoot('right')) return { valid: false, msg: "Unterkörper nicht sichtbar" };
        const hipY = (latestKeypoints.left_hip.y + latestKeypoints.right_hip.y) / 2; 
        const footY = (getBestFootY('left') + getBestFootY('right')) / 2;
        if ((footY - hipY) >= 0.7 * sb) return { valid: false, msg: "Bitte auf Fersen setzen" };
    }
    if (selPos === "KNIEND_VORGEBEUGT") {
        if (f('left_hip') && f('right_hip')) { 
            const hipY = (latestKeypoints.left_hip.y + latestKeypoints.right_hip.y) / 2; 
            if (shoulderY < hipY) return { valid: false, msg: "Bitte nach vorne beugen" }; 
        } else { 
            if (headY !== 0 && (shoulderY - headY) > 0.4 * sb) return { valid: false, msg: "Bitte tiefer beugen" }; 
        }
    }

    if (selLeg === "ZUSAMMEN") {
        let legDistance = 0, hasPoints = false; 
        if (f('left_knee') && f('right_knee')) { legDistance = Math.abs(latestKeypoints.left_knee.x - latestKeypoints.right_knee.x); hasPoints = true; } 
        else if (f('left_foot_index') && f('right_foot_index')) { legDistance = Math.abs(latestKeypoints.left_foot_index.x - latestKeypoints.right_foot_index.x); hasPoints = true; }
        if (hasPoints && legDistance > 0.85 * sb) return { valid: false, msg: "Bitte Beine schließen" };
    }
    if (selLeg === "GESPREIZT") {
        let legDistance = 0, hasPoints = false; 
        if (f('left_knee') && f('right_knee')) { legDistance = Math.abs(latestKeypoints.left_knee.x - latestKeypoints.right_knee.x); hasPoints = true; } 
        else if (f('left_foot_index') && f('right_foot_index')) { legDistance = Math.abs(latestKeypoints.left_foot_index.x - latestKeypoints.right_foot_index.x); hasPoints = true; }
        if (!hasPoints || legDistance < 1.25 * sb) return { valid: false, msg: "Bitte Beine spreizen" };
    }

    if (selArm === "UEBER_KOPF") {
        if (!f('left_wrist') || !f('right_wrist') || headY === 0) return { valid: false, msg: "Hände nicht sichtbar" }; 
        if (latestKeypoints.left_wrist.y > headY || latestKeypoints.right_wrist.y > headY) return { valid: false, msg: "Hände gerade über Kopf" };
    }
    if (selArm === "AUF_KOPF") {
        if (!f('left_wrist') || !f('right_wrist') || !f('left_elbow') || !f('right_elbow')) return { valid: false, msg: "Arme nicht sichtbar" }; 
        if (Math.abs(latestKeypoints.left_wrist.y - headY) > 0.3 * sb || Math.abs(latestKeypoints.right_wrist.y - headY) > 0.3 * sb) return { valid: false, msg: "Hände auf den Kopf legen" }; 
        if (Math.abs(latestKeypoints.left_elbow.x - latestKeypoints.right_elbow.x) < 1.35 * sb) return { valid: false, msg: "Ellbogen weiter nach außen" };
    }
    if (selArm === "HINTER_KOPF") {
        if (!f('left_elbow') || !f('right_elbow')) return { valid: false, msg: "Ellbogen nicht sichtbar" }; 
        if (Math.abs(latestKeypoints.left_elbow.x - latestKeypoints.right_elbow.x) < 1.45 * sb) return { valid: false, msg: "Ellbogen nach hinten drücken" };
    }
    if (selArm === "DREIZACK") {
        if (!f('left_elbow') || !f('right_elbow') || !f('left_wrist') || !f('right_wrist')) return { valid: false, msg: "Dreizack unvollständig" }; 
        if (Math.abs(latestKeypoints.left_elbow.y - shoulderY) > 0.3 * sb || Math.abs(latestKeypoints.right_elbow.y - shoulderY) > 0.3 * sb) return { valid: false, msg: "Ellbogen auf Schulterhöhe" }; 
        if (latestKeypoints.left_wrist.y > latestKeypoints.left_elbow.y || latestKeypoints.right_wrist.y > latestKeypoints.right_elbow.y) return { valid: false, msg: "Unterarme senkrecht nach oben" };
    }
    if (selArm === "RUECKEN_ELLBOGEN") {
        if (!f('left_elbow') || !f('right_elbow')) return { valid: false, msg: "Arme hinten verschränken" }; 
        if (Math.abs(latestKeypoints.left_elbow.x - latestKeypoints.right_elbow.x) > 0.95 * sb) return { valid: false, msg: "Gegenseitig Ellbogen greifen" };
    }
    if (selArm === "RUECKEN_PO") {
        if (!f('left_wrist') || !f('right_wrist') || !f('left_hip') || !f('right_hip')) return { valid: false, msg: "Hände hinten tief" }; 
        const hipY = (latestKeypoints.left_hip.y + latestKeypoints.right_hip.y) / 2; 
        if (Math.abs(latestKeypoints.left_wrist.y - hipY) > 0.4 * sb || Math.abs(latestKeypoints.right_wrist.y - hipY) > 0.4 * sb) return { valid: false, msg: "Hände flach auf Gesäß legen" };
    }
    
    return { valid: true, msg: "Überwachung aktiv! 🟢" };
}

function triggerVisualGracePeriod() {
    isGracePeriodActive = true;
    let localCounter = 3;
    gracePeriodEndTime = Date.now() + 3200; 
    
    status.innerText = `KORREKTURZEIT! Noch ${localCounter}s... ⏳`;
    status.style.color = "#ffaa00";
    container.style.borderColor = "#ffaa00";
    if(!isTimerHidden) timerDisplay.style.color = "#ffaa00";
    speak(localCounter.toString(), false);

    let graceTimer = setInterval(() => {
        localCounter--;
        if (localCounter > 0 && isGracePeriodActive) {
            status.innerText = `KORREKTURZEIT! Noch ${localCounter}s... ⏳`;
            speak(localCounter.toString(), false);
        } else {
            clearInterval(graceTimer);
        }
    }, 1000);
}

function setNewAnchor(audioMessage) {
    anchorPose = {};
    if (f('left_shoulder') && f('right_shoulder')) {
        baseShoulderWidth = Math.sqrt(Math.pow(latestKeypoints.left_shoulder.x - latestKeypoints.right_shoulder.x, 2) + Math.pow(latestKeypoints.left_shoulder.y - latestKeypoints.right_shoulder.y, 2));
    }
    const trackingList = ['left_shoulder', 'right_shoulder', 'left_ear', 'right_ear', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index'];
    trackingList.forEach(j => { if (f(j)) anchorPose[j] = { x: latestKeypoints[j].x, y: latestKeypoints[j].y }; });
    
    isPrepared = true; 
    isGracePeriodActive = false; 
    isAudioSpeakingBlock = false; 
    remainingSecondsCounter = 3; 
    lastCheckpointTimestamp = Date.now();
    
    status.innerText = "Überwachung aktiv! 🟢"; 
    status.style.color = "#00ffcc"; 
    timerDisplay.style.color = "#ffffff"; 
    container.style.borderColor = "#333333";
    
    updateLoopPerformance('STILLNESS');
    
    if (audioMessage) speak(audioMessage, true);
}

// =========================================================================
// 8. DATA EXPORT, PARSING & ROUTINE SHARING CONFIGURATIONS
// =========================================================================

async function generateRoutineString() {
    try {
        const secret = document.getElementById('secretSalt').value.trim();
        if (!secret) { alert("Bitte gib zuerst ein Passwort (Salt) ein!"); return; }

        const routineData = {
            selPos: document.getElementById('positionSelect').value, 
            selArm: document.getElementById('armSelect').value, 
            selLeg: document.getElementById('legSelect').value,
            minD: parseInt(document.getElementById('minDuration').value), 
            maxD: parseInt(document.getElementById('maxDuration').value), 
            capD: parseInt(document.getElementById('capDuration').value),
            minP: parseInt(document.getElementById('minPenalty').value), 
            maxP: parseInt(document.getElementById('maxPenalty').value), 
            isTimerHidden: document.getElementById('hideTimerCheckbox').checked,
            customStart: document.getElementById('customStartInput').value.trim(),
            customEncouragements: document.getElementById('customEncouragementInput').value.trim(),
            customEnd: document.getElementById('customEndInput').value.trim(),
            minE: parseInt(document.getElementById('minEncouragement').value), 
            maxE: parseInt(document.getElementById('maxEncouragement').value), 
            standardFPS: parseInt(document.getElementById('standardFPS').value) || 15,
            reducedFPS: parseInt(document.getElementById('reducedFPS').value) || 4,
            aicheckFPS: parseInt(document.getElementById('aicheckFPS').value) || 2,
            isDisplayDim: document.getElementById('dimDisplayCheckbox').checked,
            salt: document.getElementById('secretSalt').value
        };
            //pos: document.getElementById('positionSelect').value,
            //arm: document.getElementById('armSelect').value,
            //leg: document.getElementById('legSelect').value,
            //min: parseInt(document.getElementById('minDuration').value) || 30,
            //max: parseInt(document.getElementById('maxDuration').value) || 45,
            //cap: parseInt(document.getElementById('capDuration').value) || 120,
            //minP: parseInt(document.getElementById('minPenalty').value) || 5,
            //maxP: parseInt(document.getElementById('maxPenalty').value) || 10,
            //blind: document.getElementById('hideTimerCheckbox').checked,
            //cStart: document.getElementById('customStartInput').value.trim(),
            //cMotiv: document.getElementById('customEncouragementInput').value.trim(),
            //cEnd: document.getElementById('customEndInput').value.trim()
        //};

        const rawJson = JSON.stringify(routineData);

        const jsonBytes = new TextEncoder().encode(rawJson);
        const binaryString = String.fromCharCode(...jsonBytes);
        const base64Payload = btoa(binaryString);

        const signature = await generateHMAC(rawJson, secret);
        const sharePayload = base64Payload + "::" + signature;
        
        const textMessage = `Hier ist deine geheime Cornertime-Routine:\n\n${sharePayload}`;
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(textMessage)}`;
        
        const newWindow = window.open(whatsappUrl, '_blank');
        if (!newWindow) {
            await navigator.clipboard.writeText(textMessage);
            alert("Routine wurde in die Zwischenablage kopiert! (Popup-Blocker verhinderte WhatsApp)");
        }
    } catch(e) { alert("Fehler beim Erstellen der Routine: " + e.message); }
}

async function loadImportedRoutine(payload) {
    try {
        const parts = payload.split("::");
        if (parts.length !== 2) return false;
        
        const secret = document.getElementById('secretSalt').value.trim();
        if (!secret) { alert("Bitte gib das passende Passwort ein, um die Routine zu entschlüsseln!"); return false; }

        const binaryString = atob(parts[0]);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const decodedJson = new TextDecoder().decode(bytes);
        
        const computedSig = await generateHMAC(decodedJson, secret);
        if (computedSig !== parts[1]) { 
            alert("Ungültige Signatur! Falsches Passwort oder manipulierte Routine."); 
            return false; 
        }
        
        const routine = JSON.parse(decodedJson);
        
        //const binaryString = atob(parts[0]);
        //const bytes = new Uint8Array(binaryString.length);
        //for (let i = 0; i < binaryString.length; i++) {
        //    bytes[i] = binaryString.charCodeAt(i);
        //}
        //const decodedJson = new TextDecoder().decode(bytes);
        //const computedSig = await generateHMAC(decodedJson, secret);
        
        //if (computedSig !== parts[1]) { alert("Ungültige Signatur! Falsches Passwort oder manipulierte Routine."); return false; }
        
        //const routine = JSON.parse(decodedJson);
        
        selPos = routine.selPos; selArm = routine.selArm; selLeg = routine.selLeg;
        minD = routine.minD; maxD = routine.maxD; capD = routine.capD;
        minP = routine.minP || 5; maxP = routine.maxP || 10;
        isTimerHidden = routine.isTimerHidden || false;
        customStart = routine.customStart; customEncouragements = routine.customEncouragements; customEnd = routine.customEnd;
        minE = routine.minE; maxE = routine.maxE;
        standardFPS = routine.standardFPS; reducedFPS = routine.reducedFPS; aicheckFPS = routine.aicheckFPS;
        isDisplayDim = routine.isDisplayDim;
        salt = routine.salt;

        document.getElementById('positionSelect').value = selPos; 
        document.getElementById('armSelect').value = selArm; 
        document.getElementById('legSelect').value = selLeg;
        document.getElementById('minDuration').value = minD; 
        document.getElementById('maxDuration').value = maxD; 
        document.getElementById('capDuration').value = capD;
        document.getElementById('minPenalty').value = minP; 
        document.getElementById('maxPenalty').value = maxP; 
        document.getElementById('hideTimerCheckbox').checked = isTimerHidden;
        document.getElementById('customStartInput').value = customStart;
        document.getElementById('customEncouragementInput').value = customEncouragements;
        document.getElementById('customEndInput').value = customEnd;
        document.getElementById('minEncouragement').value = minE; 
        document.getElementById('maxEncouragement').value = maxE; 
        document.getElementById('standardFPS').value = standardFPS;
        document.getElementById('reducedFPS').value = reducedFPS;
        document.getElementById('aicheckFPS').value = aicheckFPS;
        document.getElementById('dimDisplayCheckbox').checked = isDisplayDim;
        document.getElementById('secretSalt').value = salt;

        //document.getElementById('positionSelect').value = selPos;
        //document.getElementById('armSelect').value = selArm;
        //document.getElementById('legSelect').value = selLeg;
        //document.getElementById('minDuration').value = minD;
        //document.getElementById('maxDuration').value = maxD;
        //document.getElementById('capDuration').value = capD;
        //document.getElementById('minPenalty').value = minP;
        //document.getElementById('maxPenalty').value = maxP;
        //document.getElementById('hideTimerCheckbox').checked = isTimerHidden;
        
        //document.getElementById('customStartInput').value = routine.cStart || "";
        //document.getElementById('customEncouragementInput').value = routine.cMotiv || "";
        //document.getElementById('customEndInput').value = routine.cEnd || "";

        if (routine.cStart && routine.cStart.trim() !== "") phrases.start = routine.cStart;
        if (routine.cEnd && routine.cEnd.trim() !== "") phrases.success = routine.cEnd;
        if (routine.cMotiv && routine.cMotiv.trim() !== "") {
            encouragementPhrases = routine.cMotiv.split(';').map(s => s.trim()).filter(s => s !== "");
        }

        return true;
    } catch(e) { 
        console.error(e); 
        alert("Import-Fehler: Ungültiges Format oder beschädigte Symbole!");
        return false; 
    }
}

// =========================================================================
// 9. METRICS CRYPTOGRAPHIC VERIFICATION & DATA SIGNING
// =========================================================================

/**
 * Generates a SHA-256 HMAC signature for a given string using a shared secret key.
 */
async function generateHMAC(text, secret) {
    const encoder = new TextEncoder(); 
    const keyData = encoder.encode(secret); 
    const msgData = encoder.encode(text);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function endWorkout(endReason) {
    appEnded = true; 
    clearInterval(workoutInterval); 
    isPrepared = false; 
    if (wakeLock !== null) { wakeLock.release(); wakeLock = null; }

    document.body.style.filter = "none";
    
    const endTimestamp = Date.now(); 
    const endTimeStr = new Date(endTimestamp).toLocaleString('de-DE');
    let statusText = endReason === "SUCCESS" ? "Erfolgreich beendet (Uhr auf 0)" : "MAXIMAL-DAUER ERREICHT (Deckel gegriffen)";
    let realEffectiveSeconds = Math.round((endTimestamp - realStartTimestamp) / 1000);

    let logText = `=== CORNERTIME WÄCHTER REPORT ===\n`; 
    logText += `Position: ${selPos}\nArmhaltung: ${selArm}\nBeinhaltung: ${selLeg}\n\n`;
    logText += `GEPLANTE DAUER: ${formatTime(initialTargetDuration)} (Bereich: ${minD}-${maxD}s)\n`; 
    logText += `MAXIMAL-DECKEL: ${formatTime(capD)}s\n`;
    logText += `START-ZEIT:     ${startTimeStr}\n`; 
    logText += `END-ZEIT:       ${endTimeStr}\n`; 
    logText += `EFFEKTIVE TRAININGSZEIT: ${formatTime(realEffectiveSeconds)}\n\n`;
    logText += `--- EREIGNISSE ---\n`; 
    if(logEvents.length === 0) { logText += `Keine Vorfälle. Perfekt gehalten!\n`; } else { logEvents.forEach(e => logText += e + `\n`); }
    logText += `\nSTATUS AM ENDE: ${statusText}\n`; 
    logText += `Gesamtzahl Strafen: ${totalPenaltiesCount}\n`; 
    logText += `Gesamte Strafzeit:  +${totalPenaltySecondsSum} Sekunden\n`; 
    logText += `=================================\n`;
    
    const hash = await generateHMAC(logText, salt); 
    logText += `SIGNATUR: ${hash}\n`;
    
    document.getElementById('activeScreen').style.display = 'none'; 
    document.getElementById('logScreen').style.display = 'block'; 
    document.getElementById('logOutput').value = logText;
    document.getElementById('logOutputShare').style.display = 'block'; 
    
    if(endReason === "SUCCESS") { 
        speak(phrases.success, true); 
        
        if (llamaLabEndpoint && llamaLabEndpoint.trim() !== "") {
            fetch(llamaLabEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: "SUCCESS", signature: hash })
            }).catch(err => console.error("LlamaLab Webhook communication failure:", err));
        }
    } else { 
        speak(phrases.capReached, true); 
    }
}

function showVerificationOption() { 
    document.getElementById('setupScreen').style.display = 'none'; 
    document.getElementById('logScreen').style.display = 'block'; 
    document.getElementById('logTitle').innerText = "Logfile verifizieren"; 
    document.getElementById('logOutput').value = ""; 
    document.getElementById('logOutput').readOnly = false; 
    document.getElementById('logOutput').placeholder = "Füge hier das Logfile deines Buddies ein..."; 
    document.getElementById('buddyVerifyBox').style.display = 'block'; 
}

async function verifyPastedLog() {
    const rawInput = document.getElementById('logOutput').value; 
    const saltCheck = document.getElementById('secretSalt').value; 
    const badge = document.getElementById('verifyBadge'); 
    badge.style.display = "block";
    try {
        const lines = rawInput.split('\n'); 
        let sigLineIndex = lines.findIndex(l => l.startsWith('SIGNATUR: ')); 
        if(sigLineIndex === -1) { badge.className = "verification-badge badge-error"; badge.innerText = "❌ UNGÜLTIG: Keine Signatur gefunden!"; return; }
        const providedSignature = lines[sigLineIndex].replace('SIGNATUR: ', '').trim(); 
        let textToVerify = lines.slice(0, sigLineIndex).join('\n') + '\n'; 
        const computedSignature = await generateHMAC(textToVerify, saltCheck);
        if(providedSignature === computedSignature) { badge.className = "verification-badge badge-success"; badge.innerText = "✅ AUTHENTISCH: Logfile ist zu 100% echt und unmanipuliert!"; } else { badge.className = "verification-badge badge-error"; badge.innerText = "❌ MANIPULIERT: Text oder Einstellungen wurden nachträglich verändert!"; }
    } catch (err) { badge.className = "verification-badge badge-error"; badge.innerText = "❌ FEHLER: Logfile-Format fehlerhaft!"; }
}

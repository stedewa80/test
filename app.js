// --- DOM Elements ---
const video = document.getElementById('webcam'), canvas = document.getElementById('processingCanvas'), ctx = canvas.getContext('2d');
const container = document.getElementById('camContainer'), status = document.getElementById('status'), timerDisplay = document.getElementById('timerDisplay');

const pts = { 
    head: document.getElementById('ptHead'), lS: document.getElementById('ptLShoulder'), rS: document.getElementById('ptRShoulder'), 
    lW: document.getElementById('ptLWrist'), rW: document.getElementById('ptRWrist'), lE: document.getElementById('ptLElbow'), 
    rE: document.getElementById('ptRElbow'), lH: document.getElementById('ptLHip'), rH: document.getElementById('ptRHip'),
    lK: document.getElementById('ptLKnee'), rK: document.getElementById('ptRKnee'), lF: document.getElementById('ptLFoot'), rF: document.getElementById('ptRFoot')
};

// --- App Configurations & State Management ---
let selPos = "", selArm = "", selLeg = "";
let minD = 30, maxD = 45, capD = 120, minP = 5, maxP = 10, salt = "";
let detector = null, anchorPose = {}, isPrepared = false, latestKeypoints = {}, baseShoulderWidth = 100, wakeLock = null;
let timeRemainingSeconds = 30, totalTimeElapsed = 0, workoutInterval = null;

// Grace Periods, Timers, and Audio Blocks
let isGracePeriodActive = false, gracePeriodEndTime = 0, remainingSecondsCounter = 3, appEnded = false;
let isAudioSpeakingBlock = false, activeUtterance = null;

// Feature Flags & Customizations
let isTimerHidden = false;
let llamaLabEndpoint = ""; 
let nextEncouragementTimestamp = 0;
let minEncouragementInterval = 20, maxEncouragementInterval = 40;

// Customizable Phrases
let phrases = {
    start: "In Position gehen",
    drift: "Bewegung erkannt bei {joint}. Plus {penalty} Sekunden. Haltung korrigieren.",
    escalation: "{msg}. Strafe plus {penalty} Sekunden.",
    checkpoint: "Position erfolgreich wiederhergestellt.",
    success: "Training beendet. Ausgezeichnet.",
    capReached: "Maximalzeit erreicht. Abbruch."
};
let encouragementPhrases = ["Halt durch!", "Sehr gute Haltung!", "Bleib genau so.", "Rücken gerade lassen, perfekt!"];

// Tracking Metadata & Optimization
let logEvents = [];
let startTimeStr = "", initialTargetDuration = 0, totalPenaltiesCount = 0, totalPenaltySecondsSum = 0;
let realStartTimestamp = 0, lastCheckpointTimestamp = 0, lastAICheckTimestamp = 0;

const punktNamenDe = {
    'left_shoulder': 'Linke Schulter', 'right_shoulder': 'Rechte Schulter', 'left_elbow': 'Linker Ellbogen', 'right_elbow': 'Rechter Ellbogen',
    'left_wrist': 'Linkes Handgelenk', 'right_wrist': 'Rechtes Handgelenk', 'left_hip': 'Linke Hüfte', 'right_hip': 'Rechte Hüfte',
    'left_knee': 'Linkes Knie', 'right_knee': 'Rechtes Knie', 'left_heel': 'Linke Ferse', 'right_heel': 'Rechte Ferse',
    'left_foot_index': 'Linke Fußspitze', 'right_foot_index': 'Rechte Fußspitze', 'left_ear': 'Kopf', 'right_ear': 'Kopf'
};

// --- Custom Component Utilities ---
function speak(text, force = false, callbackOnEnd = null) {
    try {
        if (force) { window.speechSynthesis.cancel(); }
        if (!force && window.speechSynthesis.speaking) { if (callbackOnEnd) callbackOnEnd(); return; }
        activeUtterance = new SpeechSynthesisUtterance(text); 
        activeUtterance.lang = 'de-DE'; 
        activeUtterance.rate = 1.15; 
        activeUtterance.onend = () => { activeUtterance = null; if (callbackOnEnd) callbackOnEnd(); };
        activeUtterance.onerror = () => { activeUtterance = null; if (callbackOnEnd) callbackOnEnd(); };
        window.speechSynthesis.speak(activeUtterance);
    } catch (e) { console.error("Audio-Fehler", e); activeUtterance = null; if (callbackOnEnd) callbackOnEnd(); }
}

function formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0'); 
    const secs = (totalSeconds % 60).toString().padStart(2, '0'); 
    return `${mins}:${secs}`;
}

function updateTimerUI() { 
    timerDisplay.innerText = isTimerHidden ? "••:••" : formatTime(timeRemainingSeconds); 
}

function f(part) { return latestKeypoints[part] && latestKeypoints[part].score > 0.4; }

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

function updatePointDOM(element, partName, containerWidth, containerHeight) {
    if (f(partName)) { 
        element.style.left = `${(latestKeypoints[partName].x / 257) * containerWidth}px`; 
        element.style.top = `${(latestKeypoints[partName].y / 257) * containerHeight}px`; 
        element.style.display = 'block'; 
    } else { 
        element.style.display = 'none'; 
    } 
}

async function generateHMAC(text, secret) {
    const encoder = new TextEncoder(); 
    const keyData = encoder.encode(secret); 
    const msgData = encoder.encode(text);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- WhatsApp Routine Share Engines (Feature II) ---
async function generateRoutineString() {
    try {
        // 1. Verify that all elements actually exist in your HTML
        const elPos = document.getElementById('positionSelect');
        const elArm = document.getElementById('armSelect');
        const elLeg = document.getElementById('legSelect');
        const elMin = document.getElementById('minDuration');
        const elMax = document.getElementById('maxDuration');
        const elCap = document.getElementById('capDuration');
        const elSalt = document.getElementById('secretSalt');

        // Validation check to tell you exactly what is missing in the HTML layout
        if (!elPos || !elArm || !elLeg || !elMin || !elMax || !elCap || !elSalt) {
            let missing = [];
            if (!elPos) missing.push('positionSelect');
            if (!elArm) missing.push('armSelect');
            if (!elLeg) missing.push('legSelect');
            if (!elMin) missing.push('minDuration');
            if (!elMax) missing.push('maxDuration');
            if (!elCap) missing.push('capDuration');
            if (!elSalt) missing.push('secretSalt');
            
            alert(`HTML Fehler: Folgende IDs fehlen in deinem Setup-Screen: ${missing.join(', ')}`);
            return;
        }

        const secret = elSalt.value.trim();
        if (!secret) {
            alert("Bitte gib zuerst einen geheimen Schlüssel (Salt) ein, damit die Routine signiert werden kann!");
            return;
        }

        // 2. Build the payload cleanly
        const routineData = {
            pos: elPos.value,
            arm: elArm.value,
            leg: elLeg.value,
            min: parseInt(elMin.value) || 30,
            max: parseInt(elMax.value) || 45,
            cap: parseInt(elCap.value) || 120
        };

        const rawJson = JSON.stringify(routineData);
        const signature = await generateHMAC(rawJson, secret);
        
        // Base64 encoding that safely handles special characters
        const base64Payload = btoa(encodeURIComponent(rawJson).replace(/%([0-9A-F]{2})/g, (match, p1) => {
            return String.fromCharCode(parseInt(p1, 16));
        }));
        
        const sharePayload = base64Payload + "::" + signature;
        const textMessage = `Hier ist deine geheime Cornertime-Routine:\n\n${sharePayload}`;

        // 3. Try to open WhatsApp
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(textMessage)}`;
        const newWindow = window.open(whatsappUrl, '_blank');
        
        // Fallback: If a mobile browser or adblocker blocks the window popup, copy it to clipboard instead
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
            await navigator.clipboard.writeText(textMessage);
            alert("WhatsApp konnte nicht automatisch geöffnet werden (Popup-Blocker). Die Routine wurde stattdessen in deine Zwischenablage kopiert! Du kannst sie jetzt einfach manuell in WhatsApp einfügen (Strg+V / Gedrückt halten).");
        }

    } catch (error) {
        console.error("Fehler beim Erstellen der Routine:", error);
        alert(`Ein unerwarteter Fehler ist aufgetreten: ${error.message}`);
    }
}

async function loadImportedRoutine(payload) {
    try {
        const parts = payload.split("::");
        if(parts.length !== 2) return false;
        const secret = document.getElementById('secretSalt').value;
        const decodedJson = decodeURIComponent(escape(atob(parts[0])));
        const computedSig = await generateHMAC(decodedJson, secret);
        
        if (computedSig !== parts[1]) { alert("Routine-Signatur ungültig! Falsches Passwort?"); return false; }
        
        const routine = JSON.parse(decodedJson);
        selPos = routine.pos; selArm = routine.arm; selLeg = routine.leg;
        minD = routine.min; maxD = routine.max; capD = routine.cap;
        return true;
    } catch(e) { console.error(e); return false; }
}

// --- Posture Core Validation Rules ---
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

// --- App Entry & Setup Flow ---
async function startApp() {
    salt = document.getElementById('secretSalt').value;
    isTimerHidden = document.getElementById('hideTimerCheckbox').checked;
    llamaLabEndpoint = document.getElementById('llamaEndpointInput').value;

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
    }
    
    minP = parseInt(document.getElementById('minPenalty').value); 
    maxP = parseInt(document.getElementById('maxPenalty').value); 

    document.getElementById('setupScreen').style.display = 'none'; 
    document.getElementById('activeScreen').style.display = 'block';
    
    timeRemainingSeconds = Math.floor(Math.random() * (maxD - minD + 1)) + minD; 
    initialTargetDuration = timeRemainingSeconds; 
    updateTimerUI();
    
    try {
        status.innerText = "Kamera-Zugriff anfordern...";
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } }); 
        video.srcObject = stream;
        
        video.onloadedmetadata = async () => {
    // Force the video element to wait until it is rendering real video dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        video.addEventListener('loadeddata', () => startAppModelInitialization());
    } else {
        startAppModelInitialization();
    }
};

async function startAppModelInitialization() {
    try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (err) { }
    
    status.innerText = "Lade MediaPipe-Modell...";
    detector = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, { 
        runtime: 'mediapipe', 
        modelType: 'lite', 
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/' // Added trailing slash here
    });
    
    let setupCountdown = 5;
    status.innerText = `In Position gehen! (${setupCountdown}s)`; 
    status.style.color = "#ffaa00"; 
    speak(phrases.start, true); 
    loop();
    
    let startTimer = setInterval(() => {
        setupCountdown--;
        if (setupCountdown > 0) {
            status.innerText = `In Position gehen! (${setupCountdown}s)`;
        } else {
            clearInterval(startTimer);
            let result = validateHaltung(); 
            if (result.valid) { initWorkout(); } 
            else {
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
}

function initWorkout() {
    realStartTimestamp = Date.now(); 
    startTimeStr = new Date(realStartTimestamp).toLocaleString('de-DE');
    nextEncouragementTimestamp = Date.now() + (Math.floor(Math.random() * (maxEncouragementInterval - minEncouragementInterval + 1)) + minEncouragementInterval) * 1000;
    setNewAnchor("Wächter aktiv");
    
    workoutInterval = setInterval(() => {
        if (isPrepared && !appEnded) {
            totalTimeElapsed++;
            if (!isGracePeriodActive && !isAudioSpeakingBlock) { 
                timeRemainingSeconds--; 
                updateTimerUI(); 
            }
            
            // Feature V: Pure Encouragement Engine Integration
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
    if (audioMessage) speak(audioMessage, true);
}

// --- High Performance Camera Processing & Zoom Rendering Loop ---
async function loop() {
    if (appEnded) return; 
    canvas.width = 257; 
    canvas.height = 257;
    
    let sx = 0, sy = 0, sWidth = video.videoWidth, sHeight = video.videoHeight;

    // Feature I: Smart Body Bounding-Box Zoom Engine Calculation
    if (isPrepared && Object.keys(latestKeypoints).length > 0) {
        let minX = 257, maxX = 0, minY = 257, maxY = 0, validPoints = 0;
        for (let kp in latestKeypoints) {
            if (latestKeypoints[kp].score > 0.4) {
                let kpX = latestKeypoints[kp].x; let kpY = latestKeypoints[kp].y;
                if(kpX < minX) minX = kpX; if(kpX > maxX) maxX = kpX;
                if(kpY < minY) minY = kpY; if(kpY > maxY) maxY = kpY;
                validPoints++;
            }
        }
        if (validPoints > 4) {
            let boxW = (maxX - minX); let boxH = (maxY - minY);
            let cx = minX + boxW/2; let cy = minY + boxH/2;
            let size = Math.max(boxW, boxH) * 1.35; // Add a clean 35% margin boundary buffer
            
            // Standardize video frame scale parameters
            let normSize = size / 257;
            let videoMinDim = Math.min(video.videoWidth, video.videoHeight);
            sWidth = Math.min(videoMinDim, videoMinDim * normSize);
            sHeight = sWidth;
            sx = Math.max(0, Math.min(video.videoWidth - sWidth, (cx / 257) * video.videoWidth - sWidth / 2));
            sy = Math.max(0, Math.min(video.videoHeight - sHeight, (cy / 257) * video.videoHeight - sHeight / 2));
        }
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
    
    // Technical Refinement II: Run AI Estimations at a Fixed 500ms Interval (Saves Battery)
    if (detector && video.readyState >= 2 && Date.now() - lastAICheckTimestamp >= 500) { 
        lastAICheckTimestamp = Date.now();
        const poses = await detector.estimatePoses(canvas); 
        if (poses && poses.length > 0) { 
            poses[0].keypoints.forEach(k => { latestKeypoints[k.name] = { x: k.x, y: k.y, score: k.score }; }); 
        } 
        await checkRules(); // Sync rule execution exactly with the updated AI tracking frame
    }
    
    let cW = container.clientWidth; let cH = container.clientHeight;
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
        pts.head.style.left = `${(((latestKeypoints.left_ear.x + latestKeypoints.right_ear.x)/2) / 257) * cW}px`; 
        pts.head.style.top = `${(((latestKeypoints.left_ear.y + latestKeypoints.right_ear.y)/2) / 257) * cH}px`; 
        pts.head.style.display = 'block'; 
    } else { 
        pts.head.style.display = 'none'; 
    }
    
    requestAnimationFrame(loop);
}

// --- Evaluator State Engine ---
async function checkRules() {
    if (Date.now() - lastCheckpointTimestamp < 2000) return; 
    if (!detector || !isPrepared || appEnded) return;
    
    if (isAudioSpeakingBlock) {
        status.innerText = "Haltung verletzt! Bitte zuhören... ⏳";
        status.style.color = "#ffaa00"; 
        container.style.borderColor = "#ffaa00";
        return; 
    }

    if (isGracePeriodActive) {
        let timeLeft = Math.ceil((gracePeriodEndTime - Date.now()) / 1000);

        if (timeLeft > 0) {
            status.innerText = `KORREKTURZEIT! Noch ${timeLeft}s... ⏳`; 
            status.style.color = "#ffaa00"; 
            if(!isTimerHidden) timerDisplay.style.color = "#ffaa00"; 
            container.style.borderColor = "#ffaa00";
            
            if (remainingSecondsCounter !== timeLeft) {
                remainingSecondsCounter = timeLeft;
                isAudioSpeakingBlock = true;
                speak(timeLeft.toString(), false, () => { isAudioSpeakingBlock = false; });
            }
        } else {
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
                logEvents.push(`[${timeStamp}] ESKALATION: Haltung falsch (${check.msg}) -> FOLGE-STRAFE: +${penalty}s (Uhr auf ${formatTime(timeRemainingSeconds)})`);
                
                status.innerText = `${check.msg.toUpperCase()}! +${penalty}s! ⏳`; 
                status.style.color = "#ff3333"; 
                if(!isTimerHidden) timerDisplay.style.color = "#ff3333";
                
                isAudioSpeakingBlock = true;
                // Feature V: Custom Phrase Rendering via template strings
                let utteranceText = phrases.escalation.replace("{msg}", check.msg).replace("{penalty}", penalty);
                speak(utteranceText, true, () => {
                    isAudioSpeakingBlock = false;
                    remainingSecondsCounter = 3; 
                    gracePeriodEndTime = Date.now() + 3000;
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
        isGracePeriodActive = true; 
        isAudioSpeakingBlock = true; 
        remainingSecondsCounter = 3;
        gracePeriodEndTime = Date.now() + 3000;
        
        let penalty = Math.floor(Math.random() * (maxP - minP + 1)) + minP; 
        timeRemainingSeconds += penalty; 
        totalPenaltiesCount++; 
        totalPenaltySecondsSum += penalty; 
        updateTimerUI();
        
        const timeStamp = new Date().toLocaleTimeString('de-DE'); 
        logEvents.push(`[${timeStamp}] DRIFT: Bewegung erkannt bei [${brokenJoint}] -> SOFORT-STRAFE: +${penalty}s (Uhr auf ${formatTime(timeRemainingSeconds)})`);
        
        // Feature V: Custom Phrase Rendering via template strings
        let utteranceText = phrases.drift.replace("{joint}", brokenJoint).replace("{penalty}", penalty);
        speak(utteranceText, true, () => {
            isAudioSpeakingBlock = false; 
            gracePeriodEndTime = Date.now() + 3000; 
        }); 
    }
}

// --- Completion and Termination Handling ---
async function endWorkout(endReason) {
    appEnded = true; 
    clearInterval(workoutInterval); 
    isPrepared = false; 
    if (wakeLock !== null) { wakeLock.release(); wakeLock = null; }
    
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
    
    if(endReason === "SUCCESS") { 
        speak(phrases.success, true); 
        
        // Feature IV: Automated LlamaLab Flow Trigger Integration via Webhook
        if (llamaLabEndpoint.trim() !== "") {
            fetch(llamaLabEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: "SUCCESS", signature: hash, user: "Buddy" })
            }).catch(err => console.error("LlamaLab Webhook communication failed:", err));
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

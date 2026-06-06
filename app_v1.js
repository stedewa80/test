const video = document.getElementById('webcam'), canvas = document.getElementById('processingCanvas'), ctx = canvas.getContext('2d');
const container = document.getElementById('camContainer'), status = document.getElementById('status'), timerDisplay = document.getElementById('timerDisplay');

const pts = { 
    head: document.getElementById('ptHead'), lS: document.getElementById('ptLShoulder'), rS: document.getElementById('ptRShoulder'), 
    lW: document.getElementById('ptLWrist'), rW: document.getElementById('ptRWrist'), lE: document.getElementById('ptLElbow'), 
    rE: document.getElementById('ptRElbow'), lH: document.getElementById('ptLHip'), rH: document.getElementById('ptRHip'),
    lK: document.getElementById('ptLKnee'), rK: document.getElementById('ptRKnee'), lF: document.getElementById('ptLFoot'), rF: document.getElementById('ptRFoot')
};

const punktNamenDe = {
    'left_shoulder': 'Linke Schulter', 'right_shoulder': 'Rechte Schulter',
    'left_elbow': 'Linker Ellbogen', 'right_elbow': 'Rechter Ellbogen',
    'left_wrist': 'Linkes Handgelenk', 'right_wrist': 'Rechtes Handgelenk',
    'left_hip': 'Linke Hüfte', 'right_hip': 'Rechte Hüfte',
    'left_knee': 'Linkes Knie', 'right_knee': 'Rechtes Knie',
    'left_heel': 'Linke Ferse', 'right_heel': 'Rechte Ferse',
    'left_foot_index': 'Linke Fußspitze', 'right_foot_index': 'Rechte Fußspitze',
    'left_ear': 'Kopf', 'right_ear': 'Kopf'
};

let selPos = "", selArm = "", selLeg = "";
let minD = 30, maxD = 45, capD = 120, minP = 5, maxP = 10, salt = "";
let detector = null, anchorPose = {}, isPrepared = false, latestKeypoints = {}, baseShoulderWidth = 100, wakeLock = null;
let timeRemainingSeconds = 30, totalTimeElapsed = 0, workoutInterval = null, ruleCheckInterval = null;
let isGracePeriodActive = false, remainingSecondsCounter = 3, appEnded = false;
let isAudioSpeakingBlock = false;

let logEvents = [];
let startTimeStr = "", initialTargetDuration = 0, totalPenaltiesCount = 0, totalPenaltySecondsSum = 0;
let realStartTimestamp = 0, lastCheckpointTimestamp = 0;

function speak(text, force = false, callbackOnEnd = null) {
    try {
        if (force) { window.speechSynthesis.cancel(); }
        const utterance = new SpeechSynthesisUtterance(text); 
        utterance.lang = 'de-DE'; 
        utterance.rate = 1.15; 
        if (callbackOnEnd) {
            utterance.onend = () => { callbackOnEnd(); };
        }
        window.speechSynthesis.speak(utterance);
    } catch (e) { 
        console.log("Audio-Fehler", e);
        if (callbackOnEnd) callbackOnEnd(); 
    }
}

function formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0'); 
    const secs = (totalSeconds % 60).toString().padStart(2, '0'); 
    return `${mins}:${secs}`;
}

function updateTimerUI() { timerDisplay.innerText = formatTime(timeRemainingSeconds); }

function f(part) { return latestKeypoints[part] && latestKeypoints[part].score > 0.4; }

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

async function generateHMAC(text, secret) {
    const encoder = new TextEncoder(); 
    const keyData = encoder.encode(secret); 
    const msgData = encoder.encode(text);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function validateHaltung() {
    if (!f('left_shoulder') || !f('right_shoulder')) return { valid: false, msg: "Körper nicht im Bild" };
    const sb = Math.sqrt(Math.pow(latestKeypoints.left_shoulder.x - latestKeypoints.right_shoulder.x, 2) + Math.pow(latestKeypoints.left_shoulder.y - latestKeypoints.right_shoulder.y, 2));
    
    let headY = 0;
    if (f('left_ear') && f('right_ear')) { headY = (latestKeypoints.left_ear.y + latestKeypoints.right_ear.y) / 2; } 
    else if (f('left_eye') && f('right_eye')) { headY = (latestKeypoints.left_eye.y + latestKeypoints.right_eye.y) / 2; }
    
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

async function startApp() {
    selPos = document.getElementById('positionSelect').value; 
    selArm = document.getElementById('armSelect').value; 
    selLeg = document.getElementById('legSelect').value;
    minD = parseInt(document.getElementById('minDuration').value); 
    maxD = parseInt(document.getElementById('maxDuration').value); 
    capD = parseInt(document.getElementById('capDuration').value);
    minP = parseInt(document.getElementById('minPenalty').value); 
    maxP = parseInt(document.getElementById('maxPenalty').value); 
    salt = document.getElementById('secretSalt').value;

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
            try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (err) { }
            status.innerText = "Lade MediaPipe-Modell...";
            detector = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, { 
                runtime: 'mediapipe', 
                modelType: 'lite', 
                solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404' 
            });
            
            status.innerText = "In Position gehen! (5s)"; 
            status.style.color = "#ffaa00"; 
            speak("In Position gehen", true); 
            loop();
            
            setTimeout(() => {
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
            }, 5000);
        };
    } catch(e) { status.innerText = "Kamerafehler!"; status.style.color = "red"; console.error(e); }
}

function initWorkout() {
    realStartTimestamp = Date.now(); 
    startTimeStr = new Date(realStartTimestamp).toLocaleString('de-DE');
    setNewAnchor("Wächter aktiv");
    
    workoutInterval = setInterval(() => {
        if (isPrepared && !appEnded) {
            totalTimeElapsed++;
            if (!isGracePeriodActive && !isAudioSpeakingBlock) { timeRemainingSeconds--; updateTimerUI(); }
            if (totalTimeElapsed >= capD || timeRemainingSeconds <= 0) { 
                endWorkout(totalTimeElapsed >= capD ? "CAP_REACHED" : "SUCCESS"); 
            }
        }
    }, 1000);
    ruleCheckInterval = setInterval(checkRules, 1000);
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

async function loop() {
    if (appEnded) return; 
    canvas.width = 257; 
    canvas.height = 257;
    
    const minDim = Math.min(video.videoWidth, video.videoHeight || 480);
    ctx.save(); 
    ctx.translate(257, 0); 
    ctx.scale(-1, 1); 
    ctx.drawImage(video, (video.videoWidth - minDim) / 2, (video.videoHeight - minDim) / 2, minDim, minDim, 0, 0, 257, 257); 
    ctx.restore();
    
    if (detector && video.readyState >= 2) { 
        const poses = await detector.estimatePoses(canvas); 
        if (poses && poses.length > 0) { 
            poses[0].keypoints.forEach(k => { latestKeypoints[k.name] = { x: k.x, y: k.y, score: k.score }; }); 
        } 
    }
    
    const drawPoint = (el, part) => { 
        if (f(part)) { 
            el.style.left = `${(latestKeypoints[part].x / 257) * container.clientWidth}px`; 
            el.style.top = `${(latestKeypoints[part].y / 257) * container.clientHeight}px`; 
            el.style.display = 'block'; 
        } else { 
            el.style.display = 'none'; 
        } 
    };
    
    drawPoint(pts.lS, 'left_shoulder'); 
    drawPoint(pts.rS, 'right_shoulder'); 
    drawPoint(pts.lW, 'left_wrist'); 
    drawPoint(pts.rW, 'right_wrist'); 
    drawPoint(pts.lE, 'left_elbow'); 
    drawPoint(pts.rE, 'right_elbow'); 
    drawPoint(pts.lH, 'left_hip'); 
    drawPoint(pts.rH, 'right_hip'); 
    drawPoint(pts.lK, 'left_knee'); 
    drawPoint(pts.rK, 'right_knee');
    
    if (f('left_heel')) drawPoint(pts.lF, 'left_heel'); else drawPoint(pts.lF, 'left_foot_index');
    if (f('right_heel')) drawPoint(pts.rF, 'right_heel'); else drawPoint(pts.rF, 'right_foot_index');

    if (f('left_ear') && f('right_ear')) { 
        pts.head.style.left = `${(((latestKeypoints.left_ear.x + latestKeypoints.right_ear.x)/2) / 257) * container.clientWidth}px`; 
        pts.head.style.top = `${(((latestKeypoints.left_ear.y + latestKeypoints.right_ear.y)/2) / 257) * container.clientHeight}px`; 
        pts.head.style.display = 'block'; 
    } else { 
        pts.head.style.display = 'none'; 
    }
    
    requestAnimationFrame(loop);
}

async function checkRules() {
    if (Date.now() - lastCheckpointTimestamp < 2000) return; 
    if (!detector || !isPrepared || appEnded) return;
    
    if (isGracePeriodActive) {
        if (isAudioSpeakingBlock) {
            status.innerText = "Haltung verletzt! Bitte zuhören... ⏳";
            status.style.color = "#ffaa00"; 
            container.style.borderColor = "#ffaa00";
            return; 
        }

        if (remainingSecondsCounter > 0) {
            status.innerText = `KORREKTURZEIT! Noch ${remainingSecondsCounter}s... ⏳`; 
            status.style.color = "#ffaa00"; 
            timerDisplay.style.color = "#ffaa00"; 
            container.style.borderColor = "#ffaa00";
            
            isAudioSpeakingBlock = true;
            speak(remainingSecondsCounter.toString(), false, () => { 
                isAudioSpeakingBlock = false; 
                remainingSecondsCounter--; 
            });
        } else {
            let check = validateHaltung();
            if (check.valid) { 
                const timeStamp = new Date().toLocaleTimeString('de-DE'); 
                logEvents.push(`[${timeStamp}] CHECKPOINT: Position erfolgreich wiederhergestellt.`); 
                setNewAnchor("Checkpoint"); 
            } else {
                let penalty = Math.floor(Math.random() * (maxP - minP + 1)) + minP; 
                timeRemainingSeconds += penalty; 
                totalPenaltiesCount++; 
                totalPenaltySecondsSum += penalty; 
                updateTimerUI();
                
                const timeStamp = new Date().toLocaleTimeString('de-DE'); 
                logEvents.push(`[${timeStamp}] ESKALATION: Haltung falsch (${check.msg}) -> FOLGE-STRAFE: +${penalty}s (Uhr auf ${formatTime(timeRemainingSeconds)})`);
                
                isAudioSpeakingBlock = true;
                status.innerText = `${check.msg.toUpperCase()}! +${penalty}s! ⏳`; 
                status.style.color = "#ff3333"; 
                timerDisplay.style.color = "#ff3333";
                
                speak(`${check.msg}. Strafe plus ${penalty} Sekunden.`, true, () => {
                    isAudioSpeakingBlock = false;
                    remainingSecondsCounter = 3; 
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
        
        let penalty = Math.floor(Math.random() * (maxP - minP + 1)) + minP; 
        timeRemainingSeconds += penalty; 
        totalPenaltiesCount++; 
        totalPenaltySecondsSum += penalty; 
        updateTimerUI();
        
        const timeStamp = new Date().toLocaleTimeString('de-DE'); 
        logEvents.push(`[${timeStamp}] DRIFT: Bewegung erkannt bei [${brokenJoint}] -> SOFORT-STRAFE: +${penalty}s (Uhr auf ${formatTime(timeRemainingSeconds)})`);
        
        speak(`Bewegung erkannt. ${brokenJoint}. Plus ${penalty} Sekunden. Haltung korrigieren.`, true, () => {
            isAudioSpeakingBlock = false; 
        }); 
    }
}

async function endWorkout(endReason) {
    appEnded = true; 
    clearInterval(workoutInterval); 
    clearInterval(ruleCheckInterval); 
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
    
    if(endReason === "SUCCESS") { speak("Training beendet. Ausgezeichnet.", true); } else { speak("Maximalzeit erreicht. Abbruch.", true); }
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

// --- Start cornertime app ---
async function startApp() {

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
        phrases.start = `In Position gehen für deine Routine. Ausgangsposition: ${announcePos}. Armhaltung: ${announceArm}. Beinhaltung: Beine ${announceLeg}.`;
    }
    
    // --- Define custom encouragement phrases ---
    if (customEncouragements !== "") {
        encouragementPhrases = customEncouragements.split(';').map(s => s.trim()).filter(s => s !== "");
    }
  
    // --- Define custom end phrase ---
    if (customEnd !== "") {
        phrases.success = customEnd;
    }

    // --- Update screen visibility ---
    document.getElementById('setupScreen').style.display = 'none'; 
    document.getElementById('activeScreen').style.display = 'block';
    timerDisplay.innerText = "••:••";
  
    // --- Calculate initial duration ---
    timeRemainingSeconds = Math.floor(Math.random() * (maxD - minD + 1)) + minD; 
    initialTargetDuration = timeRemainingSeconds;

    // --- Calculate frame rates and delays ---
    standardDelay = Math.round(1000 / standardFPS);
    increasedDelay = Math.round(1000 / reducedFPS);
    aiCheckInterval = Math.round(1000 / aicheckFPS);
    currentFrameDelay = standardDelay;
    //updateTimerUI();

    // --- Initialize camera ---
    initCamera();

    // --- Initialze model
    initModel();

    // Update screen display
    status.innerText = "Bereite Routine vor... ⏳"; 
    status.style.color = "#ffaa00"; 

    // Speak start phrase
    speak(phrases.start, true, () => {
    });

    // Initialize countdown
    initCountdown(true);
}

// --- Initialize camera ---
async function initCamera() {
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
        // Error message
        status.innerText = "Kamerafehler! " + e.message; 
        status.style.color = "red"; 
        console.error(e); 
    }
}

// --- Initialize model---
async function initModel() {

    // Set screen wake lock
    try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (err) { }

    // Update screen display
    status.innerText = "Lade MediaPipe-Modell...";
    status.style.color = "#ffaa00";

    // Load MediaPipe model
    detector = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, { 
        runtime: 'mediapipe', modelType: 'lite', solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/' 
    });

    // Start loop function
    updateLoopPerformance('setup');
    loop();
}

// --- Initialize model and start countdown ---
async function initCountdown(isSetup = true) {
        
        let localclCountdown;
        const = innerText;
    
        if (!isSetup){
            isGracePeriodActive = true;
            gracePeriodEndTime = Date.now() + 3200; 
            localCountdown = 3;
            innerText = `KORREKTURZEIT! `;
            status.style.color = "#ffaa00";
            container.style.borderColor = "#ffaa00";
            if(!isTimerHidden) timerDisplay.style.color = "#ffaa00";
        } else {
            // Wait for user to take their position
            localCountdown = 5;
            innerText = `In Position gehen! `;
        }

        status.innerText = innerText + `Noch ${localCountdown}s... ⏳`;
        speak(localCountdown.toString(), false);

        // Start countdown
        let startTimer = setInterval(() => {
            
            // Update countdown
            localCountdown--;
            if (localCountdown > 0) {
                status.innerText = innerText + `Noch ${localCountdown}s... ⏳`;
                speak(localCountdown.toString(), false);
            } else {
                clearInterval(startTimer);

                if (!isSetup){
                    // Check posture and start workout
                    let result = validatePosture(); 
                    if (result.valid) { 
                        initWorkout(); 
                    
                    } else {
                        // Update screen display
                        status.innerText = result.msg; 
                        status.style.color = "#ff3333"; 
                        speak(result.msg, true);

                        // Check posture and start workout
                        let checkPosture = setInterval(() => {
                        let check = validatePosture(); 
                        if (check.valid) { initWorkout(); clearInterval(checkPosture); } 
                        else { status.innerText = check.msg; }
                        }, 1000);
                    }
                }
            }
        }, 1000);
    });

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

function initWorkout() {
    
    // Set start time
    realStartTimestamp = Date.now(); 
    startTimeStr = new Date(realStartTimestamp).toLocaleString('de-DE');
    nextEncouragementTimestamp = Date.now() + (Math.floor(Math.random() * (maxEncouragementInterval - minEncouragementInterval + 1)) + minEncouragementInterval) * 1000;
    
    if (Object.keys(latestKeypoints).length > 0) {

        // Find bounding box for keypoints 
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

        // Zoom and center on the user
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

        // Set current keypoints as anchor points
        setNewAnchor("Wächter aktiv");
        //lastCheckpointTimestamp = Date.now() + 3000; 

        // Check status of workout
        workoutInterval = setInterval(() => {

            // Only ...
            if (isPrepared && !appEnded) {
                totalTimeElapsed++;

                // Only ...
                if (!isGracePeriodActive && !isAudioSpeakingBlock) { 
                    timeRemainingSeconds--; 
                    updateTimerUI(); 
                }

                // Speak random encouragement phrase
                if (!isGracePeriodActive && !isAudioSpeakingBlock && Date.now() >= nextEncouragementTimestamp) {
                    let randomPhrase = encouragementPhrases[Math.floor(Math.random() * encouragementPhrases.length)];
                    speak(randomPhrase, false);
                    nextEncouragementTimestamp = Date.now() + (Math.floor(Math.random() * (maxEncouragementInterval - minEncouragementInterval + 1)) + minEncouragementInterval) * 1000;
                }

                // End workout if time is over or cap is reached
                if (totalTimeElapsed >= capD || timeRemainingSeconds <= 0) { 
                    endWorkout(totalTimeElapsed >= capD ? "CAP_REACHED" : "SUCCESS"); 
                }
            }
        }, 1000);
    }, 1500); 
}

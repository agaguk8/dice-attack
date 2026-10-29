import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, get, update, remove, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
    databaseURL: "https://dice-attack-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let currentRoom = null;
let playerName = null;
let isListenerActive = false;

let turnStep = 1; 

function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('game-screen').classList.remove('active');
    
    if(screenId === 'game-screen') {
        document.getElementById('game-screen').classList.add('active');
    } else {
        document.getElementById(screenId).classList.add('active');
    }
}

window.joinLobby = async function() {
    playerName = document.getElementById('player-name').value.trim();
    currentRoom = document.getElementById('room-code').value.trim();

    if (!playerName || !currentRoom) {
        alert("Veuillez entrer un nom et un code de salon.");
        return;
    }

    const roomRef = ref(db, 'rooms/' + currentRoom);
    const snapshot = await get(roomRef);

    if (snapshot.exists()) {
        const data = snapshot.val();
        const now = Date.now();
        const lastActivity = data.lastActivity || now;
        if ((now - lastActivity > 5 * 60 * 1000) || data.status === 'gameover') {
            await remove(roomRef);
        }
    }

    const snapCheck = await get(roomRef);

    const initialEnemies = {};
    for(let i=1; i<=6; i++) {
        initialEnemies[i] = { pos: 6, hp: i };
    }

    const initialGates = {};
    for(let i=1; i<=6; i++) {
        initialGates[i] = i; 
    }

    const initialTurrets = { '5_6': 1, '4_5': 1, '3_4': 1, '2_3': 1, '1_2': 1 };

    if (!snapCheck.exists()) {
        await set(roomRef, {
            status: 'waiting',
            creator: playerName,
            turnCount: 1,
            lastActivity: Date.now(),
            players: {
                [playerName]: {
                    gates: initialGates,
                    turrets: initialTurrets,
                    enemies: initialEnemies,
                    lastHits: {},
                    lastUpgradedTurret: null
                }
            },
            logs: [`Le chevalier ${playerName} a ouvert la salle d'attente.`]
        });
    } else {
        let data = snapCheck.val();
        if(data.status === 'playing') {
            alert("Cette partie a déjà commencé !");
            return;
        }
        let players = data.players || {};
        if (!players[playerName]) {
            players[playerName] = {
                gates: initialGates,
                turrets: initialTurrets,
                enemies: initialEnemies,
                lastHits: {},
                lastUpgradedTurret: null
            };
            await update(ref(db, `rooms/${currentRoom}/players`), players);
        }
    }

    switchScreen('waiting-room');
    document.getElementById('waiting-room-code').innerText = currentRoom;

    if(!isListenerActive) {
        listenToRoom();
        isListenerActive = true;
    }
};

window.startGame = async function() {
    const roomRef = ref(db, 'rooms/' + currentRoom);
    const snapshot = await get(roomRef);
    if(!snapshot.exists()) return;
    let roomData = snapshot.val();
    let players = roomData.players || {};

    let playerNames = Object.keys(players);
    if(playerNames.length < 2) {
        const robotName = "Robot_Arthur";
        const robotEnemies = {};
        const robotGates = {};
        const robotTurrets = { '5_6': 1, '4_5': 1, '3_4': 1, '2_3': 1, '1_2': 1 };
        for(let i=1; i<=6; i++) {
            robotEnemies[i] = { pos: 6, hp: i };
            robotGates[i] = i;
        }
        players[robotName] = {
            gates: robotGates,
            turrets: robotTurrets,
            enemies: robotEnemies,
            lastHits: {},
            lastUpgradedTurret: null
        };
        let logs = roomData.logs || [];
        logs.unshift(`Le Robot automatique s'est joint à la table !`);
        await update(ref(db, `rooms/${currentRoom}`), { players, logs, lastActivity: Date.now() });
        playerNames.push(robotName);
    }

    await update(roomRef, {
        status: 'playing',
        activePlayer: playerNames[0],
        lastActivity: Date.now()
    });
};

window.leaveGame = function() {
    location.reload();
};

function initTurretsUI() {
    const turretsContainer = document.getElementById('turrets-container');
    turretsContainer.innerHTML = '';
    const turretPairs = ['5_6', '4_5', '3_4', '2_3', '1_2'];
    
    turretPairs.forEach(t => {
        const labelName = t.replace('_', '/');
        turretsContainer.innerHTML += `
            <div class="turret-card" id="turret-card-${t}">
                <div style="font-size: 0.8rem; font-weight: bold; color: var(--gold);">Tourelle ${labelName}</div>
                <div style="font-size: 1.1rem; margin: 3px 0;" id="turret-val-${t}">1</div>
                <div class="action-buttons">
                    <button class="btn" id="btn-up-${t}" onclick="upgradeTurret('${t}')">Améliorer</button>
                    <button class="btn" id="btn-fire-${t}" onclick="fireTurret('${t}')" disabled>Tirer</button>
                </div>
            </div>
        `;
    });
}

function areAllTurretsMax(myTurrets) {
    if (!myTurrets) return false;
    const turretPairs = ['5_6', '4_5', '3_4', '2_3', '1_2'];
    return turretPairs.every(t => (myTurrets[t] || 1) >= 6);
}

window.upgradeTurret = async function(turretKey) {
    const roomRef = ref(db, `rooms/${currentRoom}`);
    const snap = await get(roomRef);
    if(!snap.exists()) return;
    const data = snap.val();

    if(data.activePlayer !== playerName) {
        alert("Ce n'est pas votre tour de jouer !");
        return;
    }

    let players = data.players || {};
    let myData = players[playerName];
    if(!myData || !myData.turrets) return;

    if (areAllTurretsMax(myData.turrets)) {
        turnStep = 2;
        updateTurnUI(data.activePlayer, myData.turrets);
        alert("Toutes vos tourelles sont au niveau maximum ! Passez directement au tir.");
        return;
    }

    if(turnStep !== 1) {
        alert("Vous avez déjà effectué votre amélioration ce tour-ci ! Passez au tir.");
        return;
    }

    let val = myData.turrets[turretKey] || 1;
    if(val >= 6) {
        alert("Cette tourelle est déjà au niveau maximum (6) !");
        return;
    }

    val += 1;
    myData.turrets[turretKey] = val;
    myData.lastUpgradedTurret = turretKey;

    let logs = data.logs || [];
    logs.unshift(`${playerName} a renforcé sa tourelle ${turretKey.replace('_', '/')} (Force: ${val}).`);

    await update(roomRef, {
        players: players,
        lastActivity: Date.now(),
        logs: logs.slice(0, 20)
    });

    turnStep = 2;
    updateTurnUI(data.activePlayer, myData.turrets);
};

window.fireTurret = async function(turretKey) {
    const roomRef = ref(db, `rooms/${currentRoom}`);
    const snap = await get(roomRef);
    if(!snap.exists()) return;
    const data = snap.val();

    if(data.activePlayer !== playerName) {
        alert("Ce n'est pas votre tour de tirer !");
        return;
    }

    if(turnStep !== 2) {
        alert("Vous devez d'abord passer l'étape d'amélioration !");
        return;
    }

    let players = data.players || {};
    let myData = players[playerName];
    if(!myData || !myData.turrets) return;

    const force = myData.turrets[turretKey] || 1;
    
    const parts = turretKey.split('_');
    const p1 = parseInt(parts[0], 10);
    const p2 = parseInt(parts[1], 10);

    let rolls = [];
    for(let i=0; i<force; i++) {
        rolls.push(Math.floor(Math.random() * 6) + 1);
    }

    let hits = {};
    [p1, p2].forEach(col => {
        rolls.forEach(res => {
            const key = `${col}-${res}`;
            hits[key] = (hits[key] || 0) + 1;
        });
    });
    myData.lastHits = hits;

    if(myData && myData.enemies) {
        [p1, p2].forEach(col => {
            rolls.forEach(res => {
                let enemy = myData.enemies[col];
                if(enemy && enemy.pos === res) {
                    enemy.hp -= 1;
                    if(enemy.hp <= 0 || col === 1) {
                        enemy.pos = 6;
                        enemy.hp = col;
                    }
                }
            });
        });
    }

    let logs = data.logs || [];
    logs.unshift(`${playerName} a tiré avec sa tourelle ${turretKey.replace('_', '/')} (Force: ${force}) -> Dés [${rolls.join(', ')} sur les colonnes ${p1} et ${p2}].`);
    
    await update(roomRef, { 
        players: players,
        lastActivity: Date.now(),
        logs: logs.slice(0, 20) 
    });

    turnStep = 3;
    updateTurnUI(data.activePlayer, myData.turrets);
};

window.finishTurn = async function() {
    const roomRef = ref(db, `rooms/${currentRoom}`);
    const snap = await get(roomRef);
    if(!snap.exists()) return;
    const data = snap.val();

    if(data.activePlayer !== playerName || turnStep !== 3) {
        alert("Veuillez d'abord compléter le tir !");
        return;
    }

    let players = data.players || {};
    let myData = players[playerName];

    let isMyTurretsAllMax = areAllTurretsMax(myData.turrets);

    if (!myData.maxTurnsCount) {
        myData.maxTurnsCount = 0;
    }

    let attackDiceCount = 2;
    if (isMyTurretsAllMax) {
        myData.maxTurnsCount += 1;
        attackDiceCount = 2 + myData.maxTurnsCount;
    }

    let attackRolls = [];
    for(let i=0; i<attackDiceCount; i++) {
        attackRolls.push(Math.floor(Math.random() * 6) + 1);
    }

    document.getElementById('dice-result').innerText = `Dés d'attaque (${attackDiceCount}) : [${attackRolls.join(', ')}]`;

    let gameOver = false;
    let loserName = null;

    for(let pName in players) {
        players[pName].lastHits = {};
    }

    for(let pName in players) {
        if(pName === playerName) continue; 

        let pData = players[pName];
        let enemies = pData.enemies;
        let gates = pData.gates;

        attackRolls.forEach(pathNum => {
            if(enemies[pathNum]) {
                if(enemies[pathNum].pos > 1) {
                    enemies[pathNum].pos -= 1;
                } else {
                    if(gates[pathNum] > 0) {
                        gates[pathNum] -= 1;
                    } else {
                        gameOver = true;
                        loserName = pName;
                    }
                }
            }
        });
    }

    let logs = data.logs || [];

    if(gameOver) {
        logs.unshift(`🚨 ALERTE ROUGE ! La porte du chevalier ${loserName} a été franchie par un monstre ! ${loserName} a perdu la partie. Victoire des autres chevaliers !`);
        await update(roomRef, {
            status: 'gameover',
            loser: loserName,
            players: players,
            lastActivity: Date.now(),
            logs: logs.slice(0, 20)
        });

        setTimeout(async () => {
            await remove(roomRef);
        }, 30000);
        return;
    }

    let playerNames = Object.keys(players);
    let currentIndex = playerNames.indexOf(playerName);
    let nextIndex = (currentIndex + 1) % playerNames.length;
    let nextPlayer = playerNames[nextIndex];

    logs.unshift(`${playerName} a terminé son tour. Attaque ennemie [${attackRolls.join(', ')}] (${attackDiceCount} dés) chez les adversaires. Tour de ${nextPlayer}.`);

    turnStep = 1;

    let nextPlayerData = players[nextPlayer];
    if (nextPlayerData && areAllTurretsMax(nextPlayerData.turrets)) {
        turnStep = 2;
    }

    await update(roomRef, {
        activePlayer: nextPlayer,
        turnCount: (data.turnCount || 1) + 1,
        players: players,
        lastActivity: Date.now(),
        logs: logs.slice(0, 20)
    });

    if(nextPlayer.startsWith("Robot_")) {
        setTimeout(playRobotTurn, 1500);
    }
};

async function playRobotTurn() {
    const roomRef = ref(db, `rooms/${currentRoom}`);
    const snap = await get(roomRef);
    if(!snap.exists()) return;
    let data = snap.val();
    let robotName = data.activePlayer;
    if(!robotName || !robotName.startsWith("Robot_")) return;

    let players = data.players || {};
    let robotData = players[robotName];
    if(!robotData) return;

    // 1. ÉTAPE D'AMÉLIORATION DU ROBOT
    let turretPairs = ['5_6', '4_5', '3_4', '2_3', '1_2'];
    // On cherche les tourelles du robot qui ne sont pas encore au max (6)
    let availableTurrets = turretPairs.filter(t => (robotData.turrets[t] || 1) < 6);

    let upgradedTurretKey = null;
    if (availableTurrets.length > 0) {
        // Le robot choisit l'une d'entre elles au hasard (ou la première)
        let randomTurret = availableTurrets[Math.floor(Math.random() * availableTurrets.length)];
        robotData.turrets[randomTurret] = (robotData.turrets[randomTurret] || 1) + 1;
        robotData.lastUpgradedTurret = randomTurret;
        upgradedTurretKey = randomTurret;
    }

    // 2. ÉTAPE DE TIR DE DÉFENSE DU ROBOT
    // S'il lui reste des tourelles à améliorer, il tire avec celle qu'il vient d'améliorer, sinon il prend une tourelle au hasard
    let firingTurretKey = upgradedTurretKey || turretPairs[Math.floor(Math.random() * turretPairs.length)];
    let robotTurretForce = robotData.turrets[firingTurretKey] || 1;

    let robotRolls = [];
    for(let i=0; i<robotTurretForce; i++) {
        robotRolls.push(Math.floor(Math.random() * 6) + 1);
    }

    let parts = firingTurretKey.split('_');
    let p1 = parseInt(parts[0], 10);
    let p2 = parseInt(parts[1], 10);

    let robotHits = {};
    [p1, p2].forEach(col => {
        robotRolls.forEach(res => {
            const key = `${col}-${res}`;
            robotHits[key] = (robotHits[key] || 0) + 1;
        });
    });
    robotData.lastHits = robotHits;

    // Application des dégâts du robot sur ses propres monstres
    if(robotData.enemies) {
        [p1, p2].forEach(col => {
            robotRolls.forEach(res => {
                let enemy = robotData.enemies[col];
                if(enemy && enemy.pos === res) {
                    enemy.hp -= 1;
                    if(enemy.hp <= 0 || col === 1) {
                        enemy.pos = 6;
                        enemy.hp = col;
                    }
                }
            });
        });
    }

    // 3. ÉTAPE D'ATTAQUE ENNEMIE DU ROBOT SUR LES AUTRES JOUEURS
    let isRobotAllMax = areAllTurretsMax(robotData.turrets);
    if (!robotData.maxTurnsCount) {
        robotData.maxTurnsCount = 0;
    }

    let attackDiceCount = 2;
    if (isRobotAllMax) {
        robotData.maxTurnsCount += 1;
        attackDiceCount = 2 + robotData.maxTurnsCount;
    }

    let attackRolls = [];
    for(let i=0; i<attackDiceCount; i++) {
        attackRolls.push(Math.floor(Math.random() * 6) + 1);
    }

    let gameOver = false;
    let loserName = null;

    // Réinitialisation des impacts des autres joueurs
    for(let pName in players) {
        if(pName !== robotName) {
            players[pName].lastHits = {};
        }
    }

    for(let pName in players) {
        if(pName === robotName) continue;
        let pData = players[pName];
        let enemies = pData.enemies;
        let gates = pData.gates;

        attackRolls.forEach(pathNum => {
            if(enemies[pathNum]) {
                if(enemies[pathNum].pos > 1) {
                    enemies[pathNum].pos -= 1;
                } else {
                    if(gates[pathNum] > 0) {
                        gates[pathNum] -= 1;
                    } else {
                        gameOver = true;
                        loserName = pName;
                    }
                }
            }
        });
    }

    let logs = data.logs || [];

    if(gameOver) {
        logs.unshift(`🚨 Le Robot ${robotName} a provoqué la chute de la porte de ${loserName}. ${loserName} a perdu !`);
        await update(roomRef, {
            status: 'gameover',
            loser: loserName,
            players: players,
            lastActivity: Date.now(),
            logs: logs.slice(0, 20)
        });

        setTimeout(async () => {
            await remove(roomRef);
        }, 30000);
        return;
    }

    // Passage au joueur suivant
    let playerNames = Object.keys(players);
    let currentIndex = playerNames.indexOf(robotName);
    let nextIndex = (currentIndex + 1) % playerNames.length;
    let nextPlayer = playerNames[nextIndex];

    let upgradeLogMsg = upgradedTurretKey ? `a amélioré sa tourelle ${upgradedTurretKey.replace('_', '/')} et ` : ``;
    logs.unshift(`🤖 Le Robot ${robotName} ${upgradeLogMsg}a tiré avec ${firingTurretKey.replace('_', '/')} (Force ${robotTurretForce}). Attaque ennemie [${attackRolls.join(', ')}] (${attackDiceCount} dés). Tour de ${nextPlayer}.`);

    turnStep = 1;
    let nextPlayerData = players[nextPlayer];
    if (nextPlayerData && areAllTurretsMax(nextPlayerData.turrets)) {
        turnStep = 2;
    }

    await update(roomRef, {
        activePlayer: nextPlayer,
        turnCount: (data.turnCount || 1) + 1,
        players: players,
        lastActivity: Date.now(),
        logs: logs.slice(0, 20)
    });

    // Si le joueur suivant est aussi un robot, on relance sa boucle après un court délai
    if(nextPlayer.startsWith("Robot_")) {
        setTimeout(playRobotTurn, 1500);
    }
}

function listenToRoom() {
    const roomRef = ref(db, 'rooms/' + currentRoom);
    onValue(roomRef, (snapshot) => {
        if(!snapshot.exists()) {
            alert("Le salon a été réinitialisé ou vidé (inactivité ou fin de partie).");
            location.reload();
            return;
        }
        const roomData = snapshot.val();

        if ((roomData.lastActivity && (Date.now() - roomData.lastActivity > 5 * 60 * 1000)) || roomData.status === 'gameover') {
            if (roomData.status !== 'gameover') {
                remove(roomRef);
                alert("Le salon a été vidé en raison d'une inactivité de plus de 5 minutes.");
                location.reload();
                return;
            }
        }

        if(roomData.status === 'playing' || roomData.status === 'gameover') {
            switchScreen('game-screen');
            document.getElementById('display-room').innerText = currentRoom;
            document.getElementById('display-player').innerText = playerName;
            if(!document.getElementById('turrets-container').hasChildNodes()) {
                initTurretsUI();
            }
            processGameData(roomData);
        } else {
            const playerList = document.getElementById('player-list');
            playerList.innerHTML = '';
            if(roomData.players) {
                for(let p in roomData.players) {
                    playerList.innerHTML += `<li>🛡️ Chevalier ${p} ${p === roomData.creator ? '(Hôte)' : ''}</li>`;
                }
            }
        }
    });
}

function processGameData(roomData) {
    if(roomData.players && roomData.players[playerName] && roomData.players[playerName].turrets) {
        const myTurrets = roomData.players[playerName].turrets;
        const lastUpgraded = roomData.players[playerName].lastUpgradedTurret;

        for(let [tKey, val] of Object.entries(myTurrets)) {
            const el = document.getElementById(`turret-val-${tKey}`);
            if(el) el.innerText = val;

            const cardEl = document.getElementById(`turret-card-${tKey}`);
            if(cardEl) {
                if(lastUpgraded === tKey) {
                    cardEl.classList.add('just-upgraded');
                } else {
                    cardEl.classList.remove('just-upgraded');
                }
            }
        }
    }

    if(roomData.status === 'gameover') {
        const banner = document.getElementById('turn-banner');
        banner.innerHTML = `💀 FIN DE PARTIE - Le chevalier <strong>${roomData.loser}</strong> a perdu ! Le salon se videra dans quelques secondes...`;
        banner.style.borderColor = "#ef4444";
        document.getElementById('btn-finish-turn').disabled = true;
    } else {
        updateTurnUI(roomData.activePlayer, roomData.players?.[playerName]?.turrets);
    }

    if(roomData.players) {
        renderBoards(roomData.players);
    }
    if(roomData.logs) {
        const logsContainer = document.getElementById('game-logs');
        logsContainer.innerHTML = roomData.logs.map(l => `<div>• ${l}</div>`).join('');
    }
}

function updateTurnUI(activePlayer, myTurrets) {
    const banner = document.getElementById('turn-banner');
    const instructions = document.getElementById('turn-instructions');
    const btnFinish = document.getElementById('btn-finish-turn');
    const isMyTurn = (activePlayer === playerName);

    const allMax = areAllTurretsMax(myTurrets);

    if (isMyTurn && allMax && turnStep === 1) {
        turnStep = 2;
    }

    const turretPairs = ['5_6', '4_5', '3_4', '2_3', '1_2'];

    turretPairs.forEach(t => {
        const btnUp = document.getElementById(`btn-up-${t}`);
        const btnFire = document.getElementById(`btn-fire-${t}`);

        if(isMyTurn) {
            const currentVal = myTurrets ? (myTurrets[t] || 1) : 1;

            if(turnStep === 1) {
                if(currentVal >= 6) {
                    btnUp.disabled = true;
                    btnUp.innerText = "MAX (6)";
                } else {
                    btnUp.disabled = false;
                    btnUp.innerText = "Améliorer";
                }
                btnFire.disabled = true;
            } else if(turnStep === 2) {
                btnUp.disabled = true;
                btnFire.disabled = false;
            } else {
                btnUp.disabled = true;
                btnFire.disabled = true;
            }
        } else {
            btnUp.disabled = true;
            btnFire.disabled = true;
        }
    });

    if(isMyTurn) {
        if(turnStep === 1) {
            banner.innerHTML = `⚔️ C'EST À VOUS ! Étape 1 : Améliorez une tourelle.`;
            instructions.innerText = `Étape 1 : Cliquez sur "Améliorer" de votre choix.`;
            btnFinish.disabled = true;
        } else if(turnStep === 2) {
            if (allMax) {
                banner.innerHTML = `🔥 TOUTES TOURELLES MAX ! Tirez avec vos tourelles à niveau 6 max !`;
                instructions.innerText = `Toutes tourelles au max : cliquez sur "Tirer" pour lancer vos défenses.`;
            } else {
                banner.innerHTML = `⚔️ C'EST À VOUS ! Étape 2 : Tirez avec une tourelle.`;
                instructions.innerText = `Étape 2 : Cliquez sur "Tirer" pour vous défendre.`;
            }
            btnFinish.disabled = true;
        } else {
            banner.innerHTML = `⚔️ Défense effectuée ! Vous pouvez terminer votre tour.`;
            instructions.innerText = `Étape 3 : Cliquez ci-dessous pour lancer l'attaque ennemie.`;
            btnFinish.disabled = false;
        }
        banner.style.borderColor = "var(--gold)";
    } else {
        banner.innerHTML = `⏳ Tour de <strong>${activePlayer}</strong>`;
        banner.style.borderColor = "#475569";
        instructions.innerText = `En attente du joueur actif...`;
        btnFinish.disabled = true;
    }
}

function renderBoards(players) {
    const container = document.getElementById('all-players-boards');
    container.innerHTML = '';

    let playerNames = Object.keys(players);
    playerNames.sort((a, b) => {
        if (a === playerName) return -1;
        if (b === playerName) return 1;
        return 0;
    });

    playerNames.forEach(pName => {
        const pData = players[pName];
        const isMe = (pName === playerName);
        const pTurrets = pData.turrets || { '5_6': 1, '4_5': 1, '3_4': 1, '2_3': 1, '1_2': 1 };
        const lastUpgraded = pData.lastUpgradedTurret;

        let turretsMiniHTML = `<div class="board-turrets-mini">`;
        const turretPairs = ['5_6', '4_5', '3_4', '2_3', '1_2'];
        turretPairs.forEach(t => {
            const val = pTurrets[t] || 1;
            const isRecentlyUpgraded = (lastUpgraded === t);
            turretsMiniHTML += `
                <div class="mini-turret ${isRecentlyUpgraded ? 'upgraded' : ''}">
                    <div style="font-size:0.6rem; color:#94a3b8;">${t.replace('_', '/')}</div>
                    <div style="font-weight:bold; font-size:0.9rem;">${val}</div>
                </div>
            `;
        });
        turretsMiniHTML += `</div>`;

        let boardHTML = `
            <div class="player-board-wrapper ${isMe ? 'is-me' : ''}">
                <div class="player-title">
                    <span>Chevalier : ${pName} ${isMe ? '(Votre Plateau)' : '(Adversaire)'}</span>
                </div>
                ${turretsMiniHTML}
                <div class="battlefield-container">
        `;

        for (let path = 6; path >= 1; path--) {
            const gatePv = pData.gates?.[path] !== undefined ? pData.gates[path] : path;
            let gateClass = '';
            let gateText = `Porte ${path}<br><span style="color:${gatePv === 0 ? '#ef4444' : (gatePv < path ? '#f9a825' : 'var(--gold)')}; font-weight:bold;">${gatePv} PV</span>`;
            
            if(gatePv === 0) {
                gateClass = 'broken';
            } else if(gatePv < path) {
                gateClass = 'damaged';
            }

            boardHTML += `
                <div class="path-column path-${path}">
                    <div class="gate ${gateClass}" id="gate-${pName}-${path}">${gateText}</div>
                    <div class="cells-container">
            `;

            for(let c = 6; c >= 1; c--) {
                let enemyTokenHTML = '';
                if(pData.enemies && pData.enemies[path] && pData.enemies[path].pos === c) {
                    const enemy = pData.enemies[path];
                    enemyTokenHTML = `<div class="enemy-token" title="PV: ${enemy.hp}">👹<span>${enemy.hp}pv</span></div>`;
                }

                let hitClass = '';
                let badgeHTML = '';
                const hitKey = `${path}-${c}`;
                if(pData.lastHits && pData.lastHits[hitKey]) {
                    hitClass = 'hit-active';
                    if(pData.lastHits[hitKey] > 1) {
                        badgeHTML = `<div class="hit-badge">X${pData.lastHits[hitKey]}</div>`;
                    }
                }

                boardHTML += `<div class="cell ${hitClass}" id="cell-${pName}-${path}-${c}">${enemyTokenHTML || c}${badgeHTML}</div>`;
            }

            boardHTML += `</div></div>`;
        }

        boardHTML += `</div></div>`;
        container.innerHTML += boardHTML;
    });
}

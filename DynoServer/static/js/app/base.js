/**
 * base.js - Base page management
 */

// Initialize Socket.IO connection with WebSocket
const socket = io({ transports: ['websocket'] });

// Track previous brake temperature for change detection and color coding
let previousTemperature = null;
// Store information messages for the history dropdown (max 50 entries)
let infoHistory = [];

// DOM cache for performance optimization
const domCache = {};

// Get DOM element by ID with caching
function getCachedElement(id) {
    if (!domCache[id]) {
        domCache[id] = document.getElementById(id);
    }
    return domCache[id];
}

// Update DOM element text content only if value changed
function updateDOMText(id, value) {
    const element = getCachedElement(id);
    if (element) {
        const strValue = String(value);
        // Only update if value actually changed
        if (element.textContent !== strValue) {
            element.textContent = strValue;
        }
    }
}

// Add a message to the info history with timestamp
function addToInfoHistory(message) {
    const timestamp = new Date().toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const entry = `[${timestamp}] ${message}`;
    infoHistory.push(entry);

    // Keep only the last 50 entries to prevent the textarea from getting too large
    if (infoHistory.length > 50) {
        infoHistory = infoHistory.slice(-50);
    }

    // Update the textarea
    updateInfoHistoryDisplay();
}

// Update the info history textarea with all stored messages
// Automatically scrolls to the bottom to show the latest entry
function updateInfoHistoryDisplay() {
    const textarea = document.getElementById('info-history-textarea');
    if (textarea) {
        textarea.value = infoHistory.join('\n');
        // Scroll to the bottom to show the latest entry
        textarea.scrollTop = textarea.scrollHeight;
    }
}

/* Page initialization and event handlers */
$(document).ready(function () {

    // Fetch initial system status and configuration
    // Shows/hides debug link based on debug mode setting
    // Sets live data toggle switch to current state
    fetch('/api/status')
        .then(response => response.json())
        .then(config => {
            if (config.debug === true) {
                document.getElementById('debug-link').style.display = 'block';
            } else {
                document.getElementById('debug-link').style.display = 'none';
            }
            if (config.live_mode === true) {
                document.getElementById('liveDataSwitch').checked = true;
            } else {
                document.getElementById('liveDataSwitch').checked = false;
            }

            // Add initial status to history
            addToInfoHistory('System initialized');
        })
        .catch(err => {
            console.error("Failed to load config:", err);
            addToInfoHistory('Failed to load configuration');
        });

    // Socket.IO event: Environmental data (ambient temperature and humidity)
    socket.on('env', function (data) {
        updateDOMText('env_temperature', data.temperature + " °C");
        updateDOMText('env_humidity', data.humidity + " %");
    });

    // Socket.IO event: System status and info messages
    socket.on('status', function (data) {
        const previousStatus = getCachedElement('status-badge')?.textContent || '';
        const previousInfo = getCachedElement('info-badge')?.textContent || '';

        updateDOMText('status-badge', data.status);
        updateDOMText('info-badge', data.info);

        if (data.info !== previousInfo) {
            addToInfoHistory(`Info: ${data.info}`);
        }

        if (data.status !== previousStatus) {
            addToInfoHistory(`Status: ${data.status}`);
        }

        const liveDataSwitch = getCachedElement('liveDataSwitch');
        if (liveDataSwitch) {
            liveDataSwitch.checked = data.live_mode != 0;
        }

        const statusBadge = getCachedElement('status-badge');
        if (statusBadge) {
            if (data.status == "Running") {
                statusBadge.classList.remove('text-bg-danger');
                statusBadge.classList.add('text-bg-success');
            } else {
                statusBadge.classList.remove('text-bg-success');
                statusBadge.classList.add('text-bg-danger');
            }
        }
    });

    // Socket.IO event: Brake temperature from IR sensor
    socket.on('brake_temperature', function (data) {
        const element = getCachedElement('brake_temperature');
        if (!element) return;

        const temperature = parseFloat(data.temperature).toFixed(1);
        const temperatureNum = parseFloat(temperature);

        const debugElement = getCachedElement('brakeTemperature');
        if (debugElement) {
            updateDOMText('brakeTemperature', `${temperature} °C`);
        }

        element.classList.remove('text-danger', 'text-primary', 'text-white');

        if (previousTemperature !== null) {
            const diff = temperatureNum - previousTemperature;

            if (diff >= 2.0) {
                element.classList.add('text-danger');
            } else if (diff <= -2.0) {
                element.classList.add('text-primary');
            } else {
                element.classList.add('text-white');
            }
        } else {
            element.classList.add('text-white');
        }

        updateDOMText('brake_temperature', `${temperature} °C`);

        if (previousTemperature !== null && Math.abs(temperatureNum - previousTemperature) >= 2.0) {
            const change = temperatureNum > previousTemperature ? 'increased' : 'decreased';
            addToInfoHistory(`Brake temperature ${change} to ${temperature} °C`);
        }

        previousTemperature = temperatureNum;
    });

    // Socket.IO event: Electronics temperature (DS18B20 sensor on power controller)
    socket.on('elec_temp', function (data) {
        const element = getCachedElement('elec-temp-value');
        if (element) {
            const temperature = parseFloat(data.temperature).toFixed(1);
            updateDOMText('elec-temp-value', `${temperature} °C`);
        }
    });

    // Socket.IO event: Electrical measurements from ACS781 current sensor
    socket.on('electrical', function (data) {
        if ('current' in data) {
            const current = parseFloat(data.current).toFixed(1);

            const indexEl = getCachedElement('current-value');
            if (indexEl) {
                updateDOMText('current-value', `${current} A`);
            }

            const debugEl = getCachedElement('current');
            if (debugEl) {
                updateDOMText('current', current);
            }
        }
    });

    // Socket.IO event: Connection heartbeat from DynoLogic microcontroller
    socket.on('heartbeat', function (data) {
        const connectionIcon = getCachedElement('connectionIcon');
        if (!connectionIcon) return;

        const wasConnected = connectionIcon.classList.contains('text-success');

        if (data.connected) {
            connectionIcon.classList.remove('text-danger');
            connectionIcon.classList.add('text-success');
            if (!wasConnected) {
                addToInfoHistory('Connection established');
            }
        } else {
            connectionIcon.classList.remove('text-success');
            connectionIcon.classList.add('text-danger');
            if (wasConnected) {
                addToInfoHistory('Connection lost');
            }
        }
    });

    // Live data toggle switch event handler
    const liveDataSwitch = document.getElementById('liveDataSwitch');

    if (liveDataSwitch) {
        liveDataSwitch.addEventListener('change', function () {
            const isEnabled = this.checked;

            fetch('/api/update_live', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    enabled: isEnabled
                })
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.message === 'success') {
                        addToInfoHistory(`Live data ${isEnabled ? 'enabled' : 'disabled'}`);
                    } else {
                        throw new Error('Server returned error');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    liveDataSwitch.checked = !isEnabled;
                    addToInfoHistory('Failed to update live data status');
                    alert('Failed to update live data status');
                });
        });
    }
});

// ========================================
// CLEANUP HANDLERS
// ========================================

function cleanupBase() {
    // Remove all Socket.IO event listeners
    socket.off('env');
    socket.off('status');
    socket.off('brake_temperature');
    socket.off('elec_temp');
    socket.off('electrical');
    socket.off('heartbeat');

    // Clear DOM cache
    Object.keys(domCache).forEach(key => {
        delete domCache[key];
    });
}

// Register cleanup on page unload
window.addEventListener('beforeunload', cleanupBase);

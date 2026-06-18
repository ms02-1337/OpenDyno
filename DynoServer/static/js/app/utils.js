/**
 * utils.js - DynoServer Shared Utilities
 * 
 * This module contains shared logic and utility functions for the DynoServer frontend,
 * eliminating duplication between index.js, debug.js, and configuration.js.
 */

window.DynoUtils = (function () {
    /**
     * Convert brake value to motor value for display
     * @param {number} brakeValue - The brake value from server
     * @param {number} mode - The current mode (0: Torque, 1: Speed, 2: Dynamic, 3: Dynamic debug)
     * @param {number} motorPinions - Motor pinions count
     * @param {number} dynoPinions - Dyno pinions count
     * @returns {number} Motor value for display (rounded to integer)
     */
    function convertBrakeToMotorValue(brakeValue, mode, motorPinions, dynoPinions) {
        brakeValue = parseFloat(brakeValue);
        if (isNaN(brakeValue)) return 0;

        let motorValue;
        switch (mode) {
            case 1:
                motorValue = brakeValue * dynoPinions / motorPinions;
                break;
            case 0:
                motorValue = brakeValue * motorPinions / dynoPinions;
                break;
            case 2:
            case 3:
                motorValue = brakeValue * dynoPinions / motorPinions;
                break;
            default:
                motorValue = brakeValue;
                break;
        }

        const result = Math.round(motorValue);
        return isNaN(result) ? 0 : result;
    }

    /**
     * Convert motor value to brake value for storage/commands
     */
    function convertMotorToBrakeValue(motorValue, mode, motorPinions, dynoPinions) {
        motorValue = parseFloat(motorValue);
        if (isNaN(motorValue)) {
            return { rawValue: 0.0, value: 0 };
        }

        let rawValue;
        switch (mode) {
            case 1:
                rawValue = motorValue * motorPinions / dynoPinions;
                break;
            case 0:
                rawValue = motorValue * dynoPinions / motorPinions;
                break;
            case 2:
            case 3:
                rawValue = motorValue * motorPinions / dynoPinions;
                break;
            default:
                rawValue = motorValue;
                break;
        }

        const finalRaw = isNaN(rawValue) ? 0.0 : rawValue;
        return {
            rawValue: finalRaw,
            value: Math.round(finalRaw)
        };
    }

    /**
     * Get numeric mode value from mode text
     */
    function getNumericMode(modeText) {
        switch (modeText) {
            case "Torque": return 0;
            case "Speed": return 1;
            case "Dynamic": return 2;
            case "Dynamic debug": return 3;
            default: return 1;
        }
    }

    /**
     * Collect form values from an elementMap for a given category
     * @param {Object} elementMap - Maps category -> { field: elementId }
     * @param {string} category - The category to collect values for
     * @returns {Object} Config object with values from form elements
     */
    function getConfigurationData(elementMap, category) {
        const config = {};

        if (elementMap[category]) {
            config[category] = {};
            for (const [field, elementId] of Object.entries(elementMap[category])) {
                const element = document.getElementById(elementId);
                if (element) {
                    config[category][field] = element.value;
                }
            }
        }

        return config;
    }

    /**
     * Unified send function for CAN commands
     */
    function sendContent(url, data) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.json();
        });
    }

    /**
     * Send configuration to server with button feedback
     * Consolidates the common pattern of send + button state management
     * @param {string} url - API endpoint URL
     * @param {Object} data - Configuration data to send
     * @param {string} buttonId - ID of the button that triggered the save
     */
    function sendConfig(url, data, buttonId) {
        const button = document.getElementById(buttonId);
        const originalContent = button ? button.innerHTML : "";

        return sendContent(url, data)
            .then(result => {
                if (result.message === 'success') {
                    successSavedConfiguration(button, originalContent);
                } else if (result.message === 'error') {
                    errorSavingConfiguration(button, originalContent);
                }
            })
            .catch(error => {
                console.error('Error:', error);
                errorSavingConfiguration(button, "Connection Error!");
            });
    }

    /**
     * Visual feedback for successful save
     */
    function successSavedConfiguration(buttonElement, originalContent) {
        if (!buttonElement) return;
        buttonElement.classList.replace('btn-primary', 'btn-success');
        buttonElement.innerHTML = '<i class="bi bi-check-circle"></i> Saved!';
        setTimeout(() => {
            buttonElement.classList.replace('btn-success', 'btn-primary');
            buttonElement.innerHTML = originalContent;
            buttonElement.disabled = false;
        }, 1500);
    }

    /**
     * Visual feedback for failed save
     */
    function errorSavingConfiguration(buttonElement, originalContent) {
        if (!buttonElement) return;
        buttonElement.classList.replace('btn-primary', 'btn-danger');
        buttonElement.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Error!';
        setTimeout(() => {
            buttonElement.classList.replace('btn-danger', 'btn-primary');
            buttonElement.innerHTML = originalContent;
            buttonElement.disabled = false;
        }, 3000);
    }

    /**
     * Update button visual state (active/inactive)
     */
    function updateButtonState(activeBtn, inactiveBtn) {
        if (activeBtn) activeBtn.classList.add('active');
        if (inactiveBtn) inactiveBtn.classList.remove('active');
    }

    /**
     * Show a Bootstrap toast alert
     */
    function showAlert(message, type = 'success') {
        let toastContainer = document.querySelector('.toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
            toastContainer.style.marginTop = '55px';
            document.body.appendChild(toastContainer);
        }

        const toastEl = document.createElement('div');
        toastEl.className = `toast align-items-center text-bg-${type} border-0`;
        toastEl.setAttribute('role', 'alert');
        toastEl.setAttribute('aria-live', 'assertive');
        toastEl.setAttribute('aria-atomic', 'true');

        toastEl.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;

        toastContainer.appendChild(toastEl);
        const toast = new bootstrap.Toast(toastEl);
        toast.show();

        toastEl.addEventListener('hidden.bs.toast', () => {
            toastEl.remove();
        });
    }

    /**
     * Escape HTML special characters to prevent XSS
     * @param {string} str - String to escape
     * @returns {string} Escaped string safe for HTML insertion
     */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        convertBrakeToMotorValue,
        convertMotorToBrakeValue,
        getNumericMode,
        getConfigurationData,
        sendContent,
        sendConfig,
        successSavedConfiguration,
        errorSavingConfiguration,
        updateButtonState,
        showAlert,
        escapeHtml
    };
})();

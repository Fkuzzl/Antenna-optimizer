/**
 * Process management service for MATLAB execution
 * Handles process lifecycle, state tracking, and monitoring
 */

const { spawn } = require('child_process');
const { PROCESS_STATES } = require('../config/constants');
const logger = require('../config/logger');

class ProcessManager {
    constructor() {
        this.currentExecutionState = {
            isRunning: false,
            fileName: null,
            startTime: null,
            processId: null,
            filePath: null,
            fileDir: null,
            hfssProcesses: [],
            status: PROCESS_STATES.IDLE,
        };
        
        this.matlabProcess = null;
        this.previousState = {
            matlabRunning: false,
            hfssRunning: false,
        };
    }

    /**
     * Gets current execution state
     * @returns {Object} Current state object
     */
    getState() {
        return { ...this.currentExecutionState };
    }

    /**
     * Checks if MATLAB is currently running
     * @returns {boolean}
     */
    isRunning() {
        return this.currentExecutionState.isRunning;
    }

    /**
     * Gets MATLAB process status
     * @returns {string} Process status
     */
    getStatus() {
        return this.currentExecutionState.status;
    }

    /**
     * Updates execution state
     * @param {Object} updates - Partial state updates
     */
    updateState(updates) {
        this.currentExecutionState = {
            ...this.currentExecutionState,
            ...updates
        };
        logger.info('Process state updated', { state: this.currentExecutionState });
    }

    /**
     * Starts MATLAB process
     * @param {Object} config - Process configuration
     * @returns {Promise<Object>} Process start result
     */
    async startMatlabProcess(config) {
        if (this.isRunning()) {
            throw new Error('MATLAB process is already running');
        }

        const { command, args, cwd, metadata } = config;

        return new Promise((resolve, reject) => {
            try {
                this.matlabProcess = spawn(command, args, {
                    cwd,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    detached: false,
                });

                // Log stdout and stderr for debugging
                this.matlabProcess.stdout?.on('data', (data) => {
                    logger.debug(`MATLAB stdout: ${data.toString()}`);
                });

                this.matlabProcess.stderr?.on('data', (data) => {
                    logger.warn(`MATLAB stderr: ${data.toString()}`);
                });

                this.updateState({
                    isRunning: true,
                    processId: this.matlabProcess.pid,
                    startTime: new Date(),
                    status: PROCESS_STATES.RUNNING,
                    ...metadata,
                });

                // Handle process close event
                this.matlabProcess.on('close', (code) => {
                    logger.info(`MATLAB launcher process finished (code: ${code})`);
                    // Note: Don't mark as not running here, because the actual MATLAB.exe 
                    // continues running. The periodic check in routes/matlab.js will 
                    // detect when MATLAB.exe actually terminates.
                    this.matlabProcess = null;
                });

                // Handle process error event
                this.matlabProcess.on('error', (error) => {
                    logger.error('MATLAB process error', { error: error.message });
                    this.updateState({
                        isRunning: false,
                        processId: null,
                        status: PROCESS_STATES.ERROR,
                    });
                    this.matlabProcess = null;
                    
                    // Broadcast error via WebSocket
                    const websocketManager = require('./websocketManager');
                    websocketManager.broadcast({
                        type: 'status',
                        data: this.getState()
                    });
                    
                    reject(error);
                });

                resolve({
                    success: true,
                    pid: this.matlabProcess.pid,
                    state: this.getState(),
                });

            } catch (error) {
                logger.error('Failed to start MATLAB process', { error: error.message });
                reject(error);
            }
        });
    }

    /**
     * Stops MATLAB process
     * @returns {Promise<boolean>} Success status
     */
    async stopMatlabProcess() {
        if (!this.isRunning() || !this.matlabProcess) {
            logger.warn('No MATLAB process to stop');
            return false;
        }

        try {
            this.matlabProcess.kill('SIGTERM');
            
            this.updateState({
                isRunning: false,
                processId: null,
                status: PROCESS_STATES.TERMINATED,
            });

            this.matlabProcess = null;
            logger.info('MATLAB process stopped successfully');
            return true;

        } catch (error) {
            logger.error('Error stopping MATLAB process', { error: error.message });
            throw error;
        }
    }

    /**
     * Resets execution state
     */
    reset() {
        this.currentExecutionState = {
            isRunning: false,
            fileName: null,
            startTime: null,
            processId: null,
            filePath: null,
            fileDir: null,
            hfssProcesses: [],
            status: PROCESS_STATES.IDLE,
        };
        this.matlabProcess = null;
        logger.info('Process manager reset');
    }
}

// Export singleton instance
module.exports = new ProcessManager();

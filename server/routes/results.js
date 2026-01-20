/**
 * Routes for simulation results endpoints
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { exec } = require('child_process');
const { validateProjectPath, validatePaginationParams } = require('../middleware/validation');
const { getPaginatedResults, readExcelWithRetry } = require('../services/excelReader');
const { createResponse, sanitizeError } = require('../utils/helpers');
const { HTTP_STATUS, FILES } = require('../config/constants');
const logger = require('../config/logger');

/**
 * POST /api/integrated-results/read-page
 * Read paginated simulation results from Excel file
 */
router.post('/read-page', validateProjectPath, validatePaginationParams, async (req, res) => {
    try {
        const projectPath = req.validatedProjectPath;
        const { page, pageSize } = req.pagination;
        
        const excelPath = path.join(projectPath, FILES.EXCEL_FILENAME);
        
        logger.info(`Reading page ${page} (size: ${pageSize}) from ${excelPath}`);

        const result = getPaginatedResults(excelPath, page, pageSize);
        
        res.json(createResponse(true, result));
    } catch (error) {
        logger.error(`Error reading page: ${error.message}`);
        
        if (error.message.includes('not found')) {
            return res.status(HTTP_STATUS.NOT_FOUND).json(
                createResponse(false, null, 'Excel file not found. Please run optimization first.')
            );
        }
        
        if (error.message.includes('corrupted') || error.message.includes('compressed size')) {
            return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json(
                createResponse(false, null, 'Excel file is corrupted or being updated. Please try again in a moment.', sanitizeError(error))
            );
        }

        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, 'Error reading results', sanitizeError(error))
        );
    }
});

/**
 * POST /api/integrated-results/update
 * Update Excel file with missing iterations from CSV files
 */
router.post('/update', validateProjectPath, async (req, res) => {
    try {
        const projectPath = req.validatedProjectPath;
        
        logger.info(`Updating Excel for project: ${projectPath}`);

        // Run Python script to update Excel
        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'update_excel_incremental.py');
        const pythonCmd = `python "${scriptPath}" --project-path "${projectPath}"`;

        exec(pythonCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                logger.error(`Update error: ${stderr}`);
                return res.json(createResponse(false, null, 'Update failed', stderr));
            }

            logger.info(`Update output: ${stdout}`);
            res.json(createResponse(true, { output: stdout }, 'Excel updated successfully'));
        });

    } catch (error) {
        logger.error(`Update endpoint error: ${error.message}`);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, sanitizeError(error))
        );
    }
});

/**
 * POST /api/integrated-results/create
 * Create new integrated Excel file from CSV files
 */
router.post('/create', validateProjectPath, async (req, res) => {
    try {
        const projectPath = req.validatedProjectPath;
        
        logger.info(`Creating Excel for project: ${projectPath}`);

        // Run Python script to create Excel
        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'integrated_results_manager.py');
        const pythonCmd = `python "${scriptPath}" create --project-path "${projectPath}"`;

        exec(pythonCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                logger.error(`Create error: ${stderr}`);
                return res.json(createResponse(false, null, 'Failed to create Excel file', stderr));
            }

            logger.info(`Create output: ${stdout}`);
            res.json(createResponse(true, { output: stdout }, 'Excel file created successfully'));
        });

    } catch (error) {
        logger.error(`Create endpoint error: ${error.message}`);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
            createResponse(false, null, sanitizeError(error))
        );
    }
});

/**
 * POST /api/integrated-results/clear
 * Clear integrated Excel file
 */
router.post('/clear', validateProjectPath, async (req, res) => {
    try {
        const projectPath = req.validatedProjectPath;
        
        logger.info(`Clearing integrated Excel for project: ${projectPath}`);

        const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'integrated_results_manager.py');
        const pythonCmd = `python "${scriptPath}" clear --project-path "${projectPath}"`;

        exec(pythonCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                logger.error(`Clear error: ${stderr}`);
                return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                    success: false,
                    message: 'Failed to clear integrated Excel file',
                    error: error.message,
                    stderr: stderr,
                    timestamp: new Date().toISOString()
                });
            }

            logger.info('Results cache cleared successfully');

            res.json({
                success: true,
                message: 'Integrated Excel file cleared successfully',
                output: stdout,
                timestamp: new Date().toISOString()
            });
        });

    } catch (error) {
        logger.error(`Clear endpoint error: ${error.message}`);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            message: 'Failed to clear integrated Excel',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/integrated-results/read
 * Read entire integrated Excel file (non-paginated)
 */
router.post('/read', validateProjectPath, async (req, res) => {
    try {
        const projectPath = req.validatedProjectPath;
        
        logger.info(`Reading integrated Excel for project: ${projectPath}`);

        // First get summary information
        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'integrated_results_manager.py');
        const pythonCmd = `python "${scriptPath}" summary --project-path "${projectPath}"`;

        exec(pythonCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                logger.error(`Read error: ${stderr}`);
                return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                    success: false,
                    message: 'Failed to read integrated Excel file',
                    error: error.message,
                    stderr: stderr,
                    timestamp: new Date().toISOString()
                });
            }

            try {
                const summary = JSON.parse(stdout);
                
                if (!summary.exists) {
                    logger.info(`Excel file not found: ${summary.path}`);
                    return res.status(HTTP_STATUS.NOT_FOUND).json({
                        success: false,
                        message: 'Integrated Excel file not found',
                        summary: summary,
                        timestamp: new Date().toISOString()
                    });
                }

                logger.info(`Excel summary: ${summary.total_iterations} iterations`);

                // Read the Excel file
                const excelPath = path.join(projectPath, FILES.EXCEL_FILENAME);
                
                if (fs.existsSync(excelPath)) {
                    const workbook = readExcelWithRetry(excelPath);
                    const results = {
                        iterations: [],
                        summary: {
                            totalIterations: summary.total_iterations,
                            s11Available: 'S11_Data' in summary.sheets,
                            arAvailable: 'AR_Data' in summary.sheets,
                            gainAvailable: 'Gain_Data' in summary.sheets
                        }
                    };

                    // Read each sheet and organize by iteration
                    const iterationData = {};

                    ['S11_Data', 'AR_Data', 'Gain_Data'].forEach(sheetName => {
                        if (workbook.SheetNames.includes(sheetName)) {
                            const worksheet = workbook.Sheets[sheetName];
                            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                            
                            // Skip header row and process data
                            for (let i = 1; i < data.length; i++) {
                                const row = data[i];
                                if (row && row.length >= 3) {
                                    const iteration = parseInt(row[0]);
                                    const frequency = parseFloat(row[1]);
                                    const value = parseFloat(row[2]);
                                    
                                    if (!isNaN(iteration) && !isNaN(frequency) && !isNaN(value)) {
                                        if (!iterationData[iteration]) {
                                            iterationData[iteration] = {
                                                iteration: iteration,
                                                frequencies: [],
                                                s11: [],
                                                ar: [],
                                                gain: []
                                            };
                                        }
                                        
                                        // Store frequency if not already stored
                                        if (!iterationData[iteration].frequencies.includes(frequency)) {
                                            iterationData[iteration].frequencies.push(frequency);
                                        }
                                        
                                        // Store value in appropriate array
                                        const dataType = sheetName.split('_')[0].toLowerCase();
                                        iterationData[iteration][dataType].push(value);
                                    }
                                }
                            }
                        }
                    });

                    // Convert to array and sort by iteration
                    results.iterations = Object.values(iterationData).sort((a, b) => a.iteration - b.iteration);

                    res.json({
                        success: true,
                        message: `Integrated Excel data loaded: ${results.iterations.length} iterations`,
                        data: results,
                        summary: summary,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    res.status(HTTP_STATUS.NOT_FOUND).json({
                        success: false,
                        message: 'Integrated Excel file not found',
                        path: excelPath,
                        timestamp: new Date().toISOString()
                    });
                }

            } catch (parseError) {
                logger.error(`Parse error: ${parseError.message}`);
                res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                    success: false,
                    message: 'Failed to parse integrated Excel summary',
                    error: parseError.message,
                    output: stdout,
                    timestamp: new Date().toISOString()
                });
            }
        });

    } catch (error) {
        logger.error(`Read endpoint error: ${error.message}`);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            message: 'Failed to read integrated Excel',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/simulation/results
 * Load simulation results from Excel files in data path
 */
router.post('/results', async (req, res) => {
    try {
        const { dataPath, targetFrequencies } = req.body;
        
        if (!dataPath || !targetFrequencies || !Array.isArray(targetFrequencies)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                message: 'Missing required parameters: dataPath and targetFrequencies array',
                timestamp: new Date().toISOString()
            });
        }

        logger.info(`Loading simulation results from: ${dataPath}`, {
            targetFrequencies: targetFrequencies.join(', ')
        });

        // Check if data path exists
        if (!fs.existsSync(dataPath)) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                message: `Data path not found: ${dataPath}`,
                timestamp: new Date().toISOString()
            });
        }

        // Look for Excel files in the data directory
        const files = fs.readdirSync(dataPath);
        const excelFiles = files.filter(file => 
            file.toLowerCase().endsWith('.xlsx') || file.toLowerCase().endsWith('.xls')
        );

        logger.info(`Found Excel files: ${excelFiles.join(', ')}`);

        // Function to read Excel file and extract iteration-based data
        const readIterationExcelData = (filePath) => {
            try {
                const workbook = XLSX.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                logger.info(`Reading ${path.basename(filePath)}: ${data.length} rows found`);

                const iterationResults = [];
                
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    if (row && row.length >= 2) {
                        let iterationNum = null;
                        let freqValue = null;
                        let resultValue = null;
                        
                        // Check if first column is iteration number
                        if (!isNaN(parseFloat(row[0])) && row.length >= 3) {
                            iterationNum = parseInt(row[0]);
                            freqValue = parseFloat(row[1]);
                            resultValue = parseFloat(row[2]);
                        } else {
                            // Assume data is grouped by iteration
                            iterationNum = Math.floor((i - 1) / targetFrequencies.length) + 1;
                            freqValue = parseFloat(row[0]);
                            resultValue = parseFloat(row[1]);
                        }
                        
                        if (!isNaN(freqValue) && !isNaN(resultValue)) {
                            let iteration = iterationResults.find(iter => iter.iteration === iterationNum);
                            if (!iteration) {
                                iteration = {
                                    iteration: iterationNum,
                                    frequencies: [],
                                    values: []
                                };
                                iterationResults.push(iteration);
                            }
                            
                            iteration.frequencies.push(freqValue);
                            iteration.values.push(resultValue);
                        }
                    }
                }

                return iterationResults;
                
            } catch (error) {
                logger.error(`Error reading ${filePath}: ${error.message}`);
                return [];
            }
        };

        // Initialize results object
        const simulationResults = {
            iterations: [],
            summary: {
                totalIterations: 0,
                s11Available: false,
                arAvailable: false,
                gainAvailable: false
            }
        };

        let maxIterations = 0;

        // Read each type of Excel file
        for (const file of excelFiles) {
            const filePath = path.join(dataPath, file);
            const fileName = file.toLowerCase();
            
            logger.info(`Processing: ${file}`);
            
            const iterationData = readIterationExcelData(filePath);
            maxIterations = Math.max(maxIterations, iterationData.length);
            
            if (fileName.includes('s11') || fileName.includes('return')) {
                simulationResults.summary.s11Available = true;
                iterationData.forEach(iter => {
                    let existing = simulationResults.iterations.find(i => i.iteration === iter.iteration);
                    if (!existing) {
                        existing = {
                            iteration: iter.iteration,
                            s11: [],
                            ar: [],
                            gain: []
                        };
                        simulationResults.iterations.push(existing);
                    }
                    existing.s11 = iter.values;
                });
                
            } else if (fileName.includes('ar') || fileName.includes('axial')) {
                simulationResults.summary.arAvailable = true;
                iterationData.forEach(iter => {
                    let existing = simulationResults.iterations.find(i => i.iteration === iter.iteration);
                    if (!existing) {
                        existing = {
                            iteration: iter.iteration,
                            s11: [],
                            ar: [],
                            gain: []
                        };
                        simulationResults.iterations.push(existing);
                    }
                    existing.ar = iter.values;
                });
                
            } else if (fileName.includes('gain')) {
                simulationResults.summary.gainAvailable = true;
                iterationData.forEach(iter => {
                    let existing = simulationResults.iterations.find(i => i.iteration === iter.iteration);
                    if (!existing) {
                        existing = {
                            iteration: iter.iteration,
                            s11: [],
                            ar: [],
                            gain: []
                        };
                        simulationResults.iterations.push(existing);
                    }
                    existing.gain = iter.values;
                });
                
            } else {
                logger.warn(`Unknown file type: ${file} - skipping`);
            }
        }

        // Sort iterations by iteration number
        simulationResults.iterations.sort((a, b) => a.iteration - b.iteration);
        simulationResults.summary.totalIterations = maxIterations;

        // Fill in missing data with empty arrays
        simulationResults.iterations.forEach(iter => {
            if (!simulationResults.summary.s11Available) iter.s11 = [];
            if (!simulationResults.summary.arAvailable) iter.ar = [];
            if (!simulationResults.summary.gainAvailable) iter.gain = [];
        });

        // Check if any data was loaded
        const hasData = simulationResults.iterations.length > 0;
        
        if (!hasData) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                message: 'No valid simulation data found. Expected Excel files with names containing "s11", "ar", or "gain".',
                availableFiles: excelFiles,
                timestamp: new Date().toISOString()
            });
        }

        logger.info(`Results loaded: ${simulationResults.iterations.length} iterations`);
        
        res.json({
            success: true,
            message: `Simulation results loaded successfully: ${simulationResults.iterations.length} iterations`,
            data: simulationResults,
            metadata: {
                dataPath: dataPath,
                targetFrequencies: targetFrequencies,
                filesProcessed: excelFiles,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        logger.error(`Simulation results error: ${error.message}`);
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            message: 'Failed to load simulation results',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;

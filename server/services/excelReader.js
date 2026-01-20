/**
 * Excel file reading service with retry logic and error handling
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { TIMEOUTS, RETRY, EXCEL_SHEETS, FILES } = require('../config/constants');
const logger = require('../config/logger');

/**
 * Reads Excel file with retry logic for handling file corruption or locks
 * @param {string} filePath - Path to Excel file
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} delayMs - Delay between retries in milliseconds
 * @returns {Object} XLSX workbook object
 * @throws {Error} If all retry attempts fail
 */
const readExcelWithRetry = (filePath, maxRetries = RETRY.EXCEL_READ_ATTEMPTS, delayMs = TIMEOUTS.EXCEL_READ_RETRY_DELAY) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const workbook = XLSX.readFile(filePath, { 
                cellStyles: false,
                cellFormula: false,
                cellHTML: false
            });
            return workbook;
        } catch (error) {
            if (attempt === maxRetries) {
                logger.error(`Failed to read Excel after ${maxRetries} attempts: ${error.message}`);
                throw error;
            }
            logger.warn(`Read attempt ${attempt} failed, retrying in ${delayMs}ms...`);
            // Synchronous delay
            const start = Date.now();
            while (Date.now() - start < delayMs) {
                // Wait
            }
        }
    }
};

/**
 * Reads and parses simulation results from Excel file
 * @param {string} excelPath - Path to Excel file
 * @returns {Object} Parsed iteration data
 */
const readSimulationResults = (excelPath) => {
    const workbook = readExcelWithRetry(excelPath);
    const iterationData = {};

    // Read all sheets
    [EXCEL_SHEETS.S11, EXCEL_SHEETS.AR, EXCEL_SHEETS.GAIN].forEach(sheetName => {
        if (workbook.SheetNames.includes(sheetName)) {
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (row && row.length >= 3) {
                    const iteration = parseInt(row[0]);
                    const frequency = parseFloat(row[1]);
                    const value = parseFloat(row[2]);
                    
                    if (!isNaN(iteration) && !isNaN(frequency) && !isNaN(value)) {
                        if (!iterationData[iteration]) {
                            iterationData[iteration] = {
                                iteration,
                                frequencies: [],
                                s11: [],
                                ar: [],
                                gain: []
                            };
                        }
                        
                        if (!iterationData[iteration].frequencies.includes(frequency)) {
                            iterationData[iteration].frequencies.push(frequency);
                        }
                        
                        const dataType = sheetName.split('_')[0].toLowerCase();
                        iterationData[iteration][dataType].push(value);
                    }
                }
            }
        }
    });

    return iterationData;
};

/**
 * Gets paginated simulation results
 * @param {string} excelPath - Path to Excel file
 * @param {number} page - Page number (1-indexed)
 * @param {number} pageSize - Number of iterations per page
 * @returns {Object} Paginated results with metadata
 */
const getPaginatedResults = (excelPath, page = 1, pageSize = 100) => {
    if (!fs.existsSync(excelPath)) {
        throw new Error('Excel file not found');
    }

    const iterationData = readSimulationResults(excelPath);
    
    // Sort iterations in ascending order (oldest to newest)
    const allIterations = Object.values(iterationData).sort((a, b) => a.iteration - b.iteration);
    const totalIterations = allIterations.length;
    const totalPages = Math.ceil(totalIterations / pageSize);
    
    // Calculate page boundaries
    const startIdx = (page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalIterations);
    
    // Get page slice
    const pageIterations = allIterations.slice(startIdx, endIdx);
    
    // Build summary
    const summary = {
        totalIterations,
        s11Available: allIterations.some(iter => iter.s11 && iter.s11.length > 0),
        arAvailable: allIterations.some(iter => iter.ar && iter.ar.length > 0),
        gainAvailable: allIterations.some(iter => iter.gain && iter.gain.length > 0)
    };

    return {
        iterations: pageIterations,
        summary,
        page,
        pageSize,
        totalPages,
        hasMore: page < totalPages
    };
};

/**
 * Gets all available frequencies from Excel file
 * @param {string} excelPath - Path to Excel file
 * @returns {Array<number>} Sorted array of frequencies
 */
const getAvailableFrequencies = (excelPath) => {
    const iterationData = readSimulationResults(excelPath);
    const frequencies = new Set();
    
    Object.values(iterationData).forEach(iter => {
        if (iter.frequencies) {
            iter.frequencies.forEach(freq => frequencies.add(freq));
        }
    });
    
    return Array.from(frequencies).sort((a, b) => a - b);
};

/**
 * Gets the maximum iteration number from Excel file
 * @param {string} excelPath - Path to Excel file
 * @returns {number} Maximum iteration number
 */
const getMaxIteration = (excelPath) => {
    const iterationData = readSimulationResults(excelPath);
    const iterations = Object.keys(iterationData).map(k => parseInt(k));
    return iterations.length > 0 ? Math.max(...iterations) : 0;
};

module.exports = {
    readExcelWithRetry,
    readSimulationResults,
    getPaginatedResults,
    getAvailableFrequencies,
    getMaxIteration,
};

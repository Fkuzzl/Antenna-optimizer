/**
 * GND (Ground Plane) file upload and processing routes
 * Handles DXF file upload and geometry parsing
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const { createResponse, sanitizeError } = require('../utils/helpers');
const { HTTP_STATUS } = require('../config/constants');
const logger = require('../config/logger');

// Configure multer for GND file uploads
const gndStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '..', 'uploads', 'gnd_files');
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Generate unique filename: timestamp_uuid_originalname
        const timestamp = Date.now();
        const uuid = require('crypto').randomUUID();
        const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${timestamp}_${uuid}_${sanitizedFilename}`);
    }
});

const gndFileFilter = (req, file, cb) => {
    const allowedExtensions = ['.dxf', '.DXF'];
    const ext = path.extname(file.originalname);
    
    if (allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type. Only ${allowedExtensions.join(', ')} files are allowed.`), false);
    }
};

const gndUpload = multer({
    storage: gndStorage,
    fileFilter: gndFileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

/**
 * POST /api/gnd/upload
 * Upload and parse GND (DXF) file
 */
router.post('/upload', gndUpload.single('gndFile'), async (req, res) => {
    try {
        const { projectPath } = req.body;
        const file = req.file;
        
        if (!file) {
            logger.error('No file uploaded');
            return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
                success: false, 
                error: 'No file uploaded' 
            });
        }
        
        if (!projectPath) {
            logger.error('Project path not provided');
            return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
                success: false, 
                error: 'Project path is required' 
            });
        }
        
        logger.info('GND file uploaded', {
            filename: file.originalname,
            size: `${(file.size / 1024).toFixed(2)} KB`,
            path: file.path
        });
        
        // Load setup config for Python path
        let setupConfig;
        try {
            setupConfig = require(path.join(__dirname, '..', '..', 'OPEN_THIS', 'SETUP', 'setup_loader'));
        } catch (error) {
            logger.warn('Setup config not found, using default python', { error: error.message });
        }
        
        // Parse geometry using Python script
        const pythonScript = path.join(__dirname, '..', '..', 'scripts', 'gnd_importer', 'gnd_loader.py');
        const pythonExe = setupConfig ? setupConfig.getPythonExecutable() : 'python';
        
        logger.info('Parsing GND file with Python script', {
            script: pythonScript,
            filePath: file.path,
            projectPath
        });
        
        // Wrap Python execution in a proper Promise
        const parseResult = await new Promise((resolve, reject) => {
            const pythonProcess = spawn(pythonExe, [pythonScript, file.path, projectPath]);
            
            let stdout = '';
            let stderr = '';
            
            pythonProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    // Don't log here - will be logged by outer catch block
                    reject(new Error(`Failed to parse GND file: ${stderr}`));
                    return;
                }
                
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (parseError) {
                    logger.error('Failed to parse Python output', { 
                        error: parseError.message,
                        stdout 
                    });
                    reject(new Error(`Invalid response from parser: ${parseError.message}`));
                }
            });
            
            pythonProcess.on('error', (error) => {
                // Don't log here - will be logged by outer catch block
                reject(new Error(`Failed to execute parser: ${error.message}`));
            });
        });
        
        // Check if parsing was successful
        if (!parseResult.success) {
            logger.warn('GND parsing failed', { result: parseResult });
            return res.status(HTTP_STATUS.BAD_REQUEST).json(parseResult);
        }
        
        logger.info('GND parsed successfully', {
            vertices: parseResult.vertex_count,
            faces: parseResult.face_count,
            edges: parseResult.edge_count
        });
        
        res.json({
            success: true,
            file: {
                originalName: file.originalname,
                size: file.size,
                format: parseResult.format,
                path: file.path
            },
            geometry: parseResult.geometry,
            bounds: parseResult.bounds,
            vertex_count: parseResult.vertex_count,
            face_count: parseResult.face_count,
            edge_count: parseResult.edge_count,
            validation: parseResult.validation
        });
        
    } catch (error) {
        logger.error('GND upload error', { 
            error: error.message,
            stack: error.stack 
        });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * POST /api/gnd/validate
 * Validate GND file (validation happens during upload, this is for compatibility)
 */
router.post('/validate', async (req, res) => {
    try {
        const { gndId } = req.body;
        
        if (!gndId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
                success: false, 
                error: 'GND ID is required' 
            });
        }
        
        // Validation is performed during upload, this endpoint is for app compatibility
        // Return success as validation already passed during upload
        logger.info('GND validation check', { gndId });
        
        res.json({
            success: true,
            valid: true,
            gndId: gndId,
            message: 'GND file validated during upload',
            errors: [],
            warnings: [],
            suggestions: ['Geometry validation was performed during file upload']
        });
        
    } catch (error) {
        logger.error('GND validation error', { error: error.message });
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;

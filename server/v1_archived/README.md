# V1 Server - Archived

This directory contains the original monolithic server implementation (matlab-server.js) for reference purposes.

## ⚠️ ARCHIVED - DO NOT USE IN PRODUCTION

This V1 server has been replaced by the modular V2 architecture for better maintainability, scalability, and code organization.

## Why Archived?

The V1 server (`matlab-server.js`) was a 3200+ line monolithic file that handled:
- MATLAB process management
- Ground plane configuration
- Variable management
- Results processing
- GND file uploads
- WebSocket communication

While functional, it became difficult to maintain and extend.

## V1 Characteristics

**File:** `matlab-server.js`
- **Size:** 3265 lines
- **Architecture:** Monolithic (all code in one file)
- **Dependencies:** Express, WebSocket, XLSX, Multer, Winston
- **Endpoints:** 19 API endpoints

## Migration to V2

V2 improvements:
- ✅ **Modular structure** - Separated routes, services, middleware
- ✅ **Better error handling** - Centralized error management
- ✅ **Improved logging** - Structured logging with Winston
- ✅ **Enhanced validation** - Middleware-based validation
- ✅ **Easier testing** - Isolated components
- ✅ **Better documentation** - Clear API contracts

## When to Reference V1

Use this archived version when:
- Debugging legacy behavior
- Understanding original implementation logic
- Comparing V1 vs V2 implementation differences
- Historical code review

## Current Production Server

**Location:** `server/server.js` (V2 modular architecture)
**Documentation:** See `server/README.md` for V2 documentation

---

**Archived Date:** January 20, 2026  
**Last Working Version:** V1 (matlab-server.js)  
**Replaced By:** V2 Modular Server

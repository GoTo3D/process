# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js service for 3D model processing (photogrammetry). It consumes jobs from an AMQP/RabbitMQ queue, converts uploaded images into 3D models (USDZ, OBJ, MTL formats), and uploads results to Cloudflare R2.

**Platform requirement:** macOS only - the binary tool (PhotoProcess) uses Apple's RealityKit Object Capture API.

## Commands

```bash
npm run dev              # Start the queue consumer (with .env)
npm start                # Start the queue consumer (production)
npm test                 # Run unit tests
npm run test:unit        # Run unit tests only
npm run test:local       # Run local integration test (no external services)
npm run test:integration # Run integration test (requires real services)
npm run test:e2e         # Run end-to-end test (requires running consumer)
bash PhotoProcess/build.sh  # Build and deploy Swift binary
```

## Architecture

### Entry Point & Processing Flow

`src/processQueue.js` → AMQP consumer that receives project IDs from the queue and delegates to ProcessManager.

`src/ProcessManager.js` → Main orchestrator class that handles the complete workflow:
1. Download images from Supabase storage or Telegram
2. Execute `PhotoProcess` binary (images → USDZ + OBJ in a single step)
3. Upload results to Cloudflare R2
4. Send Telegram notifications (if applicable)
5. Update project status in Supabase database

### Key Directories

- `src/lib/` - Native macOS binary (PhotoProcess) and client initializers
- `PhotoProcess/` - Swift Package source for the PhotoProcess CLI (build with `bash PhotoProcess/build.sh`)
- `src/utils/` - Service layer modules for S3, database, and Telegram operations
- `/Volumes/T7/projects/` - Local storage path for processing (external drive)

### External Services

- **Supabase** - Database (project metadata) and storage (source images)
- **Cloudflare R2** - Output storage for generated 3D models (S3-compatible)
- **RabbitMQ** - Job queue for processing requests
- **Telegram** - User notifications and optional file source

### PhotoProcess Parameters

```
PhotoProcess <inputDirectory> <outputDirectory> [options]

--detail: preview | reduced | medium | full | raw | custom (default: medium)
--ordering: unordered | sequential (default: unordered)
--feature-sensitivity: normal | high (default: normal)
--no-object-masking: disable automatic object masking
--skip-usdz: generate only OBJ
--skip-obj: generate only USDZ
--bounds: minX,minY,minZ,maxX,maxY,maxZ (bounding box)
--checkpoint-directory: path for resumable processing

Custom detail (when --detail custom):
--max-polygons: maximum polygon count
--texture-dimension: 1k | 2k | 4k | 8k | 16k
--texture-format: png | jpeg
--texture-quality: 0.0-1.0 (jpeg only)
--texture-maps: diffuse,normal,roughness,displacement,ao,all
```

Progress is reported as JSON lines on stdout. Build with `bash PhotoProcess/build.sh`.

## Environment Variables

See `.env.example` for required configuration:
- Supabase URL and key
- Telegram bot token
- Cloudflare R2 credentials
- AMQP queue connection string

## Database Schema (Supabase)

**project table:** id, status, files, detail, feature, ordering, process_start, process_end, model_urls, telegram_user

**Status values:** `processing` → `done` | `error`

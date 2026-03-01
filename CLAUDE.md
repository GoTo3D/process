# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js service for 3D model processing (photogrammetry). It consumes jobs from an AMQP/RabbitMQ queue, converts uploaded images into 3D models (USDZ, OBJ, MTL formats), and uploads results to Cloudflare R2.

**Platform requirement:** macOS only - the binary tools (HelloPhotogrammetry, usdconv) are macOS universal binaries.

## Commands

```bash
npm run dev     # Start the queue consumer
npm start       # Same as dev
```

No test or lint commands are configured.

## Architecture

### Entry Point & Processing Flow

`src/processQueue.js` → AMQP consumer that receives project IDs from the queue and delegates to ProcessManager.

`src/ProcessManager.js` → Main orchestrator class that handles the complete workflow:
1. Download images from Supabase storage or Telegram
2. Execute `HelloPhotogrammetry` binary (images → USDZ)
3. Execute `usdconv` binary (USDZ → OBJ/MTL)
4. Upload results to Cloudflare R2
5. Send Telegram notifications (if applicable)
6. Update project status in Supabase database

### Key Directories

- `src/lib/` - Native macOS binaries (HelloPhotogrammetry, usdconv) and client initializers
- `src/utils/` - Service layer modules for S3, database, and Telegram operations
- `/Volumes/T7/projects/` - Local storage path for processing (external drive)

### External Services

- **Supabase** - Database (project metadata) and storage (source images)
- **Cloudflare R2** - Output storage for generated 3D models (S3-compatible)
- **RabbitMQ** - Job queue for processing requests
- **Telegram** - User notifications and optional file source

### HelloPhotogrammetry Parameters

```
-d (detail): preview | reduced | medium | full | raw
-o (ordering): unordered | sequential
-f (feature): normal | high
```

## Environment Variables

See `.env.example` for required configuration:
- Supabase URL and key
- Telegram bot token
- Cloudflare R2 credentials
- AMQP queue connection string

## Database Schema (Supabase)

**project table:** id, status, files, detail, feature, ordering, process_start, process_end, model_urls, telegram_user

**Status values:** `processing` → `done` | `error`

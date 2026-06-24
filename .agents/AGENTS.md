# AI Workspace Automation & Documentation Rules

> [!IMPORTANT]
> **Workspace Parent Link**: The root of the Google Drive active workspace projects is located at:
> https://drive.google.com/drive/folders/175oU4Dae4xId-xYFnVNPH8OuQzkaXpew?usp=drive_link
> 
> It is **MANDATORY** for all AI contributors in the FCC Project Hierarchy workspace when working on a project to maintain this workspace, keeping local repository structures, READMEs, and Google Drive project ledgers fully synchronized and documented.

---

## 1. Project Context Isolation (No Info Bleed)
*   **Strict Compartmentalization**: Maintain a strict firewall between project directories. Never copy, reference, or bleed credentials, keys, database schemas, or project details from one codebase to another.
*   **Clean Variables**: Ensure configuration files (like `.env`, `config.json`, or settings files) only reference resources belonging to the active project context.

## 2. Google Drive Folder & Project Ledger Management
*   **Workspace Parent ID**: All project directories must be grouped under the main `Projects` parent folder (Folder ID: `175oU4Dae4xId-xYFnVNPH8OuQzkaXpew`).
*   **Ledger Location**: Every project folder must contain an `AI Project Ledger: [Project Name]` Google Doc.
*   **Ledger Template**: If a ledger is created or updated, it must strictly follow this structure:
    1.  **Mandatory AI Collaboration Protocol Header**: Force future agents to read-first/write-back.
    2.  **Project Overview**: Detailed description (specifying tech stack and core features).
    3.  **State Ledger (Living Tracker)**: Clear checklist of completed work and current items in progress.
    4.  **Agentic Teamwork Coordination Protocols**: Outlines responsibilities for Antigravity (Lead Manager), NotebookLM, Google Spark, Google Gemini, Microsoft Copilot, and ChatGPT.
    5.  **Active Session Context Notes**: Detailed handoff notes capturing developer decisions.
*   **Safe Document Modification**: When writing or updating Google Docs text via the API, always use a `batchUpdate` containing a `deleteContentRange` (covering index range `[1, endIndex - 1]`) followed by an `insertText` at index `1` to overwrite cleanly.

## 3. Local README & Documentation Guidelines
*   **README Mandatory**: Every repository must contain a comprehensive `README.md` file. Template-generated default READMEs (like standard Vite or Create React App placeholders) must be overwritten.
*   **README Requirements**: Every `README.md` must include:
    *   **Project Title & Icon**
    *   **Overview**: Detailed, custom business/technical purpose.
    *   **Tech Stack**: Precise libraries, runtimes, and languages.
    *   **Project Structure**: Directory/file tree breakdown.
    *   **Installation & Setup**: Steps for dependencies, virtual environments, database migrations, and config files.
    *   **Commands**: CLI commands for dev, build, testing, and production runs.

## 4. Git Version Control & Push Synchronization
*   **Git Initialization**: If a codebase is not tracked, initialize Git (`git init`), set the default branch to `main`, and add the remote origin pointing to the `ForestCityCreatorsLLC` organization: `https://github.com/ForestCityCreatorsLLC/[Repo-Name].git`.
*   **Untracked Exclusions**: Ensure that heavy dependencies (`node_modules/`, `packages/`), virtual environments (`.venv/`), and dynamic test outputs (`.tmp/`) are ignored in `.gitignore` before making commits.
*   **Conflict & Force-Push Safety**:
    *   If a push is rejected due to remote-only commits (e.g. placeholder files added during GitHub repository creation), verify that the local codebase is correct and execute a force-push (`git push -f origin main`) to override.
    *   For external projects (like JARVIS), rename original origin to `upstream` and set local `origin` to the organization fork URL before pushing.

## 5. Master AI Update Log Updates
*   **Session Handoff Registration**: Every completed synchronization or major code change session must be appended as a new row to the table inside the master Google Doc `AI_Update_Log` (ID: `1s9S2Qr-hjtOAQajjJBMHDCv6i-FM_iLxT2owB3-kREY`).
*   **Handoff Data Structure**: The row must include:
    1.  **Date**: Local system execution date.
    2.  **Agent**: Name of the assistant (e.g., `Antigravity (AI Coding Assistant)`).
    3.  **Actions**: Detailed summary of tasks completed and status of git pushes/ledgers.
    4.  **Files**: Summary count of directories/files modified.

## 6. Windows OS Compatibility & Shell Conventions
*   **Shell Targeting**: The execution environment is Windows. Ensure all scripts target Windows Command Prompt (`cmd.exe`) or PowerShell (`powershell.exe`). Use Windows-compatible CLI commands (e.g. `dir` instead of `ls`, `copy` instead of `cp`, `.bat` or `.ps1` execution scripts).
*   **File Path Formats**: Use absolute Windows paths with double backslashes (`\\`) or forward slashes (`/`) in configuration files to avoid path escape errors in JSON or Python.

## 7. Operational & Virtual Environment Safety
*   **Isolated Dependencies**: Never install Python libraries globally. Always locate and activate local project virtual environments (e.g., `\\.venv\\Scripts\\activate`) before executing Python tasks or script monitors.
*   **Dev Servers and Tasks**: Launch long-running development servers (e.g. `npm run dev`) or diagnostic utilities as background tasks. Never run blocking command executions that halt main agent operations.
*   **Credential Protection**: Never hardcode client secrets, personal access tokens, or Google Service account private keys directly into codebases. Always utilize secure storage structures (e.g. Windows Keyring, `SecurityVault`, or `.env` files explicitly added to `.gitignore`).

## 8. Mobile & Hybrid Platform Compilation (Capacitor/Cordova)
*   **Asset Build Ordering**: When working with hybrid platform wrappers (like Capacitor in Throttle Run), always compile the web bundle (`npm run build` or equivalent) *before* triggering native sync commands (`npx cap sync` or `npx cap copy`). This prevents stale web assets from being loaded into native Android/iOS compilation structures.

## 9. Automated Testing & Verification Protocols
*   **Mandatory Verification**: All code changes, fixes, and refactoring MUST be verified, compiled/built, and checked for bugs via automated unit/E2E test suites or manual execution prior to committing or syncing.
*   **Headless Defaults**: Run all Playwright or Selenium E2E browser tests in headless mode by default inside local shell environments to conserve system resources. Enable headful mode only for interactive UI debugging sessions.
*   **Test Isolation**: Ensure tests run on designated local mock ports (e.g. `localhost:3000`) rather than hitting active production servers.

## 10. Google Drive Organization Cleanliness
*   **Root Cleanliness**: Never write temporary files, scratch scripts, or local project backups directly to the root of the Google Drive folder.
*   **Scratch Storage**: Utilize the local `/scratch` directory or the designated `Archives` directory on Google Drive for historical backups or utilities to keep the active `FCC Project Hierarchy` folder structured and pristine.

## 11. Node.js Module Resolution (ESM vs CommonJS)
*   **Module Type Check**: Before creating or modifying Node.js source files, check the parent `package.json` for `"type": "module"`. 
*   **Syntax Alignment**:
    *   If `"type": "module"` is present, utilize ES6 imports/exports (`import express from 'express'`) and ensure file extensions are specified in local imports.
    *   Otherwise, default to CommonJS syntax (`const express = require('express')`). Do not mix module syntaxes in a single project.

## 12. SQLite Database Concurrency & Locks
*   **WAL Mode**: For local application SQLite databases (e.g., Vanguard, liberated-react-app), configure the database to use Write-Ahead Logging (WAL) mode (`PRAGMA journal_mode=WAL`) to allow concurrent reads and avoid database lock errors during background execution.

## 13. Chrome Extension Manifest V3 Specifications
*   **Manifest V3 Default**: All extension development must target Manifest V3 parameters.
*   **Offscreen Lifecycle**: Do not run continuous audio capture or DOM-dependent routines in the background service worker; spawn offscreen documents via `chrome.offscreen.createDocument` and ensure they are programmatically closed (`chrome.offscreen.closeDocument`) once tasks complete.

## 14. Business Systems, The Canopy & The Grove Stewardship (Google Antigravity)
*   **Role Definition**: Google Antigravity acts as the Lead Data Manager, Steward, and Business Systems Manager for **The Canopy** (our internal operations ecosystem) and **The Grove** (our project portfolio). It coordinates collaborating AIs (NotebookLM, Spark, Gemini, Copilot, ChatGPT) and integrates central databases.
*   **Primary Daily Driver Paradigm**: **ClickUp** is designated as the primary front-end dashboard and daily driver for managing tasks and projects. The Canopy sync engine runs strictly in the background as the database sync engine and Model Context Protocol (MCP) server. AI agents MUST prioritize managing and updating tasks directly in ClickUp via MCP tools or APIs and triggering background syncs rather than proposing bespoke UI modifications to The Canopy.
*   **Central File Maintenance**: Keep START_HERE_AI_PROTOCOL, AI_Update_Log (ID: `1s9S2Qr-hjtOAQajjJBMHDCv6i-FM_iLxT2owB3-kREY`), agents.md, FCC_Master_Reference_Guide.md, and Multi-Agent Sync Blueprint synchronized and updated.
*   **Automated Sync**: Maintain 100% alignment between local paths (`C:\Users\igxxg\OneDrive\Documents\GitHub`) and Google Drive parent folder (`175oU4Dae4xId-xYFnVNPH8OuQzkaXpew`) by running `sync_to_drive.py` (excluding Vanguard, build, and node_modules). Also ensure bidirectional database sync is triggered by running `python The Canopy/scratch/fcc_sync.py --sync-databases` whenever database models, records, or active schemas in The Grove are updated.
*   **New Systems Integration**: Seamlessly integrate any incoming systems (e.g., Slack and Discord notifications, Sendiio marketing campaigns, Supabase backends) with Airtable CRM/PPM tables and ClickUp task cards under The Canopy.


---

## ⚙️ LiberateJS Refactoring Engine Operations
*   **AST Modernization**: Rapidly parse and refactor legacy CommonJS/ES5 codebases into clean ES6 React/TypeScript classes using Babel AST parser hooks.
*   **Rule Engine**: Maintain customizable refactoring recipes in `recipes/` to allow reusable modernization steps.

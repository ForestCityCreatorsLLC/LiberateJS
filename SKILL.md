---
name: liberatejs
description: Overhauls, decouples and migrates web apps from proprietary frameworks into clean, standalone React/Node apps using customizable recipes.
---

# Base44 Standalone App Converter

Use this skill when the user requests to migrate a project originally built on the proprietary Base44 platform into a standalone web application. This skill automates the project ingestion (including browser login and scraping), cleansing of proprietary folders and dependencies, refactoring of wrapper components and APIs, build verification, and deployment to a new GitHub repository.

## Pre-requisites & Setup
The user must set up the following environment variables (either in their global OS environment or in a local `.env` file in the target workspace) if they want to automate browser ingestion and GitHub deployment:
- `BASE44_EMAIL`: Username/email for the Base44 platform.
- `BASE44_PASSWORD`: Password for the Base44 platform.

---

## Extension Dashboard UI

This skill is packaged with a premium, glassmorphic interactive dashboard UI:
- **Location**: [index.html](file:///C:/Users/igxxg/.gemini/config/skills/liberatejs/ui/index.html)
- **Features**:
  1. Storing and verifying Base44 credentials and GitHub PATs.
  2. Scraping and selecting the target project from Base44.
  3. Running the pipeline interactively with a step-by-step progress tracking console.
  4. Instant access links to the generated standalone GitHub repository.

When the user asks to use the extension, guide them to open the dashboard file in their browser.

---

## Multi-Agent Execution Workflow

When this skill is activated, you must act as the **Orchestrator** and delegate tasks to specialized sub-agents:

### 1. Ingestion & Automated Cleansing Phase (Cleanser Agent)
1. **Workspace & Ingestion Check**:
   - Check if the target active workspace already has project files.
   - If the workspace is empty, check if the user has provided a Base44 project ID or URL, or if credentials (`BASE44_EMAIL`/`BASE44_PASSWORD`) are present.
   - **Browser Login**: If credentials are saved, launch browser tools to navigate to the Base44 login page (e.g. `https://base44.io/login` or the login portal URL). Auto-fill the credentials, submit, and verify the session.
   - **Project Scraping**: Navigate to the user's dashboard, scrape the list of available projects/ideas, and output them in the chat so the user can select which project to pull.
   - **Download**: Once selected, scrape/download the project files directly into the active workspace directory.
2. **Execute Cleanser**:
   - Run the automated Python cleanser script on the active workspace:
     ```powershell
     python "C:\Users\igxxg\.gemini\config\skills\liberatejs\scripts\decouple-cleanse.py" --dir . --recipe "recipes/base44.json"
     ```
   - Verify that the script successfully deletes the `base44` directory, removes proprietary dependencies and scripts from `package.json`, renames the project, updates `index.html`, generates `.env.example`, and creates `.migration-status.json`.
3. **Install Dependencies**:
   - Run `npm install` (or `pnpm install` / `yarn install` depending on lockfiles) to regenerate a clean lockfile.

### 2. Code Reworking & Adapter Configuration Phase (Rework Agent)
1. **Analyze Metadata**:
   - Read `.migration-status.json` and `.env.example` in the workspace to identify deleted wrappers, removed dependencies, and extracted environment variables.
2. **Adapter Implementation**:
   - **Router & State**: Replace proprietary wrapper components (like `<Base44Wrapper>`) in entry files (`App.jsx`, `main.jsx`, `index.js`) with standard React routers (`react-router-dom`) or custom context layouts. Map proprietary state hooks to standard hooks (`useState`) or standard state management libraries.
   - **Environment Mapping**: Map old configuration variables to standard environment hooks (e.g. `import.meta.env` for Vite).
   - **Layout & Aesthetics**: Ensure the visual layout looks stunning and premium. Build or restore global stylesheets, integrate custom Google Fonts (e.g., Outfit, Inter), and apply rich designs (vibrant colors, dark mode, glassmorphism) if removing the base44 template wrapper leaves the UI looking raw or default.

### 3. Build Verification & CI/CD Phase (QA Agent)
1. **Validation Checks**:
   - Run compilers or typechecks: `npm run lint` or `npm run typecheck`.
   - Run production build: `npm run build`.
   - If build fails, report errors to the Rework Agent to fix, and re-run until it compiles 100% cleanly.
2. **CI/CD Workflow**:
   - Create a GitHub Actions workflow file: `.github/workflows/build-and-test.yml` to automatically run `npm install` and `npm run build` on every push to `main`.

### 4. Git Initialization & GitHub Push Phase (Deployment Agent)
1. **Authentication check**:
   - Run `gh auth status` to check if GitHub CLI is logged in.
   - If not logged in, run `gh auth login` and prompt the user to authorize.
   - If `gh` is not installed, prompt the user for a blank repository URL on GitHub.
2. **Git Setup**:
   - Run `git init`.
   - Create a `.gitignore` ignoring `node_modules`, `dist`, `.env`, and build folders.
   - Stage and commit: `git add .` and `git commit -m "feat: initial clean standalone application"`.
   - Set the main branch: `git branch -M main`.
3. **Deploy**:
   - If using `gh` CLI:
     ```powershell
     gh repo create --public --source=. --remote=origin --push
     ```
   - If using manual remote:
     ```powershell
     git remote add origin <user-provided-url>
     git push -u origin main
     ```

---

## Guidelines for IDE Agents
- **Local Scope**: Ensure all code changes, shell commands, and files are written to the user's active workspace folder (`.`). Do not touch the global skill files.
- **Maintain Business Logic**: Do not alter core features, logic, or assets of the app; only remove platform-specific wrappers.
- **Aesthetic Priority**: Never leave an app looking default or unstyled. Apply professional styling.

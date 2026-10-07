@echo off
rem ATLASZ Control Center - interim launcher (no installer needed, requires Node.js 20+ on this PC).
rem Double-click, or create a desktop shortcut to this file. The Control Center opens in your browser.
rem Closing this window stops the Control Center and the ATLASZ runtime it started (graceful).
title ATLASZ Control Center
cd /d "%~dp0.."
node atlasz-control-center\server.mjs
pause

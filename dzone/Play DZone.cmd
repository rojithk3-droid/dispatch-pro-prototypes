@echo off
rem Double-click to play DZone: starts the local game server and opens the game in your default browser.
rem Keep the black window open while you play; close it to stop the server.
title DZone server
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\dzone-server.ps1" -Open %*

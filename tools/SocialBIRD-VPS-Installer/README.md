# SocialBIRD VPS Installer

Windows x64 single-file GUI utility for safely updating the full SocialBIRD production application on an already configured VPS, then applying the C-Party own-video playback fix.

- Connects over SSH and verifies/pins the server host-key fingerprint.
- Prompts for the SSH password at runtime; it is not stored, logged, or embedded in the executable.
- Runs the repository's full production updater, then the C-Party own-video updater. It executes fixed scripts from the repository instead of arbitrary user-provided shell commands.
- Checks free disk space, ensures FFmpeg/ffprobe are installed, backs up relevant source files, builds the frontend, restarts PM2, performs smoke tests, and restores application files if the update fails.
- Does not reset MySQL, delete accounts, remove uploaded files, or change the existing upload-size cap.

This is a full in-place application updater, not a clean installation for an empty VPS. It expects the existing layout under /opt/socialbird/current, the socialbird service user, the socialbird-api PM2 application, and a public Git remote named origin.

Security: do not reuse a root password that was posted in a chat. Rotate it first, then use the new credentials. SSH public-key authentication is preferred for long-term administration.

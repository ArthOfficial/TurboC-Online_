# Program library

Everyone can browse and open built-in examples and programs published by ArthOfficial. Only the owner, authenticated with a server-verified password, can upload, edit, or delete published programs. New working files remain local to the emulator unless the owner explicitly publishes them.

Keep the existing static Vercel website and DOS editor. Add a compact left program panel with responsive stacking on mobile. Include six Turbo C++ compatible examples. Reuse the existing file-opening path, preserving its handling of already-open filenames and the direct clipboard bridge.

Use a private Vercel Blob store as durable file storage, with a public read API. Each published program is an independent JSON object; no database server or Drive integration is required. Owner writes use HttpOnly signed session cookies, same-origin checks, password hashing, strict input validation, conditional updates, and durable login throttling. No passwords or storage tokens are shipped to the browser. Deletion requires a named confirmation and removes the corresponding stored object, without deleting a visitor's working copy.

Start the emulator with the examples and a Fibonacci source file already selected. Remove the delayed unsolicited F5 shortcut and debug dumps. Preserve DOS configuration and test startup on a clean browser and a slower CPU. Do not claim the intermittent welcome dialog fixed unless the revised startup is verified.

Cloud deployment needs the owner's Vercel Blob connection and password hash. Until configured, built-in programs work and owner controls clearly explain setup is required. Never simulate cloud saving with browser-local storage.

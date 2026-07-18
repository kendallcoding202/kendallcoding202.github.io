/* ============================================================
   BREACH — persistence seam
   All profile reads/writes go through here so the storage backend
   can be swapped without touching game code. Today it's localStorage
   (persists in the browser and inside the Tauri webview). For Steam
   Cloud, a Tauri filesystem backend writes the same JSON to a synced
   file — see marketing/STEAM_CLOUD.md. Keeping every access behind
   this module is what makes that swap a one-file change.
   ============================================================ */

export function readRaw(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

export function writeRaw(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* storage blocked — in-memory only */ }
}

export function removeRaw(key: string): void {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Offer a string as a downloadable file (used to export a save). */
export function downloadText(filename: string, text: string): void {
    try {
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* download unavailable in this environment */ }
}

/** Prompt for a text file and hand back its contents (used to import a save). */
export function pickTextFile(): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            const input = document.createElement("input");
            input.type = "file"; input.accept = "application/json,.json,.txt";
            input.onchange = () => {
                const file = input.files && input.files[0];
                if (!file) { resolve(null); return; }
                const reader = new FileReader();
                reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
                reader.onerror = () => resolve(null);
                reader.readAsText(file);
            };
            input.click();
        } catch { resolve(null); }
    });
}

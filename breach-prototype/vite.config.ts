import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config tuned to also serve as the frontend for the Tauri desktop shell.
// The game itself is unchanged — Tauri just wraps this same web build.
export default defineConfig({
    plugins: [react()],
    // Tauri expects a fixed dev port and quieter output.
    clearScreen: false,
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        target: "es2021",
        sourcemap: false,
    },
});

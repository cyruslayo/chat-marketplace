import { readFileSync } from "node:fs";
import {
    LANDING_BINARY_ASSETS,
    type LandingBinaryAssetLoader,
    type LandingBinaryAssetName,
} from "./landing-assets.js";

/** Node adapter only. No asset is opened until its first request (ADR 0095). */
export function nodeLandingAssetLoader(): LandingBinaryAssetLoader {
    const cache = new Map<LandingBinaryAssetName, Uint8Array>();
    return {
        read(name) {
            const cached = cache.get(name);
            if (cached !== undefined) return cached;
            const asset = Object.values(LANDING_BINARY_ASSETS).find(
                (candidate) => candidate.name === name,
            );
            if (asset === undefined) throw new Error("Unknown landing asset");
            const bytes = readFileSync(
                new URL(`../assets/${asset.file}`, import.meta.url),
            );
            cache.set(name, bytes);
            return bytes;
        },
    };
}

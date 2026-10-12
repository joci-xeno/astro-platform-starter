// Compatibility API (deadLetter / listDeadLetters / resolveDeadLetter) over the DURABLE store (durable-dead-letters.mjs).
// There is no in-memory fallback: a process that never configured a store gets an error instead of a queue that would lose failures on restart.
import { createDurableDeadLetters } from "./durable-dead-letters.mjs";
let store = null;
export function configureDeadLetters(options) { store = options && typeof options.deadLetter === "function" ? options : createDurableDeadLetters(options); return store; }
const need = () => { if (!store) throw new Error("DEAD_LETTER_STORE_NOT_CONFIGURED"); return store; };
export const deadLetter = a => need().deadLetter(a);
export const listDeadLetters = status => need().list(status);
export const resolveDeadLetter = (id, note) => need().resolve(id, note);
export const deadLetterStore = () => need();

// react-router v7 needs TextEncoder at import time, which jsdom lacks.
// Import this file before react-router-dom in jsdom tests.
import { TextDecoder, TextEncoder } from "util"

Object.assign(globalThis, { TextEncoder, TextDecoder })

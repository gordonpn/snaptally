import { timingSafeEqual } from "node:crypto";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./tests/sql-loader.mjs", pathToFileURL("./"));

if (typeof globalThis.crypto?.subtle?.timingSafeEqual !== "function") {
  globalThis.crypto.subtle.timingSafeEqual = (a, b) => {
    return timingSafeEqual(
      Buffer.from(a.buffer, a.byteOffset, a.byteLength),
      Buffer.from(b.buffer, b.byteOffset, b.byteLength),
    );
  };
}

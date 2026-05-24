import { readFileSync } from "node:fs";

export const IN_CONTAINER = (() => {
  try {
    return readFileSync("/run/in_container", "utf8").trim() === "1";
  } catch {
    return false;
  }
})();

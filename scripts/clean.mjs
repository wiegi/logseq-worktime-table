import { rm } from "node:fs/promises";

for (const dir of ["dist", "release"]) {
  await rm(dir, { recursive: true, force: true });
}

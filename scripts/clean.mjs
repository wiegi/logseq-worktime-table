import { rm } from "node:fs/promises";

for (const dir of ["dist", "release", ".parcel-cache", ".parcel-cache-dev"]) {
  await rm(dir, { recursive: true, force: true });
}

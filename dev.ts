#!/usr/bin/env -S deno run -A --watch=static/,routes/,lib/,components/,islands/

import { Builder } from "fresh/dev";

const builder = new Builder({ serverEntry: "./main.ts" });

if (Deno.args.includes("build")) {
  await builder.build();
} else {
  await builder.listen(() => import("./main.ts"));
}

// 测试环境准备：把数据目录指向临时目录，数据库用内存库。
//
// 必须在测试文件的第一个 import 位置引入本模块，因为 ESM 按 import 顺序求值。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "jsr:@std/path@^1.1.2";

const dir = mkdtempSync(join(tmpdir(), "whistle-test-"));

Deno.env.set("WHISTLE_DATA_DIR", dir);
Deno.env.set("WHISTLE_DB", ":memory:");
Deno.env.set("WHISTLE_PEPPER_FILE", join(dir, "pepper.key"));
Deno.env.set("WHISTLE_DAY_TZ_OFFSET_HOURS", "8");

export const testDataDir = dir;

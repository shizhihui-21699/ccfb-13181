// 管理命令。通过 deno task admin 调用。
//
// 用法：
//   deno task admin create-staff <username> <角色> [显示名]
//   deno task admin list-staff
//   deno task admin reset-password <username>
//   deno task admin purge [--dry-run]
//
// 注意：这条命令直接操作数据库，只能在服务器上以运维身份运行。
// 它不会打印任何举报人相关信息（因为没有）。

import { parseArgs } from "jsr:@std/cli@^1.0.0";
import { hashPassword, randomToken } from "../lib/crypto.ts";
import * as repo from "../lib/repo.ts";
import { config } from "../lib/config.ts";
import { dayBucket } from "../lib/time.ts";

const ROLES = ["investigator", "lead", "auditor", "admin"];

function usage(): never {
  console.log(`用法:
  deno task admin create-staff <username> <role> [displayName]
  deno task admin list-staff
  deno task admin reset-password <username>
  deno task admin purge [--dry-run]
  deno task admin stats`);
  Deno.exit(1);
}

const args = parseArgs(Deno.args, { boolean: ["dry-run"], string: ["_"] });
const cmd = args._[0];

switch (cmd) {
  case "create-staff": {
    const username = String(args._[1] ?? "");
    const role = String(args._[2] ?? "");
    const displayName = String(args._[3] ?? username);
    if (!username || !ROLES.includes(role)) usage();
    if (repo.getStaffByUsername(username)) {
      console.error(`用户 ${username} 已存在。`);
      Deno.exit(1);
    }
    const pw = randomToken(12);
    repo.createStaff({
      username,
      displayName,
      role: role as repo.StaffRole,
      passwordHash: hashPassword(pw),
      mustChangePassword: true,
    });
    console.log(`已创建 ${username}（${role}）。初始密码：${pw}`);
    console.log("请通过安全渠道转交，并要求首次登录后修改。");
    break;
  }
  case "list-staff": {
    for (const s of repo.listStaff()) {
      console.log(
        `${s.username}\t${s.role}\t${
          s.active ? "启用" : "停用"
        }\t${s.display_name}`,
      );
    }
    break;
  }
  case "reset-password": {
    const username = String(args._[1] ?? "");
    const s = repo.getStaffByUsername(username);
    if (!s) {
      console.error("用户不存在。");
      Deno.exit(1);
    }
    const pw = randomToken(12);
    repo.updateStaffPassword(s.id, hashPassword(pw));
    repo.deleteSessionsForStaff(s.id);
    console.log(`已重置 ${username} 的密码：${pw}`);
    break;
  }
  case "purge": {
    const days = config.retentionDays;
    if (days <= 0) {
      console.log("未启用保留期清理（WHISTLE_RETENTION_DAYS=0）。");
      break;
    }
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(
      0,
      10,
    );
    if (args["dry-run"]) {
      console.log(`将删除 submitted_day < ${cutoff} 的已结案案件（dry-run）。`);
    } else {
      const ids = repo.purgeClosedOlderThan(cutoff);
      console.log(`已删除 ${ids.length} 个超过 ${days} 天的已结案案件。`);
    }
    break;
  }
  case "stats": {
    console.log(`数据目录: ${config.dataDir}`);
    console.log(`统计（不含任何举报人信息）:`);
    console.log(repo.caseStats());
    console.log(`今天（按天分桶）: ${dayBucket()}`);
    break;
  }
  default:
    usage();
}

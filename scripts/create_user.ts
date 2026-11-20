/**
 * 创建工作人员账号:
 *   deno task create-user <用户名> <显示名> <admin|investigator> <密码>
 * 例如:
 *   deno task create-user admin 合规部管理员 admin 'Str0ng!Pass'
 */
import { createStaffUser } from "../lib/db.ts";

const [username, displayName, role, password] = Deno.args;

if (
  !username || !displayName ||
  !["admin", "investigator"].includes(role ?? "") || !password
) {
  console.error(
    "用法: deno task create-user <用户名> <显示名> <admin|investigator> <密码>",
  );
  Deno.exit(1);
}
if (password.length < 10) {
  console.error("密码至少 10 位");
  Deno.exit(1);
}

await createStaffUser({
  username,
  displayName,
  role: role as "admin" | "investigator",
  password,
});
console.log(
  `已创建 ${
    role === "admin" ? "管理员" : "调查员"
  } ${displayName}(${username})`,
);

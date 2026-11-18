import { App, staticFiles } from "fresh";
import type { State } from "./utils.ts";
import { loadAuth } from "./lib/auth.ts";
import { methodGuard, securityHeaders } from "./lib/http.ts";

export const app = new App<State>();

// 顺序很重要：安全头包在最外层，任何提前返回的错误响应也会带上。
app.use(securityHeaders);
app.use(staticFiles());
app.use(methodGuard);
app.use(loadAuth);

app.fsRoutes();

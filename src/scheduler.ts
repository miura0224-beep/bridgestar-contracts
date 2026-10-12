import { maintenance } from "./store";
import type { RuntimeEnv } from "./security";
export default {
  async scheduled(_event, env) {
    await maintenance(env);
  },
} satisfies ExportedHandler<RuntimeEnv>;

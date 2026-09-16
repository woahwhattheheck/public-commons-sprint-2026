import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";

const agentmail = new AgentMail(components.agentmail, { onMessageReceived: internal.inbox.onMessageReceived });
const http = httpRouter();
http.route({ path: "/agentmail/webhook", method: "POST", handler: httpAction(async (ctx, req) => agentmail.handleWebhook(ctx, req)) });
export default http;

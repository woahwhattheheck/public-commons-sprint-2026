/** Bind only the native actions this operation uses. MIT. */
export function bindNativeSourceTools(tools) {
  const allowed = new Set([
    "gmail_get_profile","gmail_create_draft","gmail_read_email","gmail_read_attachment","gmail_list_drafts",
    "notion_notion_get_self","notion_fetch","notion_notion_create_attachment",
    "notion_notion_update_page","notion_notion_get_async_task","notion_notion_download_attachment","notion_notion_get_file_download_urls"
  ]);
  return async (name, args) => {
    if (!allowed.has(name)) throw new Error("UNSUPPORTED_SOURCE_TRANSFER_ACTION");
    const tool = tools["mcp__codex_apps__"+name];
    if (typeof tool !== "function") throw new Error("NATIVE_ACTION_NOT_AVAILABLE: "+name);
    return await tool(args);
  };
}

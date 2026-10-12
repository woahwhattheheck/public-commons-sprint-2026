// MIT. Data-only contracts shared by the original Research clients and tool catalog.
export const RESEARCH_WORKSPACE_API = 'stellar-forge.research-workspace-api.v1';
export const RESEARCH_WORKSPACE_CONNECTION = 'stellar-forge.research-workspace-connection.v1';
export const RESEARCH_SECTIONS = Object.freeze(['questions','editions','selections','findings','sources','revisions']);
export const RESEARCH_PAGE_LIMIT = 100;
export const RESEARCH_CONTROL_LIMIT = 16 * 1024 * 1024;
export const RESEARCH_COMPARISON_SECTIONS = Object.freeze(['added','removed','changed','questions','editions','availability',

import StarterKit from '@tiptap/starter-kit';
export const SCHEMA_ID = 'reference-v1';
export const FIELD_NAME = 'default';
export function createContentExtensions() { return [StarterKit.configure({undoRedo:false})]; }
